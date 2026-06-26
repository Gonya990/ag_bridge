# Home Setup (Windows + Tailscale)

End-to-end guide to run the **whole AG Bridge stack** on your home machine and
reach it from your phone anywhere via Tailscale. Pull the code from GitHub once,
then `start.cmd` brings everything up.

> The one-click path is `start.cmd`. This doc explains what it does, the
> prerequisites, and how to recover when something doesn't light up.

---

## 0. Prerequisites (install once)

| Tool | Why | Get it |
| ---- | --- | ------ |
| **Node.js 18+** | Runs the bridge server. | https://nodejs.org (LTS) |
| **Git** | Clone + update from GitHub. | https://git-scm.com |
| **Antigravity** | The Agent. Must support `--remote-debugging-port`. | Your Antigravity install |
| **Tailscale** | Secure remote access from your phone. | https://tailscale.com/download |

Verify Node and Git in a terminal:

```bat
node --version
git --version
```

---

## 1. Get the code from GitHub

```bat
git clone https://github.com/Gonya990/ag_bridge.git
cd ag_bridge
```

To update later: `git pull` (see [§6](#6-updating)).

---

## 2. Set up Tailscale (for remote access)

1. Install Tailscale on the **home machine** and sign in.
2. Install the Tailscale app on your **phone** and sign in to the **same account**.
3. Open the phone app — the home machine should show a green dot (online).

> LAN-only? You can skip Tailscale; you'll still get a `http://<LAN-IP>:8787`
> URL when on the same Wi-Fi. Tailscale is what makes it work on LTE/5G.

---

## 3. Start everything (one click)

From the repo folder, double-click **`start.cmd`** or run:

```bat
start.cmd
```

The launcher:

1. Checks Node.js is installed.
2. Launches **Antigravity** with `--remote-debugging-port=9000` (this arms
   "The Poke" — remote wake-up). Skips if CDP is already running, or if it
   can't find `Antigravity.exe` (see options below).
3. Runs `npm install` only if `node_modules` is missing.
4. Reports **Tailscale** status.
5. Starts the bridge and prints the **Pairing Code** + URLs.

You'll see something like:

```
==================================================
 AG Bridge v0.6.0 running on port 8787
==================================================
 PAIRING CODE: [ 733403 ]
--------------------------------------------------
 Local (same Wi-Fi):
 http://192.168.1.50:8787

 Remote (Tailscale Active):
 http://my-pc.tailnet-name.ts.net:8787
 http://100.x.y.z:8787
==================================================
```

### Launcher options

| Command | Effect |
| ------- | ------ |
| `start.cmd -Port 9090` | Use a different bridge port. |
| `start.cmd -NoAg` | Don't launch Antigravity (server only). |
| `start.cmd -AgExe "C:\path\to\Antigravity.exe"` | Point at Antigravity explicitly if auto-detect fails. |

You can also set the executable once via env var: `setx AG_EXE "C:\path\to\Antigravity.exe"`.

---

## 4. Connect from your phone

1. Open the printed URL on your phone:
   - **Same Wi-Fi:** the `Local` URL (`http://192.168.x.x:8787`).
   - **Anywhere (Tailscale):** the `Remote` URL (`http://my-pc...ts.net:8787`).
2. Enter the **Pairing Code** shown in the console.
3. Chat. Use **The Poke** to wake the Agent when it's idle.

> Add it to your home screen (PWA) for an app-like experience.

---

## 5. Keep it running

- Leave the `start.cmd` console window open — closing it stops the bridge.
- The window stays open after the bridge exits so you can read any errors.
- To restart cleanly: close the window and double-click `start.cmd` again.

---

## 5b. One command (clone + install + run)

If you'd rather not click, paste this once into **PowerShell on the Windows
host** — it clones, installs, and launches:

```powershell
git clone https://github.com/Gonya990/ag_bridge.git "$HOME\ag_bridge"; cd "$HOME\ag_bridge"; .\bootstrap.ps1
```

Already cloned? Just `.\bootstrap.ps1` (it updates, reinstalls if needed, and runs).

`bootstrap.ps1` options: `-AutoStart` (register logon auto-start), `-NoAg`,
`-Port 9090`, `-NoRun` (set up without launching), `-Branch <name>`.

### Triggering it from your Mac over SSH

You can run that same command from your Mac if the Windows host has OpenSSH
Server enabled (Windows: *Settings → System → Optional features → Add → OpenSSH
Server*, then `Start-Service sshd`). From the Mac:

```bash
ssh you@windows-host.tailnet-name.ts.net 'powershell -NoProfile -Command "cd $HOME\ag_bridge; .\bootstrap.ps1 -NoRun"'
```

> Note: a GUI app like Antigravity won't display in an SSH (non-interactive)
> session. Over SSH, use `-NoRun` to install/update, or `-NoAg` to run only the
> bridge server; let the **auto-start task** (below) bring up the full GUI stack
> in your real logon session.

## 5c. Auto-start at logon (set & forget)

Register a Task Scheduler job so the whole stack comes up automatically every
time you log in — double-click **`install-autostart.cmd`** (it self-elevates),
or:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
```

Then:

1. Start it now without rebooting: `Start-ScheduledTask -TaskName "AG Bridge"`
2. **Pair your phone once** with the Pairing Code — the device token is saved to
   `data/state.json`.
3. From then on, every logon brings the bridge up and your phone reconnects
   automatically (no re-pairing; the Pairing Code changing each boot doesn't
   matter once a device is paired).

Remove auto-start: `install-autostart.cmd -Remove` (or the `.ps1` with `-Remove`).

## 6. Updating

```bat
cd ag_bridge
git pull
start.cmd
```

`start.cmd` re-runs `npm install` automatically if dependencies changed
(delete `node_modules` first to force a clean install).

---

## 7. Troubleshooting

| Symptom | Cause / Fix |
| ------- | ----------- |
| "Node.js not found" | Install Node 18+ and reopen the terminal. |
| "Antigravity.exe not found automatically" | Pass `-AgExe "C:\path\Antigravity.exe"` or set `AG_EXE`. Server still runs; only the Poke is affected. |
| The Poke doesn't wake the Agent | Antigravity must be started with `--remote-debugging-port=9000`. Verify: `curl http://127.0.0.1:9000/json/list` returns JSON. |
| No `Remote (Tailscale Active)` line | Tailscale isn't running/logged in. Start it; re-run `start.cmd`. |
| Phone can't load the URL | Confirm both devices are online in the Tailscale app; don't port-forward 8787 to the public internet. |
| `PowerShell ... cannot be loaded` | Use `start.cmd` (it sets `-ExecutionPolicy Bypass`), not the `.ps1` directly. |

See also: [Troubleshooting](troubleshooting.md), [Remote with Tailscale](remote_with_tailscale.md), [Security](security.md).
