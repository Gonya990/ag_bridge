<#
  AG Bridge - All-in-one launcher for Windows.

  Does three things so "it just works" from a fresh boot:
    1. Starts Antigravity with --remote-debugging-port (enables "The Poke")
       unless something is already listening on the CDP port.
    2. Runs `npm install` if dependencies are missing.
    3. Starts the bridge server (foreground), which prints the Pairing Code
       and Local / Tailscale URLs.

  Usage (from repo root):
    powershell -ExecutionPolicy Bypass -File scripts\start-windows.ps1
  or just double-click start.cmd.

  Optional overrides:
    -Port     8787   Bridge HTTP port.
    -CdpPort  9000   Antigravity remote-debugging port (must match poke.mjs).
    -AgExe    <path> Full path to Antigravity.exe (or set $env:AG_EXE).
    -NoAg            Skip launching Antigravity (server only).
#>

param(
    [int]$Port = 8787,
    [int]$CdpPort = 9000,
    [string]$AgExe = $env:AG_EXE,
    [switch]$NoAg
)

$ErrorActionPreference = 'Stop'

# Repo root = parent of this script's folder (scripts/..).
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[x] $msg" -ForegroundColor Red }

# Returns $true if a TCP port on localhost is accepting connections.
function Test-Port([int]$p) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $p, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(400)
        if ($ok -and $client.Connected) { $client.Close(); return $true }
        $client.Close(); return $false
    } catch { return $false }
}

# -------------------------------------------------------------------
# 0. Node.js present?
# -------------------------------------------------------------------
Write-Step "Checking Node.js"
try {
    $nodeVer = (& node --version) 2>$null
    Write-Host " Node $nodeVer"
} catch {
    Write-Err "Node.js not found. Install Node 18+ from https://nodejs.org and re-run."
    exit 1
}

# -------------------------------------------------------------------
# 1. Antigravity + CDP (the Poke)
# -------------------------------------------------------------------
if (-not $NoAg) {
    Write-Step "Checking Antigravity remote-debugging (CDP) on port $CdpPort"
    if (Test-Port $CdpPort) {
        Write-Host " CDP already up on $CdpPort -> reusing it (not launching a second instance)."
    } else {
        # Resolve the Antigravity executable.
        if (-not $AgExe) {
            $cmd = Get-Command antigravity.exe -ErrorAction SilentlyContinue
            if ($cmd) { $AgExe = $cmd.Source }
        }
        if (-not $AgExe) {
            $candidates = @(
                "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe",
                "$env:ProgramFiles\Antigravity\Antigravity.exe",
                "${env:ProgramFiles(x86)}\Antigravity\Antigravity.exe"
            )
            $AgExe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
        }

        if ($AgExe -and (Test-Path $AgExe)) {
            Write-Host " Launching Antigravity: $AgExe"
            Start-Process -FilePath $AgExe -ArgumentList @($RepoRoot, "--remote-debugging-port=$CdpPort") | Out-Null

            # Wait for CDP to come online (up to ~20s).
            $ready = $false
            for ($i = 0; $i -lt 40; $i++) {
                Start-Sleep -Milliseconds 500
                if (Test-Port $CdpPort) { $ready = $true; break }
            }
            if ($ready) {
                Write-Host " CDP is up on port $CdpPort. The Poke is armed." -ForegroundColor Green
            } else {
                Write-Warn "Antigravity launched but CDP did not open on $CdpPort yet."
                Write-Warn "The bridge will still run; the Poke may not wake the Agent until CDP is ready."
            }
        } else {
            Write-Warn "Antigravity.exe not found automatically."
            Write-Warn "Server will start, but the Poke (remote wake-up) will NOT work."
            Write-Warn "Fix: launch it yourself in another terminal:"
            Write-Warn "    antigravity.exe . --remote-debugging-port=$CdpPort"
            Write-Warn "or re-run this with:  -AgExe `"C:\path\to\Antigravity.exe`""
        }
    }
} else {
    Write-Host "`n(-NoAg set: skipping Antigravity launch.)"
}

# -------------------------------------------------------------------
# 2. Dependencies
# -------------------------------------------------------------------
Write-Step "Checking dependencies"
if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
    Write-Host " node_modules missing -> running npm install"
    & npm install
    if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed."; exit 1 }
} else {
    Write-Host " node_modules present."
}

# -------------------------------------------------------------------
# 3. Tailscale (informational; server auto-detects)
# -------------------------------------------------------------------
Write-Step "Checking Tailscale"
try {
    $tsState = (& tailscale status --json 2>$null | ConvertFrom-Json).BackendState
    if ($tsState -eq 'Running') {
        Write-Host " Tailscale is Running -> remote URL will be printed below." -ForegroundColor Green
    } else {
        Write-Warn "Tailscale backend state: $tsState. Start it for remote access."
    }
} catch {
    Write-Warn "Tailscale CLI not found. LAN access still works; install Tailscale for remote."
}

# -------------------------------------------------------------------
# 4. Start the bridge (foreground)
# -------------------------------------------------------------------
Write-Step "Starting AG Bridge on port $Port"
if ($Port -ne 8787) {
    & node server.mjs --port $Port
} else {
    & node server.mjs
}
