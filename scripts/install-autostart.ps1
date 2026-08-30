<#
  AG Bridge - install/remove a Windows auto-start (Task Scheduler).

  Registers a scheduled task that runs the launcher at user logon, so the full
  stack (Antigravity CDP + bridge server) comes up automatically. Device tokens
  are persisted in data/state.json, so you only pair the phone once; after that
  every auto-restart reconnects with the stored token.

  Install:
    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
  Remove:
    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove

  Options (install only):
    -Port    8787   Bridge port to pass to the launcher.
    -NoAg           Don't auto-launch Antigravity (bridge server only).
    -TaskName       Scheduled task name (default: "AG Bridge").

  Registering a logon task usually needs elevation; install-autostart.cmd
  self-elevates for you.
#>

param(
    [switch]$Remove,
    [int]$Port = 8787,
    [switch]$NoAg,
    [string]$TaskName = 'AG Bridge'
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$LauncherPs = Join-Path $RepoRoot 'scripts\start-windows.ps1'

function Write-Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "[ok] $m" -ForegroundColor Green }
function Write-Err($m)  { Write-Host "[x] $m" -ForegroundColor Red }

# --- Remove mode ---------------------------------------------------
if ($Remove) {
    Write-Step "Removing scheduled task '$TaskName'"
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Ok "Auto-start removed. AG Bridge will no longer launch at logon."
    } else {
        Write-Host " No task named '$TaskName' found. Nothing to do."
    }
    return
}

# --- Install mode --------------------------------------------------
if (-not (Test-Path $LauncherPs)) {
    Write-Err "Launcher not found: $LauncherPs"
    exit 1
}

Write-Step "Registering auto-start task '$TaskName'"

# Build the launcher arguments.
$launcherArgs = @()
if ($Port -ne 8787) { $launcherArgs += @('-Port', "$Port") }
if ($NoAg)          { $launcherArgs += '-NoAg' }

$psArgs = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', "`"$LauncherPs`""
) + $launcherArgs

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument ($psArgs -join ' ') `
    -WorkingDirectory $RepoRoot

# At logon of the current user.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Run in the interactive session so Antigravity's GUI can appear.
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

# Resilient settings: no time limit, survive battery, retry on failure.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -RestartCount 3

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Starts AG Bridge (and Antigravity CDP) at logon.' `
    -Force | Out-Null

Write-Ok "Auto-start installed."
Write-Host ""
Write-Host " Task name : $TaskName"
Write-Host " Runs      : powershell -File `"$LauncherPs`" $($launcherArgs -join ' ')"
Write-Host " Trigger   : at logon of $env:USERNAME"
Write-Host ""
Write-Host " Next steps:" -ForegroundColor Yellow
Write-Host "  1. Start it now without rebooting:  Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "  2. Pair your phone ONCE with the Pairing Code (token is then saved)."
Write-Host "  3. After that, every logon brings the bridge up automatically."
Write-Host ""
Write-Host " To remove later: scripts\install-autostart.ps1 -Remove"
