---
name: browse
description: Drive a real browser to navigate, inspect accessibility state, interact, capture screenshots, or verify responsive behavior in the local dev app or another site.
allowed-tools: Bash(bin/browse:*), Bash(pnpm verify-help:*), Bash(pnpm --filter browse verify-help:*)
---

# browse

Use `bin/browse`, this repo's wrapper around the `agent-browser` Chromium CLI.
Never invoke `agent-browser` or `npx agent-browser` directly outside development
of `browse/` itself. Upstream commands pass through the wrapper.

## The core loop

```bash
bin/browse open /chats
bin/browse snapshot -i
bin/browse click bbx-nav-profile
bin/browse snapshot -i
```

- **Use only the app path:** `/chats` becomes
  `http://localhost:3210/<worktree>/<box>/chats`. `/test1/chats` doubles the box
  and can silently redirect to the wrong page. Absolute URLs pass unchanged.
- **Prefer the snapshot's `bbx-…` id.** It resolves with `getElementById` at
  action time. Use `@eN` only when no id is shown; refs renumber on snapshots,
  are not in document order, and can silently identify another control after
  a re-render. Re-snapshot after page changes; check `get url` if navigation
  looks wrong.
- **App actions have checks.** Missing, hidden, zero-size, off-screen, disabled,
  pointer-events-none, or covered targets are refused. A ref that changed hands
  between the last two snapshots gets a warning, not a refusal; refs on controls
  without a `bbx-` id get geometry checks only. Other origins pass through to
  upstream without these checks; upstream 0.27.0 reported `✓ Done` even when
  a click reached no actionable target. Verify the resulting state. Report
  refused/covered controls as evidence
  rather than bypassing the obstruction.
- **Transient state needs a different read.** Default `snapshot` waits for app
  readiness and can miss loading. Before testing loading/optimistic states or
  timing behavior, read [timing and recovery](references/timing-and-recovery.md).
  Discover refs while idle, then act and read with `get` or skip readiness with
  `--no-wait`.

## Worktree / box / port

The wrapper detects the worktree from `$PWD`, defaults to box `test1` and port
3210, and seeds the browse-key cookie from this checkout's `beebox/.env`.
`BROWSE_BOX` and `ROUTER_PORT` override the defaults per command.

Each worktree has isolated daemons/profiles under
`~/.cache/beebox/browse/<worktree>/`, backed by `AGENT_BROWSER_SOCKET_DIR` and
`AGENT_BROWSER_PROFILE`. Its auto-started browser dashboard URL is in
`bin/workstreams status` (`.worktrees[<wt>].dashboardUrl`) and the router home
page's dashboard link.

## Does it need the dev router?

Browser actions work without the router. Navigating or reloading a local
`localhost:3210` page needs it, like any HTTP destination. Do not start/restart
or `panic` the shared router from a worktree without asking the boxholder.

## Auth — why a navigation lands on the login page

On login redirects, 401/403, owner-only checks, or missing browse credentials,
read [authentication](references/authentication.md) before changing anything.
The browse key does not grant every router/box owner surface. Never reset global
credentials or opt a real box into owner browsing to bypass a refusal.

## Screenshots — what the sidecar buys

`bin/browse screenshot` saves an indexed `.claude/screenshots/NNNN-<slug>.png`
and a JSON sidecar with URL/title/time/worktree. Report the URL for visible
failures. Package useful UI evidence as one labeled exhibit and share its URL;
an incidental diagnostic screenshot needs no exhibit. Commands and sidecar
format: [command reference](references/commands.md#screenshots--what-the-sidecar-buys).

## Commands you'll actually use

Read the [command reference](references/commands.md) for navigation, selectors,
forms, viewports, waits, screenshot options, sessions, and upstream help.
For stale refs, slow captures, daemon failures, or cleanup, read
[timing and recovery](references/timing-and-recovery.md). When maintaining the
wrapper, the command reference also covers typed wrappers and help-drift checks.
