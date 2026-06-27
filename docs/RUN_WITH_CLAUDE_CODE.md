# Let a local agent run it for you (Claude Code on Windows)

Want an **AI agent to set up and launch AG Bridge for you**, instead of pasting
commands yourself? A cloud agent (claude.ai/code in the browser) **can't** reach
your home PC — there's no network path to it. But **Claude Code installed on the
Windows machine itself** runs locally and *can* clone, install, launch, and
register auto-start for you.

This is the "the agent does it" path.

## 1. Install Claude Code on the Windows machine

In PowerShell on the home PC:

```powershell
# Prereqs (skip any you already have):
#   Node.js 18+   -> https://nodejs.org
#   Git           -> https://git-scm.com
npm install -g @anthropic-ai/claude-code
```

Verify:

```powershell
claude --version
```

## 2. Start Claude Code and let it do the work

```powershell
cd $HOME
claude
```

Then just tell it, in plain language:

> Clone https://github.com/Gonya990/ag_bridge into %USERPROFILE%\ag_bridge,
> then run `.\bootstrap.ps1 -AutoStart` to install dependencies, register
> logon auto-start, and launch the bridge. Show me the Pairing Code when it's up.

The local agent will execute the steps on **your** machine (it has a real
filesystem and shell there), bring up Antigravity + the bridge, and report the
Pairing Code. Pair your phone once; after that every logon starts everything
automatically (the device token persists in `data/state.json`).

## 3. What it runs under the hood

Exactly the same artifacts documented in [HOME_SETUP.md](HOME_SETUP.md):

- `bootstrap.ps1` — clone-or-update, `npm ci`/`npm install`, optional auto-start, launch.
- `scripts/start-windows.ps1` — launches Antigravity (`--remote-debugging-port=9000`) and the bridge.
- `scripts/install-autostart.ps1` — Task Scheduler job at logon.

## Why the cloud agent can't do this directly

| | Cloud agent (claude.ai/code) | Local Claude Code (on your PC) |
| --- | --- | --- |
| Runs in | Anthropic's ephemeral container | Your Windows machine |
| Sees your home PC | No (no route, no SSH) | Yes — it *is* on it |
| Can launch Antigravity + bridge | No | Yes |
| Edits the GitHub repo | Yes | Yes |

The cloud agent prepares the code in GitHub; the local agent (or you) runs it on
the machine where Antigravity lives. There is no way around that boundary — it's
how the sandbox is isolated.

See also: [HOME_SETUP.md](HOME_SETUP.md) for the manual / one-command paths.
