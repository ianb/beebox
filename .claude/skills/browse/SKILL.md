---
name: browse
description: Use when you need to drive a real browser — navigating pages, snapshotting the a11y tree, clicking, filling forms, taking screenshots, or checking responsive behavior, on the local dev app or any other site.
allowed-tools: Bash(bin/browse:*), Bash(pnpm verify-help:*), Bash(pnpm --filter browse verify-help:*)
---

# browse

`bin/browse` is this monorepo's wrapper around the upstream `agent-browser` Chromium CLI. It adds:

- **Worktree-aware URL rewriting** — `bin/browse open /dashboard` resolves to `http://localhost:3210/<this-worktree>/<box>/dashboard`. **The worktree and box are added for you — write the app path only.** `open /test1/chats` doubles the box and silently lands on some other page instead of erroring.
- **Authenticated navigation** — it seeds the browse-key cookie so pages, fetches, and the WebSocket all carry one credential. See [Auth](#auth-why-a-navigation-lands-on-the-login-page) when you hit a login page.
- **Per-worktree isolated daemons** — each worktree runs its own `agent-browser` daemon with its own Chrome profile (cookies, history, login state). No cross-worktree leakage. Backed by `AGENT_BROWSER_SOCKET_DIR` and `AGENT_BROWSER_PROFILE` env vars rooted at `~/.cache/callback-box/browse/<worktree>/`.
- **Per-worktree dashboard** — the dev router auto-starts an `agent-browser dashboard` per worktree on its own port. Find the URL via `bin/workstreams status` (`.worktrees[<wt>].dashboardUrl`) or the "dashboard ↗" link on the router home page at `http://localhost:3210/`.
- **Self-describing screenshots** — `bin/browse screenshot` writes a sidecar `<image>.json` with the URL/title/timestamp/worktree so the file alone tells you what it captured.
- **Indexed default path** — `bin/browse screenshot` with no path saves to `.claude/screenshots/NNNN-<slug>.png` in the worktree (gitignored).

Everything else passes straight through to the upstream binary. Source: `browse/` at the monorepo root. Never invoke `agent-browser` or `npx agent-browser` directly — use `bin/browse`.

## Does it need the dev router?

Almost never. `bin/browse` drives whatever Chrome instance the daemon owns; it doesn't care about the dev router's state. `snapshot`, `eval`, `click`, `fill`, `screenshot`, `get`, `wait`, viewport, tabs — all work whether the router is up, down, or never existed. The only thing that touches the router is the actual HTTP fetch when you navigate to a `localhost:3210` URL (`open /path`, `reload`) — and that fails the same way any other unreachable URL would.

If you find yourself thinking "I need to start `pnpm dev` to use `bin/browse`," you don't — unless your next step is a fresh navigation to the local dev app.

## The core loop

```bash
bin/browse open /                 # 1. Open a page (leading / → worktree router URL)
bin/browse snapshot -i            # 2. See interactive elements — each shows a ref, and an id when it has one:
                                  #      - button "User" [expanded=false, ref=e8, id=cb-nav-profile]
bin/browse click cb-nav-profile   # 3. Act BY ID when the line shows one; by ref (@e8) only when it doesn't
bin/browse snapshot -i            # 4. Re-snapshot after the page changes
```

**Prefer the id.** `cb-…` ids are the app's own stable control addresses
(`callback-box/src/frontend/src/lib/ui-scan/resolve.ts`): resolved by
`getElementById` at the moment you act, so a re-render between snapshot and
action cannot retarget them. `@eN` refs are upstream's positional handles —
**renumbered on every snapshot, and not in document order** (an open menu takes
`e2–e6` and the nav buttons move to `e12+`). A ref whose number still exists
after a re-render is not an error upstream; it just names a different element.

**Every action is checked before it is sent.** On the app's own pages the wrapper
refuses — `✗ click cb-composer-send refused: disabled — …`, exit 1 — when the
target is missing, hidden, zero-size, off-screen, disabled, `pointer-events:
none`, or covered by another element. A `@eN` whose number changed hands
between your last two snapshots gets a stderr warning naming both (the tool
cannot know which snapshot you read it from, so it warns rather than refuses —
the id needs no warning). Upstream alone reports `✓ Done` in
every one of those cases (measured on 0.27.0 — it is a box-center mouse event
with no preconditions), which is how a driver ends up "clicking" a heading and
concluding the app ignored it. A `@eN` ref on a control with no `cb-` id gets
only the geometry checks; the wrapper says so on stderr. Off the app (any other
origin), everything passes through to upstream unchanged.

## Commands you'll actually use

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

# Acting — a cb- id, a @eN ref, or a CSS/XPath selector, in every target slot
bin/browse click cb-nav-profile
bin/browse click @e3                            # ref: only when the snapshot line shows no id
bin/browse fill cb-composer-input "hello"
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

## `snapshot` waits for the network; `click` and `get` don't

This is not in the upstream `--help`, and it will silently ruin any attempt to
observe a **transient** UI state — a loading skeleton, a spinner, an optimistic
row, anything that exists only while a request is in flight.

Measured against a deliberately slowed endpoint (a 20-second query), from one
page, in one session:

| command | returned in |
|---|---|
| `click @e5` (fires the request) | 0.49s |
| `snapshot` | 16.2s — **blocked until the request settled** |
| `get text "[role=menu]"` | 0.46s |

So the default loop — `click` then `snapshot` — cannot see a loading state. The
snapshot waits out the very thing you're trying to catch and hands you the
settled page, which reads as "there was never a loading state." That is a false
negative, and a convincing one: it looks like the feature works.

**To observe a transient, read with `get`, not `snapshot`:**

```bash
bin/browse click @e5                      # returns immediately
bin/browse get text "[role=menu]"         # what's on screen RIGHT NOW
```

You still need `snapshot -i` to *discover* refs — take it before the click,
while the page is idle, then act and read with `get`.

The wait is bounded and app-only: it runs only when the page is this
worktree's own origin (nothing else sets the `data-cb-loading` marker), gives
up after 15s with a note on stderr and captures anyway, and `--no-wait` skips
it outright. `BROWSE_READY_TIMEOUT_MS` raises the ceiling for a genuinely slow
page.

A corollary worth internalizing: if you are timing something and every arm of
your experiment comes back looking identical and suspiciously settled, suspect
the instrument before the code. Confirm your probe can produce a negative
result at all — run the arm you expect to *fail* first, and only trust the
passing arm once the failing one has actually failed.

## Worktree / box / port

- Worktree is detected from `$PWD`: `/callback-worktrees/<name>/` → `<name>`; main checkout → `main`.
- Box defaults to `test1`. Override per command: `BROWSE_BOX=other-box bin/browse open /`.
- Port defaults to `3210`. Override: `ROUTER_PORT=4000 bin/browse open /`.

First request to a worktree spins up Vite + a `cb hub` (~4s cold); the hub then lazy-starts the specific box's `cb serve` child on its first request. Subsequent calls are fast. The dev router lazy-shuts idle worktrees after 5 minutes.

## Auth — why a navigation lands on the login page

Dev auth is always on: every TCP request to the router authenticates. `bin/browse` handles this for you by reading `CB_BROWSE_API_KEY` from this checkout's gitignored `callback-box/.env` and seeding it as a cookie in the worktree's isolated Chrome profile. When it works you never think about it.

When you land on `/auth/login`, work through these in order. **The first two are far more common than a bad key**, so check them before touching credentials.

**1. Did you write the box slug into the path?** `open /test1/chats` becomes `/<wt>/test1/test1/chats`, which resolves to no route. You get redirected somewhere plausible rather than an error. Write `open /chats`.

**2. Are you asking for something the key doesn't grant?** The browse key authenticates **box routes** and the **read-only dev surfaces**. It does *not* grant the router's control surfaces:

| path | what authenticates it |
|---|---|
| `/<wt>/<box>/…` | browse key ✅ |
| `/<wt>/dev/…` (GET/HEAD) | browse key ✅ |
| `/workstreams/…` (GET/HEAD) | browse key ✅ |
| `/` (worktree index) | owner session only |
| `/__router/…` (control routes) | owner session only |
| `/workstreams/…` (POST — actions, tRPC mutations) | owner session + same-origin |

The dev surfaces were owner-only until 2026-08-24, which made every issue *about* them boxholder-only to verify. They are reads from disk with no write path, so the browse key now carries them (`dev-read` in `bin/router-auth.ts`). The control routes above deliberately did not move.

Note `/<wt>/dev/docs/…` is a 301 to `/workstreams/browse?file=…` — the doc browser retired into the general browser. Follow the redirect; both ends accept the key.

A navigation denied at the owner-only rows returns 401, which the router renders as the login page — so "I got the login page" does not by itself mean your key is wrong.

### The key is the owner only on a box that says so

The browse key clears the auth wall. What it *means* inside a box is the box's
call: a box whose `config/box.json` has `"agentBrowsing": "owner"` treats the key
as the box owner — capture, device pairing, Settings, anything behind
`ownerProcedure`, and chat sends attributed to the owner. `test1` sets it, so
every worktree clone and journey box built from it does too. The one exception
is the Secrets panel (`authenticatedOwnerProcedure`): the secret store is
machine-level, so no box's opt-in reaches it.

On a box **without** the field — `personal-test`, any box a person uses — the
key is nobody: you get **403 "Owner access required"** on owner surfaces and
**401** on capture. That is the fence working, not a key problem. Do not add
the field to such a box to get past it; if a check genuinely needs the owner
there, log in as a person:

```bash
bin/browse auth save owner --url /auth/login --username <email> --password-stdin
bin/browse auth login owner
```

**Ask the boxholder for the credential** — do not invent one, and do not reach for
`cb auth set-password`, which rewrites a machine-global credential store and revokes
live sessions (`callback-box/CLAUDE.md`). If you cannot get one, say which findings
were unreachable rather than reporting them as absent features.

Mechanism: `callback-box/docs/plans/agent-browsing-owner.md`.

**3. Is the key live in the running router?** One probe answers it, and it must use the **cookie** form against a **box route**:

```bash
KEY=$(grep '^CB_BROWSE_API_KEY=' callback-box/.env | cut -d= -f2-)
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Cookie: cb_browse_key=$KEY" http://localhost:3210/main/test1/
# 200 → the router has this key. 401 → it doesn't.
```

**Do not probe with `Authorization: Bearer`.** The router's gate accepts the key only as a cookie and returns 401 for a bearer header *even when the key is correct* — so a bearer probe produces a false "the key is rejected" every time. (`core/browse-key.ts` documents both forms because the box wall and hub accept both; the dev router does not.)

**4. Does this worktree's `.env` have the key at all?** The WorktreeCreate hook copies main's `.env` into new worktrees, but worktrees created before that existed don't have it:

```bash
grep -c '^CB_BROWSE_API_KEY=' callback-box/.env    # 0 means that's your problem
grep -v '^BOXES=' ../../callback-box/callback-box/.env > callback-box/.env
```

Copy it **minus `BOXES=`** — that line points at the real boxes, and a worktree that inherits it serves those instead of its own clone.

**5. Only then suspect the value.** The key is machine-wide: one router fronts every worktree, and it loads main's `.env` **at startup**. A worktree with a different key passes its own children and is refused at the router; a key edited after the router started needs a `pnpm dev` restart, which is the boxholder's call — never restart the shared router from a worktree session.

A one-off override without touching any file: `CB_BROWSE_API_KEY=… bin/browse open /`.

**No key set at all is not an error.** browse proceeds unauthenticated and you land on the login page — which is the honest signal, not a malfunction.

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

## Common failure modes

- **"BROWSE_REPO_DIR is not set"** — you invoked `tsx browse/src/cli.ts` directly. Use `bin/browse`.
- **"tsx not found in browse/node_modules"** — run `pnpm install` in `browse/`.
- **First request hangs ~4s** — cold start for the worktree's dev server. Normal.
- **`browse: @e8 may be stale — …`** — that number meant something else in the snapshot before last. If the action's effect is not what you expected, that is why; act by id where the line shows one.
- **`✗ … refused: covered — … is under …`** — something (an overlay, a toast, a menu) sits on top of the control. That is usually a real finding about the app; report it rather than working around it.
- **`browse: page has no window.__cbUiScan`** — the frontend on this page predates the hook (or it is not the app). Ids are not shown; refs still work.
- **`text=…` and XPath targets say "Element not found"** even when the element is there — upstream's CDP engine does not resolve those forms (0.27.0), whatever its `--help` says. Use a `cb-` id, a ref, or CSS.
- **Refs from a prior snapshot don't work** — page changed (navigation, viewport, dialog). Re-snapshot.
- **You land on `/auth/login`** — work [Auth](#auth-why-a-navigation-lands-on-the-login-page) in order. Usually a box slug written into the path, or a request for an owner-session-only surface — not a bad key.
- **You navigated somewhere you didn't ask for** — check `bin/browse get url` before concluding anything about the page. A path that resolves to no route redirects rather than erroring, so a typo reads as "the app is behaving strangely."
- **A stray Chrome is eating CPU after a session ends** — `bin/workstreams panic` reclaims agent-browser's tracked daemons. It matches the daemon binary under `node_modules/agent-browser/`, so a Chrome launched by hand from `~/.agent-browser/browsers/` is invisible to it and must be killed with `ps` + `kill`. Another reason to drive through `bin/browse` rather than the browser binary.
