<#
  AG Bridge - one-command bootstrap for Windows.

  Clones (or updates) the repo, installs dependencies, optionally registers
  auto-start at logon, then launches the full stack. Idempotent: safe to re-run.

  Quick start (paste into PowerShell on the Windows host):
    git clone https://github.com/Gonya990/ag_bridge.git "$HOME\ag_bridge"; `
      cd "$HOME\ag_bridge"; .\bootstrap.ps1

  Or, if you already have a clone, just:  .\bootstrap.ps1

  Options:
    -Dir       Install/checkout dir   (default: $HOME\ag_bridge)
    -Branch    Git branch to use      (default: main)
    -AutoStart Register Task Scheduler auto-start at logon
    -NoAg      Don't launch Antigravity (bridge server only)
    -Port      Bridge port            (default: 8787)
    -NoRun     Set up only; don't launch now
#>

param(
    [string]$Dir = (Join-Path $HOME 'ag_bridge'),
    [string]$Branch = 'main',
    [switch]$AutoStart,
    [switch]$NoAg,
    [int]$Port = 8787,
    [switch]$NoRun
)

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/Gonya990/ag_bridge.git'

function Write-Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Err($m)  { Write-Host "[x] $m" -ForegroundColor Red }

# --- Prereqs -------------------------------------------------------
Write-Step "Checking prerequisites (git, node)"
foreach ($bin in @('git', 'node')) {
    if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) {
        Write-Err "$bin not found."
        if ($bin -eq 'git')  { Write-Host " Install Git:  https://git-scm.com" }
        if ($bin -eq 'node') { Write-Host " Install Node 18+:  https://nodejs.org" }
        exit 1
    }
}
Write-Host " git $(git --version)"
Write-Host " node $(node --version)"

# --- Clone or update ----------------------------------------------
if (Test-Path (Join-Path $Dir '.git')) {
    Write-Step "Updating existing clone in $Dir"
    git -C $Dir fetch --all --prune
    git -C $Dir checkout $Branch
    git -C $Dir pull --ff-only origin $Branch
} else {
    Write-Step "Cloning $RepoUrl -> $Dir"
    git clone --branch $Branch $RepoUrl $Dir
}
Set-Location $Dir

# --- Dependencies --------------------------------------------------
Write-Step "Installing dependencies"
if (Test-Path 'package-lock.json') { npm ci } else { npm install }
if ($LASTEXITCODE -ne 0) { Write-Err "Dependency install failed."; exit 1 }

# --- Optional auto-start ------------------------------------------
if ($AutoStart) {
    Write-Step "Registering auto-start at logon"
    $autostartArgs = @()
    if ($Port -ne 8787) { $autostartArgs += @('-Port', "$Port") }
    if ($NoAg)          { $autostartArgs += '-NoAg' }
    & (Join-Path $Dir 'scripts\install-autostart.ps1') @autostartArgs
}

# --- Launch --------------------------------------------------------
if ($NoRun) {
    Write-Step "Setup complete (--NoRun set)."
    Write-Host " Launch later with:  .\start.cmd"
    return
}

Write-Step "Launching AG Bridge"
$startArgs = @()
if ($Port -ne 8787) { $startArgs += @('-Port', "$Port") }
if ($NoAg)          { $startArgs += '-NoAg' }
& (Join-Path $Dir 'scripts\start-windows.ps1') @startArgs
