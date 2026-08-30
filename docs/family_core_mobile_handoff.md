# Family Core mobile handoff

This bridge can run a second local instance for Family Core tasks sent from a phone to the Mac.

## Current Mac service

- LaunchAgent: `com.igorgoncharenko.family_core_bridge`
- Plist: `/Users/igorgoncharenko/Library/LaunchAgents/com.igorgoncharenko.family_core_bridge.plist`
- Working directory: `/Users/igorgoncharenko/Projects/ag_bridge`
- Bind address: `0.0.0.0`
- Port: `8791`
- Log: `/Users/igorgoncharenko/.run_here/logs/family_core_bridge.launchd.log`
- Local pairing code file: `/Users/igorgoncharenko/Projects/ag_bridge/.logs/pairing-code-8791.txt`

The older local-only bridge remains separate:

- LaunchAgent: `com.igorgoncharenko.ag_bridge`
- Bind address: `127.0.0.1`
- Port: `8787`

## Phone URLs

Use the LAN URL while the phone is on the same Wi-Fi:

```text
http://192.168.1.198:8791
```

Use the Tailscale URL when the phone is on the tailnet:

```text
http://100.68.240.51:8791
```

Do not expose port `8791` directly to the public internet.

The mobile page also serves a share entrypoint:

```text
http://192.168.1.198:8791/share
```

When opened with query parameters, the page imports the shared item into the Family Core draft:

```text
http://192.168.1.198:8791/share?title=Item&text=Notes&url=https%3A%2F%2Fexample.com
```

This works as a normal Safari link. The PWA manifest also declares the same route as a Web Share Target for clients that expose it.

## Pairing from a phone

Because this service starts through launchd, there may be no visible terminal window with the pairing code.

On the Mac, read the current code from:

```bash
cat /Users/igorgoncharenko/Projects/ag_bridge/.logs/pairing-code-8791.txt
```

The file is rewritten on service start with `chmod 600`, so only the local Mac user should be able to read it. It is under `.logs/`, which is ignored by Git.

## Local queue API

The Family Core queue is stored locally in `data/state.json` and is capped to the most recent 100 jobs.

Create a local processing job:

```http
POST /family-core/jobs
```

Read queued jobs:

```http
GET /family-core/jobs?status=queued&limit=20
```

Update a job:

```http
POST /family-core/jobs/:id/status
```

Allowed job statuses:

```text
queued
processing
done
failed
```

`GET /status` includes `queuedFamilyCoreJobs`.

Read saved Mac inbox summaries:

```http
GET /family-core/inbox?limit=10
```

This returns metadata and local file paths only. It does not serve the saved file contents.

## Mac worker

The Mac can process queued Family Core jobs automatically through a separate launchd worker:

- LaunchAgent: `com.igorgoncharenko.family_core_worker`
- Script: `/Users/igorgoncharenko/Projects/ag_bridge/scripts/family-core-worker.mjs`
- Poll interval: 15 seconds
- Output directory: `/Users/igorgoncharenko/Projects/ag_bridge/data/family-core-inbox/`
- Status file: `/Users/igorgoncharenko/Projects/ag_bridge/data/family-core-worker-status.json`
- Log: `/Users/igorgoncharenko/.run_here/logs/family_core_worker.launchd.log`

For each queued job, the worker:

1. marks it as `processing`;
2. writes a local `.json` record;
3. writes a local `.md` working note;
4. updates the local inbox index `data/family-core-inbox/README.md`;
5. marks it as `done` with the saved Markdown path.

The inbox files are written with local-user-only permissions and `data/family-core-inbox/` is ignored by Git.

`GET /status` includes `familyCoreWorker` so the phone screen can show whether the Mac worker is fresh, stale, degraded, or offline.
`GET /status` also includes `familyCoreInboxCount`.

Manual run:

```bash
npm run worker:family-core
```

One-shot check:

```bash
node scripts/family-core-worker.mjs --once
```

Whole-section status check:

```bash
npm run status:family-core
```

This read-only check verifies the local bridge, worker heartbeat, Mac Inbox summary, LAN `/share` entrypoint, private Sites publication, and current Windows PC visibility.

## Verification

Expected quick checks:

```bash
curl http://127.0.0.1:8791/health
curl http://192.168.1.198:8791/health
curl http://100.68.240.51:8791/health
npm test
```

The service should report `ag_bridge` version `0.6.0` or newer.

The test suite also checks the phone UI contract:

- one mobile viewport declaration;
- visible `v0.6.0` version;
- Family Core title, note, and send controls;
- local draft persistence;
- import of `title`, `text`, and `url` from the `/share` route into the local draft;
- Mac worker status from `/status`;
- saved Mac inbox summaries;
- a single polling timer;
- animated queue item transitions.
