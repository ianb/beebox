---
name: browse
description: Drive a Chromium browser. Use for any browser task — navigating pages, snapshotting a11y tree, clicking, filling forms, taking screenshots, checking responsive behavior, on the local dev app or any other site. Independent of the dev router: `snapshot`, `click`, `eval`, etc. drive Chrome directly and don't care whether the router is up. As a convenience, `bin/browse open /path` rewrites leading-slash paths to this worktree's router URL — but only that one rewrite touches the router, everything else is just Chromium. Screenshots include a JSON sidecar with URL/title/timestamp so they're self-describing.
allowed-tools: Bash(bin/browse:*), Bash(pnpm verify-help:*)
---

# browse

`bin/browse` is this monorepo's wrapper around the upstream `agent-browser` Chromium CLI. It adds:

- **Worktree-aware URL rewriting** — `bin/browse open /dashboard` resolves to `http://localhost:3210/<this-worktree>/<box>/dashboard`.
- **Per-worktree isolated daemons** — each worktree runs its own `agent-browser` daemon with its own Chrome profile (cookies, history, login state). No cross-worktree leakage. Backed by `AGENT_BROWSER_SOCKET_DIR` and `AGENT_BROWSER_PROFILE` env vars rooted at `~/.cache/callback-mono/browse/<worktree>/`.
- **Per-worktree dashboard** — the dev router auto-starts an `agent-browser dashboard` per worktree on its own port. Find the URL via `bin/worktrees status` (`.worktrees[<wt>].dashboardUrl`) or the "dashboard ↗" link on the router home page at `http://localhost:3210/`.
- **Self-describing screenshots** — `bin/browse screenshot` writes a sidecar `<image>.json` with the URL/title/timestamp/worktree so the file alone tells you what it captured.
- **Indexed default path** — `bin/browse screenshot` with no path saves to `.claude/screenshots/NNNN-<slug>.png` in the worktree (gitignored).

Everything else passes straight through to the upstream binary. Source: `browse/` at the monorepo root. Never invoke `agent-browser` or `npx agent-browser` directly — use `bin/browse`.

## Does it need the dev router?

Almost never. `bin/browse` drives whatever Chrome instance the daemon owns; it doesn't care about the dev router's state. `snapshot`, `eval`, `click`, `fill`, `screenshot`, `get`, `wait`, viewport, tabs — all work whether the router is up, down, or never existed. The only thing that touches the router is the actual HTTP fetch when you navigate to a `localhost:3210` URL (`open /path`, `reload`) — and that fails the same way any other unreachable URL would.

If you find yourself thinking "I need to start `pnpm dev` to use `bin/browse`," you don't — unless your next step is a fresh navigation to the local dev app.

## The core loop

```bash
bin/browse open /            # 1. Open a page (leading / → worktree router URL)
bin/browse snapshot -i       # 2. See interactive elements with @e1, @e2, ... refs
bin/browse click @e3         # 3. Act on refs
bin/browse snapshot -i       # 4. Re-snapshot — refs are stale after page change
```

**Refs become stale on any page change** (navigation, dynamic re-render, dialog open, viewport change). Always re-snapshot before the next ref interaction.

## Commands you'll actually use

```bash
# Navigation
bin/browse open /chats                          # → http://localhost:3210/<wt>/<box>/chats
bin/browse open https://example.com             # bare URL passes through unchanged
bin/browse back / forward / reload

# Reading
bin/browse snapshot -i                          # interactive elements only (preferred)
bin/browse snapshot -i -u                       # include href URLs on links
bin/browse snapshot -i -s "#main"               # scope to a CSS selector
bin/browse snapshot -i --json                   # machine-readable
bin/browse get text @e5
bin/browse get url                              # current page URL
bin/browse get title

# Acting
bin/browse click @e3
bin/browse fill @e2 "user@example.com"
bin/browse type @e2 " more text"                # type without clearing
bin/browse press Enter
bin/browse press Control+a

# Responsive checks
bin/browse set viewport 375 800                 # mobile
bin/browse set viewport 1280 800                # back to desktop
bin/browse set device "iPhone 12"

# Screenshots (this monorepo's version — adds sidecar + default indexed path)
bin/browse screenshot                           # → .claude/screenshots/0001-shot.png + .json
bin/browse screenshot --slug nav-mobile         # → 0002-nav-mobile.png
bin/browse screenshot /tmp/x.png                # explicit path (still gets x.png.json sidecar)
bin/browse screenshot --full                    # full scroll-height
bin/browse screenshot --annotate                # numbered overlays mapped to @eN refs

# Waiting (important — flaky scripts come from bad waits, not bad selectors)
bin/browse wait @e1                             # until element appears
bin/browse wait --text "Success"                # until text appears
bin/browse wait --url "**/dashboard"            # until URL matches glob
bin/browse wait --load networkidle              # post-navigation catch-all

# Lifecycle
bin/browse close                                # close this browser
bin/browse close --all                          # close every session
```

## Worktree / box / port

- Worktree is detected from `$PWD`: `/callback-worktrees/<name>/` → `<name>`; main checkout → `main`.
- Box defaults to `test1`. Override per command: `BROWSE_BOX=other-box bin/browse open /`.
- Port defaults to `3210`. Override: `ROUTER_PORT=4000 bin/browse open /`.

First request to a worktree spins up Vite + Fastify (~4s cold). Subsequent calls are fast. The dev router lazy-shuts idle worktrees after 5 minutes.

## Screenshots — what the sidecar buys

Every `bin/browse screenshot` writes `<image>.json`:

```json
{
  "url": "http://localhost:3210/nav-refactor/test1/chats",
  "title": "Chats — Callback Box",
  "timestamp": "2026-05-26T22:58:26.388Z",
  "takenInWorktree": "nav-refactor"
}
```

Two reasons this matters:

1. **The user can `open` the file later and know exactly what they're looking at** — no need to dig through chat history for the URL.
2. **When a screenshot shows an error state ("Failed to load", broken UI), report the URL from the sidecar to the user.** They can browse there themselves to see whether it repros. Don't dismiss visible errors as out-of-scope.

## Escape hatch — anything not covered here

Pass it through. `bin/browse <whatever>` works for every upstream subcommand. For a full reference of what's available upstream:

```bash
# (Don't invoke directly outside development of browse/ itself.)
node_modules/agent-browser/bin/agent-browser-darwin-arm64 --help               # full command list
node_modules/agent-browser/bin/agent-browser-darwin-arm64 <command> --help     # one command
```

If a subcommand isn't documented here but you use it more than twice, consider adding a typed wrapper at `browse/packages/agent-browser-typed/src/commands/`.

## Verifying upstream hasn't drifted

`pnpm --filter browse verify-help` (or in `browse/`, `pnpm verify-help`) compares checked-in `--help` snapshots at `browse/packages/agent-browser-typed/help/` against the installed binary. On drift, it reports per-command diffs and exits non-zero. **Treat any drift as a signal to also update the typed declarations** in `browse/packages/agent-browser-typed/src/commands/` — flags may have been added, removed, or renamed. After updating types, run `pnpm verify-help --update` to refresh the snapshots in the same commit.

## Multiple browser sessions

Each `--session <name>` is an isolated browser:

```bash
bin/browse --session a open /
bin/browse --session b open /
bin/browse --session a fill @e3 "alice@test.com"
bin/browse --session b fill @e3 "bob@test.com"
```

## Common failure modes

- **"BROWSE_REPO_DIR is not set"** — you invoked `tsx browse/src/cli.ts` directly. Use `bin/browse`.
- **"tsx not found in browse/node_modules"** — run `pnpm install` in `browse/`.
- **First request hangs ~4s** — cold start for the worktree's dev server. Normal.
- **Refs from a prior snapshot don't work** — page changed (navigation, viewport, dialog). Re-snapshot.