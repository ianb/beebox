# Timing and recovery

## Transient state observations

A default `snapshot` waits for app requests to settle, so `click` followed by
`snapshot` can miss a loading skeleton, spinner, or optimistic row and produce a
false negative. `click` and `get` return without that readiness wait.

**To observe a transient, read with `get`, not `snapshot`:**

```bash
bin/browse click @e5                      # returns immediately
bin/browse get text "[role=menu]"         # what's on screen RIGHT NOW
```

You still need `snapshot -i` to *discover* refs — take it before the click,
while the page is idle, then act and read with `get`.

The wait is bounded and app-only: it runs only when the page is this
worktree's own origin (nothing else sets the `data-bbx-loading` marker), gives
up after 15s with a note on stderr and captures anyway, and `--no-wait` skips
it outright. `BROWSE_READY_TIMEOUT_MS` raises the ceiling for a genuinely slow
page.

If every arm of a timing experiment looks identical and settled, suspect the
probe: run the arm you expect to fail first, and trust a pass only after that.

## Common failure modes

- **"BROWSE_REPO_DIR is not set"** — you invoked `tsx browse/src/cli.ts` directly. Use `bin/browse`.
- **"tsx not found in browse/node_modules"** — run `pnpm install` in `browse/`.
- **First request hangs ~4s** — cold start for the worktree's dev server. Normal.
- **`browse: @e8 may be stale — …`** — that number meant something else in the snapshot before last. If the action's effect is not what you expected, that is why; act by id where the line shows one.
- **`✗ … refused: covered — … is under …`** — something (an overlay, a toast, a menu) sits on top of the control. That is usually a real finding about the app; report it rather than working around it.
- **`browse: page has no window.__bbxUiScan`** — the frontend on this page predates the hook (or it is not the app). Ids are not shown; refs still work.
- **`text=…` and XPath targets say "Element not found"** even when the element is there — upstream's CDP engine does not resolve those forms (0.27.0), whatever its `--help` says. Use a `bbx-` id, a ref, or CSS.
- **Refs from a prior snapshot don't work** — page changed (navigation, viewport, dialog). Re-snapshot.
- **You land on `/auth/login`** — work [authentication](authentication.md) in order. Usually a box slug written into the path, or a request for an owner-session-only surface — not a bad key.
- **You navigated somewhere you didn't ask for** — check `bin/browse get url` before concluding anything about the page. A path that resolves to no route redirects rather than erroring, so a typo reads as "the app is behaving strangely."
- **`screenshot` times out while `eval` and `snapshot` respond** — on macOS the display is often asleep, which stalls every capture, even on a fresh daemon. `caffeinate -u -t 2` wakes it; wrap a long capture run in `caffeinate -d <command>`. Otherwise check non-visual state with `eval` or `snapshot` and report the visual check as not done.
- **`Resource temporarily unavailable (os error 35)`, or a stray Chrome eating CPU** — `close --all` does not clear a wedged daemon. `bin/workstreams panic` reclaims project-scoped daemons but affects the shared router: **ask the boxholder before using it from a worktree.** Otherwise kill this worktree's daemon (its binary under this worktree's `node_modules/agent-browser/`) and its Chrome by PID, after confirming each PID belongs to this task and not another live session; never a broad process-name kill.
