# Client Debug Log

The frontend captures browser console errors/warnings and forwards them to the server. This is critical for debugging mobile issues where dev tools aren't available.

## How It Works

- `enableDebugLogCapture()` patches `console.error`, `console.warn`, `console.log`, and `console.info` at app startup (in `app-shell.tsx`)
- Also captures `window.onerror` and `unhandledrejection` events
- Errors and warnings are **always** forwarded to the server via `POST /api/debug-log`
- `log` and `info` are only forwarded when the debug panel is open

## Viewing Errors

### On the server (production at box.example.com)

**Log file** — each box has a rolling log at `.callback-box/client-debug.log`:

```bash
# SSH to server and read the log
ssh root@$(cat deploy/server-ip) \
  cat /home/callback/boxes/<box-name>/.callback-box/client-debug.log
```

**API endpoint** — `/api/debug-log` returns the in-memory ring buffer. In production it sits behind Google OAuth cookie auth, so `curl` without a browser cookie is rejected unless you use the diagnostic-key bypass:

```bash
# CB_DIAG_API_KEY lives in /home/callback/.env on the server; fetch it with:
#   CB_DIAG_API_KEY=$(deploy/ssh-server.sh "grep CB_DIAG_API_KEY /home/callback/.env | cut -d= -f2")
curl -H "Authorization: Bearer $CB_DIAG_API_KEY" \
  https://box.example.com/<box-name>/api/debug-log | python3 -m json.tool

# Just the errors:
curl -s -H "Authorization: Bearer $CB_DIAG_API_KEY" \
  https://box.example.com/<box-name>/api/debug-log | \
  python3 -c "import sys,json; [print(e['ts'],e['message']) for e in json.load(sys.stdin)['entries'] if e['level']=='error']"
```

The bypass applies only to GET `/api/debug-log` and `/api/trpc/health.check`. On localhost (no `GOOGLE_OAUTH_CLIENT_ID` set) all auth is disabled and curl works without the header.

The log file is plain text, one line per entry: `2024-01-15T10:00:00.000Z [error] message`. It auto-truncates at ~100KB.

The API endpoint returns in-memory entries (lost on server restart, max 200). The log file persists across restarts.

### In the browser

- A red error badge appears in the nav bar when errors occur (shows count)
- Click the badge or open Profile menu > "Debug Log" to see the on-screen panel
- The panel shows all captured log entries with timestamps, filterable
- Opening the panel enables verbose forwarding (all log levels sent to server)

### During local development

```bash
# Read in-memory logs
curl http://localhost:3210/<box>/api/debug-log | python3 -m json.tool

# Read log file
cat ~/src/boxes/<box>/.callback-box/client-debug.log

# Clear in-memory logs
curl -X DELETE http://localhost:3210/<box>/api/debug-log
```

## Key Files

- `src/frontend/src/components/DebugLog.tsx` — console patching, server forwarding, panel UI
- `src/frontend/src/app-shell.tsx` — init capture, error badge, global panel rendering
- `src/webapp/routes/api.ts` — server endpoints, log file writing
