# Command reference

```bash
# Navigation
bin/browse open /chats                          # → http://localhost:3210/<wt>/<box>/chats
bin/browse open /test1/chats                    # WRONG — doubles the box, lands elsewhere silently
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

# Acting — a bbx- id, a @eN ref, or a CSS/XPath selector, in every target slot
bin/browse click bbx-nav-profile
bin/browse click @e3                            # ref: only when the snapshot line shows no id
bin/browse fill bbx-composer-input "hello"
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

- Worktree is detected from `$PWD`: `/beebox-worktrees/<name>/` → `<name>`; main checkout → `main`.
- Box defaults to `test1`. Override per command: `BROWSE_BOX=other-box bin/browse open /`.
- Port defaults to `3210`. Override: `ROUTER_PORT=4000 bin/browse open /`.

First request to a worktree spins up Vite + a `bbx hub` (~4s cold); the hub then lazy-starts the specific box's `bbx serve` child on its first request. Subsequent calls are fast. The dev router lazy-shuts idle worktrees after 5 minutes.

## Screenshots — what the sidecar buys

Every `bin/browse screenshot` writes `<image>.json`:

```json
{
  "url": "http://localhost:3210/nav-refactor/test1/chats",
  "title": "Chats — Bee Box",
  "timestamp": "2026-05-26T22:58:26.388Z",
  "takenInWorktree": "nav-refactor"
}
```

Report the sidecar's URL when a screenshot shows a visible error; it identifies
where the user can reproduce it. Do not dismiss the failure as out of scope.

The sidecar makes an individual capture self-describing to an agent; it does
not make a list of file paths a good human handoff. When screenshots are the
evidence for UI work, package the useful set with `bin/exhibits add` and share
the exhibit URL. Give the exhibit prose/captions enough context to distinguish
before/after and each state or viewport. Use `--ask fyi` for evidence that asks
nothing of the developer; choose another ask only when you genuinely need it.
An incidental diagnostic screenshot does not need an exhibit.

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

Each session gets its own Chrome profile under this worktree's browse cache
(`profiles/<name>`), so sessions really do run at the same time — Chrome holds
an exclusive lock on a profile and refuses to open one another instance owns.
A new session therefore starts with an empty cookie jar; the browse key is
re-seeded on its first own-origin `open`, but any login or app state you set up
in one session is not visible in another.
