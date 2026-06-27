# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added `docs/BRANCHING.md`, `docs/RELEASING.md`, `docs/CORE_CONTRACT.md`.
- Added GitHub templates (PR, Issue).
- Added CI workflow (`.github/workflows/ci.yml`).
- Added `scripts/precommit.sh` and related `package.json` script.
- Added Windows one-click launcher (`start.cmd` + `scripts/start-windows.ps1`).
- Added one-command bootstrap (`bootstrap.ps1`): clone/update, install, run.
- Added logon auto-start (`install-autostart.cmd` + `scripts/install-autostart.ps1`).
- Added `docs/HOME_SETUP.md` (Windows + Tailscale end-to-end runbook) and
  `docs/RUN_WITH_CLAUDE_CODE.md` (let a local agent run it for you).

### Changed
- Hardened repository structure to align with AG standards.

### Fixed
- Unified the app version reported by the startup banner, `/health`, and
  `/status` to a single source of truth (`package.json`); the banner no longer
  shows the state-file schema version.
