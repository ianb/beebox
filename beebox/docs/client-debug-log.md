# Client Debug Log

The frontend captures browser console errors/warnings and forwards them to the server. This is critical for debugging mobile issues where dev tools aren't available.

## How It Works

- `enableDebugLogCapture()` patches `console.error`, `console.warn`, `console.log`, and `console.info` at app startup (in `app-shell.tsx`)
- Also captures `window.onerror` and `unhandledrejection` events
- Errors and warnings are **always** forwarded to the server via the
  `debugLog.submit` tRPC mutation
- `log` and `info` are only forwarded when the debug panel is open

## Viewing Errors

### On the server (production at box.example.com)

**Log file** — each box has a rolling log at `.beebox/client-debug.log`:

```bash
# SSH to server and read the log
deploy/prod-ssh \
  cat /var/lib/beebox/<box-name>/box/.beebox/client-debug.log
```

**tRPC procedure** — `debugLog.get` returns the per-box in-memory ring buffer
(lost on server restart, max 200 entries). It's a normal owner/box-authed tRPC
query; the app's Debug Log panel and any tRPC client can read it. The rolling
**file above is the durable, restart-surviving record** and the primary way to
read logs off a running server.

The log file is plain text, one line per entry: `2024-01-15T10:00:00.000Z [error] message`. It auto-truncates at ~100KB.

## iOS native logging

The native companion app forwards its own `error`, `warn`, and selected `info`
entries (via `os.Logger` + `Services/LogForwarder.swift`) to the same
`debugLog.submit` sink, tagged `[ios]` so native and web entries are
distinguishable in one place. Info entries cover app scene phase, selected box,
web-view navigation, speech/response activity, and audio-session role
transitions; routine info is evicted before failures if the offline queue fills.

```
2026-08-03T12:00:04.000Z [error] [ios] capture: upload failed status=500 attempt=2
```

A queued entry can flush long after the incident it describes — the app persists
entries on-device and flushes on launch, foreground, two seconds after the first
new foreground entry in a burst, or a background best-effort attempt. An offline or killed
run's entries therefore land whenever the app next gets a chance to send them.
Each entry carries its own device-side `at`
timestamp for exactly this reason; once `at` drifts more than ~5s from the server's
receipt time, the log line tags both: `[ios@2026-08-03T09:00:00.000Z]`. Read the
bracketed time as when the incident actually happened, not the line's leading
timestamp (that's still receipt time). See `docs/mobile-contract.md` §5.7 for the
wire contract and `docs/implemented-plans/ios-log-forwarding.md` for the full design.

Browser media failures use the existing console forwarder. Playback diagnostics
include the operation plus labeled `MediaError`, `networkState`, and
`readyState` values instead of trying to serialize the opaque `Event` passed to
`audio.onerror`. The browser-standard symbolic name comes first and the raw
number remains in parentheses, for example:

```
[audio] operation=url mediaError=MEDIA_ERR_DECODE(3) networkState=NETWORK_LOADING(2) readyState=HAVE_METADATA(1)
```

Common native info messages are literal state transitions:

| Entry | Meaning |
|---|---|
| `lifecycle: scene phase=active` | The app entered the foreground. |
| `lifecycle: selected box id=<uuid>` | The visible paired box changed; no URL or credential is logged. |
| `webview: chat navigation started/finished` | A main-frame chat load began/completed; offline retries are deduplicated until success. |
| `audio: speech playback active=true/false` | The web chat reported that spoken-response playback started/stopped. |
| `lifecycle: response active=true/false` | The web chat reported an active/inactive response. |
| `audio: audio session role=recording/idle` | Native audio-session configuration successfully changed for capture/dictation or playback. |

These are diagnostic breadcrumbs, not a complete event stream. Absence of a
routine info line does not prove the corresponding feature never ran: info is
evicted before warnings/errors when the bounded offline queue fills.

### In the browser

- A red error badge appears in the nav bar when errors occur (shows count)
- Click the badge or open Profile menu > "Debug Log" to see the on-screen panel
- The panel shows all captured log entries with timestamps, filterable
- Opening the panel enables verbose forwarding (all log levels sent to server)

### During local development

```bash
# Read the rolling log file (the durable record)
cat ~/src/boxes/<box>/.beebox/client-debug.log
```

The in-memory ring buffer is read/cleared via the `debugLog.get` / `debugLog.clear`
tRPC procedures (from the app or a tRPC client), not a raw HTTP endpoint.

## Key Files

- `src/frontend/src/components/DebugLog.tsx` — console patching, server forwarding, panel UI
- `src/frontend/src/main/app-shell.tsx` — init capture, error badge, global panel rendering
- `src/webapp/trpc/routers/debug-log.ts` — `submit`/`get`/`clear` procedures, ring buffer, log file writing
- `src/lib/rolling-log.ts` — `appendRollingLogStrict` (used by `submit`, rejects on filesystem
  failure so a mobile client doesn't clear a queued entry it never durably sent) vs. the lenient
  `appendRollingLog` (used elsewhere, best-effort)

## Runtime lint

The frontend checks a few runtime invariants and reports a broken one as a
`[runtime-lint]` line (`src/frontend/src/lib/runtime-lint/`). Plan:
`docs/implemented-plans/runtime-lint.md`.

| Check | The invariant it reports broken |
|---|---|
| `content-replaced` | While a file's view stays open, its card body or an embed in it was unmounted and mounted again (`gapMs` between the two). |
| `fetch-storm` | One request (procedure and input) started more than 8 times in 10 s. |
| `refresh-failed` | An open card or file could not refresh (`phase=failed`, with `kind`), then recovered (`phase=recovered`, with `durationMs`). |
| `suppressed` | The budget dropped `n` records (one per check and subject a minute, 20 a minute in all). |

Records carry no card text, paths, or URLs: content and request inputs are
page-local ids (`c1`, `c2`, …) that mean nothing outside the page.

The client sends records as `debugLog.submit` batches with source
`runtime-lint`. The server writes them only on a dev box (`devSurfaces`) or
when it runs with `BBX_RUNTIME_LINT=1`; elsewhere it drops them. In the log
they read `… [warn] [runtime-lint] content-replaced surface=card-body content=c1 gapMs=0`.

The page also keeps its unread records at `window.__bbxRuntimeLint`.
`bin/browse` takes them after each page command and prints them to stderr as
`runtime-lint: <check> k=v …`, so an agent checking UI sees the command that
broke an invariant.
