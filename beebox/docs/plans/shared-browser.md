---
title: "Shared browser: one web browser per box that the agent and the person both use"
status: active
workstream: shared-browser
issues: []
---
# Shared browser

Each box gets one web browser session. The box agent drives it with `bbx browser`. The person opens the same session on a desktop through a "Browser" menu item and uses it to log in, set up accounts, and get past checks that stop the agent. The browser is the upstream `agent-browser` tool (Apache-2.0) and its bundled dashboard; beebox builds no viewer. Research and the decisions that led here: [research/embedded-browser/](../../../research/embedded-browser/README.md).

**Issues addressed:** none closed. Related:

- `issues/features/2026-06-12-agent-browser-scoped-to-box.md` (workstream `shared-browser`): the box agent looks at its own box's pages. This plan gives the agent a browser but not a box credential inside it; that half stays open (see NOT in scope).
- `issues/exploration/2026-10-29-shared-browser-site-probe.md`: which sites block the server IP. Decides later whether the browser should run on the person's network.
- `private-issues/security/2026-10-29-box-user-network-egress-unfiltered.md`: box users have no egress filter. Track F closes the browser's path to host loopback; the rest of that issue stays open.
- `issues/features/2026-10-29-box-agent-cannot-see-its-own-visual-work.md`: a server-side browser is one of its directions; not resolved here.

Searched the queue for `browser`, `chromium`, `captcha`, `login`, `agent-browser`, `dashboard`: no duplicate of a shared agent-and-person browser.

## Design

### Situations

- When I ask the box to compare dishwasher prices and one shop shows "verify you are human", I want to click through the check myself in the browser the agent is using, so the agent can finish the comparison without starting over.
- When I want the agent to check my library holds every week, I want to log in to the library site once in the box's browser, so the agent can look later without asking me for the password.
- When the agent is filling in a long form for me (a permit application), I want to watch it and fix a field it got wrong by typing the correction, so the form goes in right.
- When I am in the car on my phone and the agent says it is stuck at a login, I do not want a remote browser on a phone screen; I want the request to wait in chat until I am at a computer.
- When the agent only needs to read a public page, I do not want to be involved at all.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Agent stuck at a check or login | Show: the agent says what it needs in the chat turn and stops | Chat, the current conversation; the Browser menu item | Waits to be found (the chat reply is the existing signal; no push notification) |
| Person wants to log in ahead of time | Show on request | Profile menu, "Browser" item, opens a new tab | Waits to be found |
| Person watches or corrects a form | Show on request | Same Browser tab, open beside chat | Background while open |
| Person on a phone | Quiet | The chat message stays; the Browser item works but is not designed for touch | Waits until desktop |
| Agent reads a public page | Quiet | No surface; the agent uses `bbx browser` | Background |

The menu item is the only new entry point. The agent never opens the browser on the person's screen and never sends a notification for it: an interruption needs a reason the person would give, and "I am stuck" already arrives as the agent's chat reply.

### Spirit

- **Serves:** "You should be able to see the gears": the person watches the same page the agent works on, with the agent's commands listed beside it in the dashboard's activity feed.
- **Risks:** "It should feel like a place": the dashboard is a developer tool with Console, Network and Storage panes, so it does not look like the rest of the box. Guard: it opens in its own tab under the box's address with the box's name in the menu; restyling it is out of scope.

### Trust

- Reading pages starts **automatic**: the agent browses public pages without asking.
- Acting in a logged-in account (send, post, buy, delete, change settings) starts as **confirmation**: box guidance tells the agent to say what it is about to do in chat and wait for a yes. This plan adds no code gate; it is guidance, like other consequential actions. A person's standing instruction ("you can always renew my library books") moves one site's action up, recorded the existing way for learned trust (`docs/questions.md`, the `learning:` field).
- Logging in is never the agent's: the agent does not type the person's passwords. The person logs in in the Browser tab.

### When it goes wrong or does nothing

- **No browser installed** (a Docker install, or a host where the deploy has not installed Chromium yet): `bbx browser` exits with "This box has no browser installed: <reason>", and the menu item opens a page with the same sentence. The agent tells the person in plain words.
- **The browser crashed or idled out:** the next `bbx browser` call or menu click starts it again with the same profile, so logins survive. The page shows the dashboard's own "Waiting for frames" state for a few seconds.
- **A site blocks the server's address:** the person sees the block page in the Browser tab, the same as the agent. The agent says the site refused the server and does not retry in a loop.
- **Nothing to do:** the menu item still opens a live browser on a blank page.

### Walkthrough

Priya asks in chat: "Find the cheapest price for the Bosch 300 dishwasher at the three big shops." The agent runs `bbx browser open https://shop-a.example/...`. The engine starts the box's browser (first use today), and the command prints the page title. The agent runs `bbx browser snapshot -i`, reads the prices, and moves to shop B, which shows a "verify you are human" page. The agent replies in chat: "Shop B is showing a human check. Open Browser from the menu (top right), click through the check, then tell me to continue." Priya, at her laptop, opens the menu, clicks Browser, and a new tab shows shop B's check page live. She clicks the checkbox, sees the product page, and types "done" in chat. The agent runs `bbx browser snapshot -i` again and finishes the comparison. Left behind: the shop B clearance cookie in the box's browser profile (outside the box's git repository) and the chat transcript. Nothing is committed to the box.

## Smallest fix and budget

**Smallest fix:** add `agent-browser` as a beebox dependency and tell the box agent to run it, with the dashboard on a loopback port that the person reaches over an SSH tunnel. It fails the ask: a person cannot reach the dashboard through the app, and on the production server any other box could drive this box's browser (see Failure modes, cross-box ports).

**Chosen tracks** (estimates are changed source and test lines, additions plus deletions):

| Track | Source | Tests |
|---|---|---|
| A. Dependency and pinned upstream contract | 30 | 60 |
| B. Browser host (paths, process, relay) | 300 | 220 |
| C. Engine routes (proxy with path rewriting, WebSocket bridge, exec) | 330 | 300 |
| D. `bbx browser` CLI | 110 | 80 |
| E. Browser menu item and "not installed" page | 40 | 30 |
| F. Production: private network per box, Chromium install, AppArmor | 200 | 80 |
| Total | 1,010 | 770 |

About 1,800 changed lines; under the BIG CHANGE line. Authored documentation, about 250 lines: the box command doc entry, a box skill, the guide pointer and ledger row, `docs/server/` notes, security report rows, `ACKNOWLEDGEMENTS.md`. Generated output: the refreshed help snapshots in `browse/packages/agent-browser-typed/help/` after the version bump.

What the fuller design buys over the smallest fix: a same-origin path through beebox's existing login (Track C), and isolation between boxes on the production server (Track F). Both are required by stated rules, below.

## Stated preferences this plan trades against

- **Boxholder decisions (2026-10-29), recorded in [research/embedded-browser/README.md](../../../research/embedded-browser/README.md#boxholder-direction-2026-10-29):** desktop only; no beebox-built viewer; no image per box; no arbitration of who is clicking; production isolation by a private network per box (`pasta`). The plan proxies and rewrites the upstream dashboard instead of writing a viewer, which costs a pinned version and a rewrite rule that can break on upgrade (Failure modes).
- **Cross-box isolation is zero-exception.** `docs/security-report.md:546`: *"every path input in the route and tRPC inventory (§1) is bounded by a containment helper — must be **zero** exceptions"*. agent-browser listens on loopback TCP, reachable by every Unix user on the host. Track F exists because of this rule.
- **Engineering principles** (`docs/engineering-principles.md`): **3** (validate at boundaries: the exec route filters agent arguments; the rewrite runs on a known content-type set); **4** (resilient and never silent: "not installed" and "rewrite drift" are visible); **6** (right-sized defensiveness: no arbitration, no handoff state machine, per the boxholder); **8** (one way to do each thing: the agent reaches the browser only through `bbx browser`, never a raw `agent-browser`); **11** (enforcement beats convention: a test pins the rewrite against the real bundle).
- **Agent guide budget.** `docs/agent-guide.md` test 3: *"Does it apply only when touching one thing (a field, a command, a card type)? **`indirect`**: it lives on that thing's surface ... and the guide keeps at most a pointer."* Mechanics go in a box skill and `box-docs/bbx-commands.md`; the guide gets one pointer line.
- **Tools are `bbx` commands, not MCP** (`src/core/agent/invoke/run.ts:110`, `skipMcpDiscovery: true`). Track D follows it.
- **Script env is fail-closed** (`src/core/script-env/allowlist.ts:60-128`: *"Widen this list only by adding a named entry with a reasoned comment"*). The plan adds no allowlist entries: the agent never runs agent-browser itself, so it needs no `AGENT_BROWSER_*` variables.

## What already exists

- **agent-browser in the monorepo.** `browse/packages/agent-browser-typed/package.json:13` *"agent-browser": "^0.27.0"*; `bin/browse:1-12` wraps it for dev agents; `pnpm-workspace.yaml:3` allows its build script. Not a beebox dependency; `deploy/deploy.sh:518-519` *"browse/agent-browser-typed are deliberately NOT synced — they're dev-only"*. Reuse: the same upstream package, moved to a runtime dependency of `beebox/`.
- **Passthrough CLI precedent.** `src/cli/commands/connector.ts:104-131` (`bbx connector gmail gws`): `.argument("[args...]")`, `.allowUnknownOption(true)`, child stdout and stderr passed through, `process.exitCode = result.exitCode`. Reuse the shape for `bbx browser`.
- **Loopback route with the agent bearer.** `src/cli/commands/chat/ui.ts:55-62` fetches `${BBX_SERVER_URL}/${BBX_BOX_NAME}/api/chat/...` with `loopbackHeaders()` (`src/cli/lib/loopback-headers.ts`, moved there from `chat/audio-fetch.ts` in D1); the box auth hook accepts it via `verifyAgentBearer` (`src/webapp/server-box-scope.ts:93`). Reuse for the exec route.
- **HTTP and WebSocket proxying to a Unix socket.** The hub uses `http-proxy-3` with `createProxyServer({ ws: true, changeOrigin: true })` (`src/hub/server/core.ts:379`) and `proxyTarget` returns `{host:"localhost", port:0, socketPath}` (`src/hub/endpoints.ts:32-35`). `http-proxy-3` is already a beebox dependency (`package.json:167`). Reuse for the HTTP half of the proxy. The box server owns upgrades through `@fastify/websocket` (`src/webapp/server/app.ts:99-103,177`), so the WebSocket half is a `{websocket:true}` route that bridges to a `ws` client on the Unix socket.
- **Base prefix.** `src/webapp/base-prefix.ts:46-52` `readBasePrefix(headers)`: the trusted outer prefix (`/<worktree>` in dev, empty in production). Reuse to build the rewrite prefix `${readBasePrefix}/${slug}/browser`.
- **Per-route CSP override.** `src/webapp/routes/api/register/files.ts:60` sets its own `Content-Security-Policy`, and the global `onSend` hook yields to a route that already set one (`src/webapp/server-root/root-routes.ts:110-121`). Reuse for the proxied HTML.
- **State directory outside the box repository.** `src/lib/state-dir.ts:12-13` `BBX_STATE_DIR = ~/.local/share/beebox`; on a unit host the home is `/var/lib/beebox/<slug>` (`src/lib/box-slug.ts:24`), writable under `ReadWritePaths=/var/lib/beebox/%i` (`deploy/systemd/box-sandbox.conf`). Reuse: the profile lives at `<BBX_STATE_DIR>/browser/<slug>-<key>/`.
- **Idle exit.** `src/webapp/server/idle-exit.ts:80-87`: open upgraded sockets keep the engine up. A dashboard WebSocket through the engine therefore keeps a production box awake while the person watches. No new idle signal is needed.
- **Shutdown and child cleanup.** `src/webapp/server/app.ts:361-377` shutdown sequence; `src/lib/exec-with-timeout.ts` kills a process group; `src/core/box-backup/local-runner.ts:99-116` detached group with SIGTERM then SIGKILL. Reuse the process-group pattern; there is no generic child registry, so the browser host adds its own shutdown hook.
- **Profile menu.** `src/frontend/src/components/AppNav/nav.tsx:74-81`: `MenuItem` entries, including `href={withBase("/auth/logout")}` for a full-page link. Reuse for the Browser item.
- **Name collision to avoid.** The box already has a `browse` card listing, and `docs/plans/general-browser.md` is the developer's document browser in the workstreams app. This plan's noun is "box browser"; its route is `/<slug>/browser/` and its command `bbx browser`. Searched `src/cli/entry/surface-data.ts`: no `browser` or `browse` verb exists.
- Searched `src/` for a generic supervised daemon helper: none. `CodexHistoryServer` (`src/services/codex-history-server.ts:88-151`) is the nearest long-lived child, with no restart logic.

## Prior art (external)

- **agent-browser** (vercel-labs/agent-browser, Apache-2.0) — **adopted**. Dashboard serves a static Next.js export with root-absolute paths; verified against 0.27.0 by fetching the bundle: every path is a quoted literal (`"/_next/`, `\"/_next/`, `'/_next/`, `("/_next/`, `"/api/`, `` `/api/ ``), 51 `/_next/` and 10 `/api/` sites. No base-path option upstream (`packages/dashboard/next.config.ts`, `src/lib/dashboard-routes.ts` on `main`, 2026-10-29). The dashboard's `/api/exec` runs agent-browser with the posted arguments (`src/lib/exec.ts`). Chrome is launched with `--remote-debugging-port=0` (`cli/src/native/cdp/chrome.rs:466`) and gets `--no-sandbox` only under `CI`, root, or when the caller passes it (`:1599-1614`). Loopback origins skip the dashboard token (`docs/content/docs/dashboard.mdx`). Acknowledgement entry lands with Track A.
- **passt/pasta** (passt.top, GPL-2.0-or-later, packaged in Ubuntu 24.04) — **adopted**. Gives an unprivileged process a private network namespace with outbound access through a userspace stack; `--no-map-gw` stops the namespace from reaching the host's loopback through the gateway address. Requires unprivileged user namespaces. Unverified on the production sandbox: Chunk F0 checks it.
- **Ubuntu 24.04 user-namespace restriction** — evaluated. Ubuntu 24.04 sets `kernel.apparmor_restrict_unprivileged_userns=1`; a binary needs an AppArmor profile with `userns,` to create one. Chrome's own sandbox and pasta both need it. Chunk F0 checks pasta's packaged profile and whether Chrome's sandbox works inside pasta's namespace; Track F ships a profile for the Chrome path if it does not.
- **Cloudflare Browser Run handoff, OpenAI takeover, Kernel and Steel viewers** — evaluated only ([hosted-and-agent-interfaces.md](../../../research/embedded-browser/hosted-and-agent-interfaces.md), [agent-browser-platforms.md](../../../research/embedded-browser/agent-browser-platforms.md)). Not used: the boxholder ruled out arbitration and a beebox viewer.

## Ontology

- **Box browser** (new): the one agent-browser session per box, session name `box`. Identified by the box slug. It is not the `browse` card listing and not a card. Points at a browser profile and a browser host.
- **Browser profile** (new): the Chromium user-data directory `<BBX_STATE_DIR>/browser/<slug>-<key>/profile/` (`<key>` from the box root). Holds cookies and logins. Not in the box's git repository, not in `_tmp/`, not backed up (NOT in scope). Uses agent-browser's own term (`--profile <path>`).
- **Browser host** (new): the process tree the engine starts for a box: optionally `pasta`, then `bbx engine browser-host`, which runs the agent-browser dashboard and the dashboard relay. Identified by its process group; one per engine. Not a systemd unit.
- **Dashboard** (upstream term): agent-browser's web UI and HTTP server, `agent-browser dashboard start --port <n>`. Inside the browser host only.
- **Command socket** (new): `<root>/cli.sock` (0600), served by the browser host; one JSON request `{ args }` per connection, answered with `{ exitCode, stdout, stderr }`. The only way the agent's commands reach agent-browser.
- **Dashboard relay** (new): a Unix socket `<BBX_STATE_DIR>/browser/<slug>-<key>/dashboard.sock` (mode 0600) that forwards bytes to the dashboard's loopback port inside the browser host. The only way in from outside the host's network namespace.
- **Browser path** (new): `/<slug>/browser/...` on the box's own origin. Person-facing.
- **Rewrite prefix** (new): `<outer>/<slug>/browser`, inserted in front of `/_next/` and `/api/` literals in proxied responses. `<outer>` is a dev router's segment, read from the same-origin `Referer` (`src/webapp/routes/browser/proxy/prefix.ts`); empty in production. Not `readBasePrefix`: the hub replaces that header with `/<slug>`, which doubled the slug (dev smoke run, 2026-10-30).
- **Exec route** (new): `POST /<slug>/api/browser/exec`, agent bearer only. Body `{ args: string[] }`; reply `{ exitCode: number, stdout: string, stderr: string }`.
- **Session, stream, daemon** (upstream terms): unchanged meanings from agent-browser.
- **Unit host** (existing): `onUnitHost()` in `src/lib/unit-host.ts`, `BBX_UNIT_HOST === "1"`. Decides whether the browser host runs under `pasta`.

## Tracks / scope

### Track A. Dependency and pinned upstream contract

- **What:** make `agent-browser` a runtime dependency of `beebox/` at one exact version, and bump `agent-browser-typed` to the same version.
- **Why:** the box needs the binary in production; the rewrite in Track C depends on the bundle's exact shape, so a floating range would break it silently on install.
- **Direction:** `beebox/package.json` `"agent-browser": "0.39.2"` (exact: the newest release past the 7-day `minimumReleaseAge` in `pnpm-workspace.yaml:49`; 0.41.0 was one day old on 2026-10-29). `browse/packages/agent-browser-typed/package.json` to `"0.39.2"`; run its `verify-help` and refresh the help snapshots. `deploy/deploy.sh:518-519` comment updated: agent-browser now ships with beebox; `browse/` stays dev-only. `ACKNOWLEDGEMENTS.md` entry for agent-browser.
- **Vocabulary lock-ins:** the pinned version is named once, in `beebox/package.json`; `src/core/browser/upstream.ts` exports `AGENT_BROWSER_VERSION` read from the installed package, and the contract test compares them.
- **First implementation chunk:** the version bump in both packages, refreshed help snapshots, `pnpm install`, `bin/browse` smoke (`bin/browse open /` and `snapshot -i`) still passes, the acknowledgement. Commit.

### Track B. Browser host

- **What:** a module that starts, finds, and stops one browser host per box, and the engine-only command `bbx engine browser-host` that runs inside it.
- **Why:** agent-browser starts its daemon on first use from whichever process asks. If the agent's own shell started it, Chromium would run outside the private namespace (Track F). One owner, the engine, prevents that.
- **Direction:**
  - `src/core/browser/paths.ts`: `browserPaths(boxRoot, slug): { root, profile, socketDir, relaySocket, downloads, log, config }` under `<BBX_STATE_DIR>/browser/<slug>-<key>/`, where `<key>` is the first 8 hex characters of the SHA-256 of the canonical box root. `BBX_STATE_DIR` is per OS user (`src/lib/state-dir.ts:15`), so in dev two worktree clones of `test1` would otherwise share one profile and stop each other's browsers (cross-model review, 2026-10-30). The slug keeps the directory readable. Throws a typed `BrowserPathTooLong` when `socketDir/box.sock` exceeds 100 bytes (macOS limit 103, Linux 107), naming the path.
  - `src/core/browser/install.ts`: `resolveBrowserExecutable(): { ok: true, path } | { ok: false, reason }`. Unit host: `/opt/beebox-browser/chrome` (a symlink Track F maintains). Elsewhere: agent-browser's own Chrome for Testing under `~/.agent-browser/browsers` (what dev uses today), or `AGENT_BROWSER_EXECUTABLE_PATH` if set in the engine's environment.
  - `src/core/browser/host.ts`: `ensureBrowserHost(box): Promise<BrowserHostHandle>`, idempotent per engine process. Spawns, in a new process group, `bbx engine browser-host --box <boxRoot> --slug <slug>`; on a unit host it runs that command through the namespace launcher (`src/core/browser/namespace.ts`, Track F) instead of directly. Waits for the relay socket to accept a connection (timeout 20 s, then a `BrowserHostFailed` error carrying the last 40 lines of the host log). Registers a shutdown hook in `app.ts` that sends SIGTERM to the group, then SIGKILL after 5 s.
  - `bbx engine browser-host` (its own top-level verb `browser-host` in `surface-data.ts`, audience `engine`, reason "the engine spawns one per box", like `serve` at `src/cli/entry/surface-data.ts:170`; a split `browser` family would still register `host` under the agent's command, `src/cli/entry/surface-build.ts:40`, cross-model review round 2): picks the dashboard port (fixed 4848 inside a namespace; an OS-assigned free port otherwise), writes `<root>/agent-browser.json` (empty object) and starts `agent-browser dashboard start --port <p>` with working directory `<root>` and this environment and no other: `AGENT_BROWSER_CONFIG=<root>/agent-browser.json` (an explicit config file replaces discovery of `~/.agent-browser/config.json` and `./agent-browser.json`, `node_modules/agent-browser/README.md:1170-1216`; otherwise a stray config could add `--no-sandbox` or another profile that the refused-flag list never sees), `AGENT_BROWSER_SOCKET_DIR`, `AGENT_BROWSER_SESSION=box`, `AGENT_BROWSER_PROFILE=<profile>`, `AGENT_BROWSER_EXECUTABLE_PATH`, `AGENT_BROWSER_DOWNLOAD_PATH=<downloads>`, `AGENT_BROWSER_SCREENSHOT_DIR=<boxRoot>/_tmp/browser`, `AGENT_BROWSER_CONTENT_BOUNDARIES=1`, `AGENT_BROWSER_MAX_OUTPUT=60000`, `AGENT_BROWSER_IDLE_TIMEOUT_MS=1800000`, `HOME`, `PATH`. Before starting, it runs `agent-browser dashboard stop` and `agent-browser --session box close` against the box's socket directory, to clear processes left by a crashed host: `dashboard start` detaches from its parent, so a SIGKILL of the host group does not reach it. Whether Chrome dies with a force-killed daemon on macOS and Linux is not established: the upstream sentence "including forced termination" is in a paragraph about Windows (`skill-data/core/references/commands.md:471`). The stale cleanup therefore also kills any process whose command line names this box's profile directory, and `host.e2e.test.ts` checks it. Opens the relay socket (0600) piping each connection to `127.0.0.1:<p>`. On SIGTERM: `agent-browser --session box close`, `agent-browser dashboard stop`, remove the relay socket, exit.
  - `bin/process-cleanup.ts` `reclaimWorktreeBrowsers` (`:454-485`) kills any agent-browser daemon from the worktree's `node_modules` that `bin/browse` did not vouch for (`classifyAgentBrowser`, `:290-303`: unvouched means "superseded orphan"). In dev a box browser's daemon runs from the same `node_modules`, so any `bin/browse` call would kill it (seen during G1, 2026-10-30). The reaper also vouches for daemons whose pid files are under `<BBX_STATE_DIR>/browser/*/sock/`, with a test in the reaper's existing test file.
  - Chromium idles out through the daemon's own timeout; the host (dashboard, relay, `pasta`) stays until the engine exits. A dashboard request that finds no session creates it on demand (Track C).
- **Vocabulary lock-ins:** directory layout `browser/<slug>-<key>/{profile,sock,dashboard.sock,downloads,host.log,agent-browser.json}`; session name `box`; command `bbx engine browser-host`.
- **First implementation chunk:** `paths.ts` and `install.ts` with unit tests (path length, executable resolution on a fake filesystem). No process code yet.

### Track C. Engine routes

- **What:** the person-facing proxy at `/<slug>/browser/*`, its WebSocket bridge, and the agent's exec route.
- **Why:** the dashboard needs an address the person can reach through beebox's login (`docs/server/provisioning.md:245-246`: production is one host name behind Cloudflare; Docker installs use one Caddy domain; a per-box origin fits none of them). Its paths are root-absolute, so it must be rewritten to live under the box prefix.
- **Direction:**
  - `src/core/browser/rewrite.ts`: pure `rewriteDashboardBody(body: string, prefix: string): string`, replacing `/(["'`(]|\\")\/(_next|api)\//g` with `$1${prefix}/$2/`. `isRewritableType(contentType)`: `text/html`, `text/css`, `application/javascript`, `text/javascript`. Also `countDashboardPathSites(body)`, used by the contract test.
  - `src/webapp/routes/browser-routes.ts`, registered inside `registerBoxRoutes` (`src/webapp/server-box-scope.ts:187-358`):
    - `ALL /browser` and `/browser/*`: own auth check before anything else, because the scope hook passes asset extensions without auth (`server-box-scope.ts:80`). Accepts the human session (cookie or hub identity, then `canAccessBox`) or the mobile bearer; refuses the agent bearer and the browse key (403 "the browser page is for people; agents use bbx browser"). Requires `Origin`, when present, to be the box's own origin; otherwise 403. Implemented (2026-10-30) as: `Sec-Fetch-Site: same-origin`, or `Origin` equal to the request's own origin or to the box's public URL. Comparing with `Host` alone refused every real request, because the hub and the dev router rewrite `Host`; a page script cannot set `Sec-Fetch-Site`. Calls `ensureBrowserHost`. For `GET /browser/` it also ensures a session exists: it runs `session list` (`node_modules/agent-browser/README.md:735`) and runs `open about:blank` only when the list parses and does not contain `box`. Any other result (a command error, unparseable output) is shown on the page without navigating, so a transient error never replaces the page the person was working on. Registered in its own encapsulated Fastify scope that removes the built-in content-type parsers and adds a no-op catch-all, as the hub does (`src/hub/server/core.ts:302-312`: the built-in JSON parser drains the stream, "which left every proxied JSON POST hanging"). Proxies with `http-proxy-3` to the relay socket: strips `/<slug>/browser`, sets `Host: localhost` and `Origin: http://localhost` (the pair the dashboard accepts as loopback, found in B2), removes `Cookie`, `Authorization`, hub identity and `X-Forwarded-*` headers, drops the dashboard's own `Set-Cookie` and CSP, and moves root-relative `Location` redirects under the prefix. In dev the Vite server needs a proxy rule for `/<box>/browser` (`src/frontend/vite.config.ts`), or it answers with the app page. Buffers rewritable responses (`selfHandleResponse`), rewrites, fixes `Content-Length`, removes `Content-Encoding` after decoding. Sets on HTML: `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'` and `Cache-Control: no-store`.
    - The dashboard's own POSTs are held to the box session (review fix, 2026-10-30): for `/api/exec` the route reads the body (64 KiB cap, 413 above) and checks `args` with `checkDashboardExecArgs`, which allows `--session box` (the dashboard prefixes every command with `--session <name>`) and otherwise applies the agent's refused lists, so "New session" with another name, `--provider` or `--engine` gets 403 `{ error }`. `/api/sessions` and `/api/kill` must name `box`; `/api/chat` is refused (it runs model-written commands with `--session` and `--engine`; it is off anyway with no gateway key). The checked body is forwarded from the buffer (`dashboard-post.ts`).
    - `GET /browser/api/session/:port/stream` with `{websocket: true}`: same auth and origin check; bridges messages both ways to `ws+unix://<relaySocket>:/api/session/<port>/stream`; closes both sides when either closes. Chrome sends no `Sec-Fetch-Site` on the handshake, so when the box has a public URL (production) its `Origin` must be that URL's origin, since a sibling subdomain is same-site and gets the `SameSite=Lax` cookie; with none (dev) the session cookie alone admits it. Input queued before the upstream opens is capped at 1 MiB (close 1009).
    - `POST /api/browser/exec`: agent bearer only. Validates `args` with Zod (array of strings, 1-64 items, each under 8 KB). Refuses global flags that change what browser or profile is used: `--session`, `--session-name`, `--profile`, `--cdp`, `--auto-connect`, `--provider`, `-p`, `--engine`, `--executable-path`, `--args`, `--state`, `--restore`, `--config`, `--headed`, `--extension`, `--namespace` (another daemon socket directory), and the `connect`, `batch`, `dashboard`, `install`, `upgrade`, `plugin`, `mcp` subcommands (`batch` because each of its strings is parsed as a separate command, so `batch "connect <url>"` would bypass the list; cross-model review round 2). The 400 reply names the refused flag and says the box browser's settings are fixed. Calls `ensureBrowserHost`, then sends `{ args }` to the host's command socket `<root>/cli.sock` (0600), where the browser host, inside the namespace, runs the agent-browser CLI with its fixed environment and returns `{ exitCode, stdout, stderr }` with the CLI's ordinary text output. Timeout 120 s. (Revised during B2, 2026-10-30: the dashboard's own `/api/exec` always returns agent-browser's JSON output, not the text an agent reads, and refuses any `Origin` that is not loopback. Running the CLI inside the host also guarantees that a daemon it starts is inside the namespace; running it from the engine, outside, would start one outside if the daemon had just idled out.)
    - When `resolveBrowserExecutable()` fails, the HTML route serves a plain page with the reason, and exec returns 503 with the same reason.
- **Vocabulary lock-ins:** path `/<slug>/browser/`; route `POST /<slug>/api/browser/exec` and its body and reply shapes; the refused-flag list lives in `src/core/browser/exec-args.ts` as one exported constant.
- **First implementation chunk:** `rewrite.ts` and `exec-args.ts` as pure functions with tests, including the contract test against the real pinned bundle (Track A must be in). No routes yet.

### Track D. `bbx browser`

- **What:** the agent's command.
- **Why:** principle 8: one way in. The agent never runs `agent-browser` directly.
- **Direction:** `src/cli/commands/browser/command.ts`: `new Command("browser").argument("[args...]").allowUnknownOption(true)`, passthrough shape from `connector.ts:104-131`. Posts `{ args }` to `${BBX_SERVER_URL}/${BBX_BOX_NAME}/api/browser/exec` with `loopbackHeaders()`, writes stdout and stderr, sets `process.exitCode`. `bbx browser` with no arguments prints a short help that names the upstream commands the agent will use (`open`, `snapshot -i`, `click`, `fill`, `get text`, `screenshot`, `wait`) and points at the box skill. Registered in `src/cli/commands.ts` and `src/cli/entry/surface-data.ts`: `browser`, audience `agent`, smoke `skip: "starts a real browser"`. A CLI test asserts `bbx browser host` is passed through to agent-browser as ordinary arguments (and refused there), never reaching the engine verb.
- **Vocabulary lock-ins:** `bbx browser <agent-browser args>`.
- **First implementation chunk:** the command against a stub exec route in a CLI test; surface entry.

### Track E. Menu item and the "not installed" page

- **What:** a "Browser" item in the profile menu that opens `/<slug>/browser/` in a new tab.
- **Why:** the person needs a findable way in that does not depend on the agent posting a link.
- **Direction:** `nav.tsx` `ProfileMenu`, after Admin: `<MenuItem id="bbx-profile-menu-browser" href={withBase(`/${boxSlug}/browser/`)} target="_blank">Browser</MenuItem>` (`MenuItem` already accepts `target: "_blank"` and adds `rel="noopener noreferrer"`, `src/frontend/src/components/ui/dropdown-menu-item.tsx:33,91`). Shown on every viewport; no phone-specific behaviour.
- **First implementation chunk:** the item and a frontend test that it renders with the right `href`.

### Track F. Production: a private network per box

- **What:** run the browser host inside `pasta` on unit hosts; install `passt`, Chrome for Testing, and any needed AppArmor profile through the deploy.
- **Why:** agent-browser's dashboard, stream, and Chrome debugging ports are loopback TCP with no authentication for loopback callers. Other box users on the host could drive this box's browser and read its files through `file://`. The boxholder chose a private network per box (2026-10-29).
- **Direction:**
  - **Chunk F0, verification:** done 2026-10-30 on a throwaway VM ([linux-verification.md](../../../research/embedded-browser/linux-verification.md)). All five checks pass with the launcher and profiles below; pasta spawning the command directly failed checks 1 and 2.
  - **Namespace launcher** `src/core/browser/namespace.ts`: `namespaceCommand(command: readonly string[]): { argv, attach }`. Three steps, from F0: (1) `/opt/beebox-browser/bin/unshare --user --map-user=<uid> --map-group=<gid> --net --mount --keep-caps sh -c <inner>`, where `<inner>` waits on a FIFO, bind-mounts `/run/systemd/resolve/resolv.conf` over `/etc/resolv.conf`, waits up to 5 s until `ip -o addr show tentative` is empty, then `exec setpriv --inh-caps=-all --ambient-caps=-all --bounding-set=-all -- <command>`; (2) once the child's network namespace differs from ours, `pasta --config-net --no-map-gw -t none -u none -T none -U none --quiet <child pid>`; (3) write to the FIFO. The command then runs as the box uid with no capabilities. pasta spawning the command itself is rejected: it leaves the command as uid 0 in its namespace, so agent-browser adds `--no-sandbox` (`chrome.rs:1613`), and its capability set cannot map back to the box uid. pasta's default port forwarding (`-T auto`) forwards namespace-loopback ports to every host-loopback listener, so the four `none` flags are mandatory; a unit test pins the argv.
  - **AppArmor**, `deploy/apparmor/beebox-browser`, two profiles with `userns,` and `flags=(unconfined)`: `/opt/beebox-browser/bin/unshare` (a copy of `/usr/bin/unshare`, mode 0750, group `beebox-boxes`, so only box users run the exempt binary) and `/opt/beebox-browser/.agent-browser/browsers/*/chrome` (Ubuntu's own pattern for Chrome). pasta needs none: it joins a namespace and creates none.
  - `deploy/deploy.sh` and `deploy/hetzner/cloud-init.yaml`: `apt-get install passt`; `agent-browser install --with-deps` with `HOME=/opt/beebox-browser` for the pinned version; maintain `/opt/beebox-browser/chrome` as a symlink to the installed binary; install `/opt/beebox-browser/bin/unshare` (0750 root:beebox-boxes); install `deploy/apparmor/beebox-browser` and load it with `apparmor_parser -r`.
  - `host.ts` uses the launcher on a unit host (Track B). If `pasta` or the launcher binary is missing there, `ensureBrowserHost` fails with a message naming the missing file; it never falls back to running without the namespace.
  - `docs/security-report.md`: rows for the browser path (person auth, origin check, third-party code on the box origin), the exec route (agent bearer, refused flags), and the namespace (cross-box ports, host loopback). Run the `security-report` skill.
  - `docs/server/provisioning.md`: what the deploy installs for the browser and why.
- **First implementation chunk:** F0, the verification note. No code.

## Could this be simpler?

- **Simplest version:** the smallest fix above (dependency plus guidance, dashboard on loopback). It fails the person: there is no way to reach the dashboard through the app. It fails `docs/security-report.md:546` on the production server.
- **Per-box host names instead of rewriting:** no rewrite and no pinned bundle shape. It also takes the dashboard's script off the box origin (see the critical gap in Failure modes). It needs a second host name with DNS and a certificate on the production server (`docs/server/provisioning.md:243-246`) and an equivalent in dev, where the router is path-based. More operational cost than a tested rewrite; the boxholder chose same origin (2026-10-30).
- **Upstream base-path support:** the right long-term fix; not in our control or timeline. Filed as an upstream contribution to make later (NOT in scope); the rewrite is removed when it lands.
- **Let the agent run agent-browser directly** (env vars plus PATH) instead of the exec route: saves about 150 lines. Fails principle 8 and Track F: the agent's first call would start the daemon and Chromium outside the namespace.
- **Run the browser host as its own systemd unit:** cleaner memory accounting, but a box cannot start units (`NoNewPrivileges`, no user manager). Rejected.
- **What each remaining piece buys:** the relay socket is the only way to reach a namespaced loopback port without opening a host TCP port (Track F). The WebSocket bridge exists because the box server owns upgrades through `@fastify/websocket`. The refused-flag list keeps the agent on the box profile and inside the namespace.

## Subplans

None. Chunk F0 is a verification step inside Track F: each outcome has its action written above, and a failed isolation check stops the production half and goes to the boxholder.

## Failure modes

> **Critical gap (accepted by the boxholder, 2026-10-30):** the dashboard is third-party JavaScript served on the box's own origin. Script running there has the person's beebox authority: `connect-src 'self'` lets it call every beebox API with the person's session cookie, and removing cookies on the proxy's upstream hop does not change what the page's own script can do in the person's browser. A dashboard bug that renders browsed-page content as HTML would therefore reach the person's box. Mitigations in this plan: React escaping, an exact pinned version reviewed at each bump, and a CSP that keeps the page's script to its own files. The alternative is a separate host name for the browser, which production does not have today (one host name behind Cloudflare, `docs/server/provisioning.md:243-246`) and which needs DNS and certificate work. The boxholder chose same origin (2026-10-30: "Same origin, accept it"), to revisit with a separate host name if boxes ever have members other than the boxholder. Recorded as a security report row.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| An agent-browser upgrade changes the bundle's path literals; some requests escape the prefix and 404 | Contract test counts path sites in the real bundle and asserts every one is rewritten (Track C) | Version pinned exactly (Track A) | Clear: the test fails on the bump |
| Another box user connects to this box's dashboard, stream, or debugging port | F0 check (4), recorded | `pasta` namespace; no fallback without it (Track F) | Clear: the host refuses to start without `pasta` |
| The agent's first call starts Chromium outside the namespace | Exec-route test: agent bearer reaches only the exec route; no `AGENT_BROWSER_*` reaches the agent's env (`allowlist.ts` unchanged) | Engine owns the host (Track B) | Clear |
| Agent passes `--profile ~/.config/google-chrome` or `--cdp 9222` | `exec-args.test.ts` | Refused-flag list, 400 naming the flag | Clear |
| Chromium runs without its sandbox: agent-browser adds `--no-sandbox` when it sees uid 0, which is what pasta's own namespace gives (F0) | F0 check (2); `namespace.test.ts` pins the launcher argv (unshare maps the box uid; `setpriv` drops capabilities) | Launcher keeps the box uid; AppArmor profiles for the launcher and Chrome | Silent: Chrome runs either way. The dev Mac e2e test cannot catch it; the F1 deploy step opens `chrome://sandbox` once as a box user and fails the deploy unless it says "adequately sandboxed" |
| pasta's default forwarding exposes host-loopback services (the hub, other boxes' listeners) to the browser | `namespace.test.ts` pins `-t none -u none -T none -U none --no-map-gw` | Launcher flags (F0 check 3) | Silent if the flags were dropped; the argv test is the guard |
| DNS fails inside the namespace (the host's resolv.conf points at the loopback stub) or the first requests fail during IPv6 address setup (`ERR_NETWORK_CHANGED`) | F0 checks 2 and 3 | Bind of `/run/systemd/resolve/resolv.conf`; tentative-address wait | Clear: navigation errors |
| Chromium memory pushes the box cgroup past `MemoryMax=2G`; the kernel kills a process and systemd stops the whole unit (default `OOMPolicy=stop`), taking the chat turn with it | F0 check (5) measures it | Daemon idle timeout 30 min; F0 measured 688 MB for three tabs; limits revisited after G2 (Open design questions) | Clear in the journal; to the person, the box restarts on the next request |
| The relay socket path is over the Unix limit (long slug in dev) | `paths.test.ts` | `BrowserPathTooLong` names the path | Clear |
| The browser host does not come up (bad binary, port in use in dev) | `host.e2e.test.ts` covers the success path; a unit test covers the timeout | 20 s timeout, `BrowserHostFailed` with the log tail, shown by `bbx browser` and the page | Clear |
| A cross-site page posts to `/<slug>/browser/api/exec` with the person's cookie | `browser-routes.test.ts` (origin mismatch gives 403) | Origin check; session cookie's SameSite (existing) | Clear |
| The agent bearer is used on the person's proxy path to reach the dashboard's Storage pane (cookies) | `browser-routes.test.ts` | Agent bearer and browse key refused on `/browser/*` | Clear |
| A crashed host leaves the detached dashboard, daemon or Chrome running (dev; production's `KillMode=control-group` kills them with the unit) | `host.e2e.test.ts` records each pid, kills the host with SIGKILL, starts it again, and asserts the old pids are gone | Stale cleanup at host start (Track B) | Clear |
| In dev, `bin/browse`'s reaper kills the box browser's daemon as an unvouched orphan; the next command starts a fresh daemon on `about:blank` and the person's page is gone | Reaper test: a daemon with a pid file under the box browser directory is spared | Reaper vouches for box browser pid files (Track B) | Silent before the fix: found in G1 |
| Two worktree clones of one box slug in dev resolve to one browser directory, sharing logins and stopping each other's browser | `paths.test.ts`: two roots with the same slug give two directories | Directory keyed by the box root hash (Track B) | Clear |
| A page's WebSocket handshake carries `Origin` but no `Sec-Fetch-Site` (Chrome), and the box sees a rewritten `Host`, so an origin comparison refuses the live view | `route.test.ts`: a handshake with the session cookie and an unmatched `Origin` is bridged; one marked cross-site is refused | With a public URL configured, `Origin` must match it (a sibling subdomain gets the Lax cookie; `route.test.ts`); with none (dev), the `SameSite=Lax` session cookie only; the mobile cookie is not accepted there | Clear: the dashboard shows the stream disconnected (found in the dev smoke run) |
| After an engine restart the readiness check reaches the previous host's relay socket while that host exits; the first request gets 502 | Not tested | Old socket files unlinked before a new host spawns | Clear: one failed page load (found in the dev smoke run) |
| The detached dashboard dies while its host lives; every request gets 502 | `host.e2e.test.ts` kills the dashboard pid alone and expects a new host | `ensureBrowserHost` asks the dashboard `GET /api/sessions` through the relay (3 s timeout, skipped for 5 s after an answer and right after a start) and replaces the host when it does not answer | Clear: one slow request |
| The host fails after `dashboard start` (command socket or relay); the detached dashboard and session stay up | Verified by hand with an injected relay failure: dashboard and session stopped, no profile holders, sockets removed, exit 1 | `stopStarted` runs the SIGTERM path's cleanup before the host exits non-zero | Clear: `BrowserHostFailed` with the log |
| A client sends input while the host is still starting and the queue grows without bound | `stream-bridge.test.ts` | Queue capped at 1 MiB; the client is closed with 1009 | Clear: the stream disconnects |
| The proxied dashboard's "New session", `/api/sessions` or `/api/kill` names another session or a provider, so the person's path reaches beyond the box session | `route.test.ts`, `exec-args.test.ts` | Body read and checked; 403 `{ error }` | Clear: the dashboard shows the error |
| Person opens the Browser tab while the box engine is asleep: the WebSocket upgrade does not wake it (`src/hub/server/core.ts:560`) | Not needed | The HTML page load is an HTTP request and wakes the box first | Clear |
| In dev, the hub's 5-minute lazy idle counts only HTTP (`src/hub/supervisor/core.ts:73-74`); a watched browser with no HTTP traffic loses its engine | Not tested | Dev only; production counts sockets (`idle-exit.ts:80-87`) | Clear: the stream closes and the dashboard shows disconnected |
| A site blocks the server's datacenter address | Not testable here | Agent guidance: say so, do not retry; site probe issue decides the residential path | Clear: the block page is visible |

## Agent-flow / user-flow edge cases

- **Wrong tool:** the agent uses WebFetch for a logged-in page, or `bbx browser` for a public page WebFetch can read. ADDRESSED in the box skill: WebFetch first for public pages; `bbx browser` for pages that need a login, scripts, or the person's help.
- **Stale ref:** an `@e5` ref from an old snapshot after the person navigated away. ADDRESSED upstream: agent-browser refuses stale refs; the skill says to snapshot again after the person has used the browser.
- **Two actors at once:** the person clicks while the agent types. Not handled, by the boxholder's decision. The skill tells the agent to stop and wait after asking the person to step in.
- **Hand-edit drift:** not applicable: no card or file the person edits by hand.
- **Fabricated value:** the agent claims a price it did not read. ADDRESSED partly: content boundaries mark page text (`AGENT_BROWSER_CONTENT_BOUNDARIES=1`), and the skill asks the agent to quote what it read.
- **Validation error UX:** a refused flag reads "bbx browser: --profile is fixed for the box browser; the box uses one profile at <path>". ADDRESSED in Track C.
- **Partial rollout:** engine code ships before the deploy installs Chromium. ADDRESSED: `resolveBrowserExecutable` fails, and both the page and the command say "no browser installed" with the reason.
- **Agent asks the person on a phone:** DEFERRED by the desktop-only decision; the skill tells the agent to say the browser needs a computer.
- **Prompt injection from a page:** GAP, accepted. A page can instruct the agent. Mitigations here are content boundaries and the confirmation rule for logged-in actions in the skill. No code gate, per the boxholder's decision against arbitration machinery.

## NOT in scope

- **Phones and the iOS app:** desktop only (boxholder, 2026-10-29).
- **A beebox viewer, input arbitration, a handoff command:** ruled out by the boxholder. Handoff is conversational.
- **Paste into the remote page:** upstream patch to agent-browser's `viewport.tsx`; a separate contribution, not this plan.
- **Upstream base-path support:** would remove the rewrite; a separate contribution.
- **Hiding the dashboard's developer panes:** the person is the boxholder and sees their own data; revisit if boxes get other members.
- **The box agent viewing its own box's pages with a box credential** (the anchor issue): needs a box-scoped credential inside the browser; separate design.
- **Egress filtering beyond host loopback** (cloud metadata, private ranges): the private egress issue. F0 found the metadata address reachable from the namespace, as from every box process today; the user data it serves (`deploy/hetzner/cloud-init.yaml`) holds no secrets.
- **Backing up the browser profile:** logins are re-entered after a restore; cookies in backups are a new secret class.
- **Docker installs and the Mac app VM:** no Chromium in those images; they show "no browser installed". A later plan if wanted.
- **Running the browser on the person's network:** waits on the site probe.
- **Captcha solvers, stealth patches, residential proxies:** rejected in the research.

## Open design questions

- **Raise `MemoryHigh`/`MemoryMax`?** F0: the browser stack alone is 373 MB with one tab and 688 MB with three (peak 745 MB), in the same cgroup as the engine and the agent's subprocess. Lean: leave the limits and measure a real browsing agent turn on the boxholder's box after G2; raise them with that number if it crosses `MemoryHigh`.
- **Should the Browser menu item hide on narrow screens?** Lean: no; show it everywhere and let the person find it unsuited. Revisit if the boxholder finds it confusing on the phone.

## Knowledge audits

New agent-facing concept: the box browser and when to ask the person to step in. Entries in `src/dev/knowledge-audits.yaml`:

- `browser-login-needed`: "A site you need is asking for a login. What do you do?" `expected_level: knows_directly`, `chat_mode: true`, `correct_contains_any: ["Browser", "bbx browser"]`, `watch_for: ["asks for the password"]`.
- `browser-vs-webfetch`: "How do you read a page that needs the person's account?" `correct_contains: ["bbx browser"]`.

Both land run against test1 (`pnpm knowledge-audit run --box ~/src/boxes/test1 --filter browser-`), with the status comment recorded.

## What will hold this after it ships

- **Pure functions carry the risky decisions:** `rewriteDashboardBody`, `isRewritableType`, the refused-flag check, `browserPaths`. Unit tests, milliseconds each.
- **The contract test** reads the real dashboard bundle from the pinned package (started once on a temp socket dir) and asserts the count of path sites and that none survive the rewrite unprefixed. It fails on any upgrade that changes the shape. It runs in the e2e tier because it starts the dashboard binary.
- **Route tests** use a fake upstream: a small HTTP and WebSocket server on a Unix socket standing in for the relay. It encodes the upstream's interface (paths, `/api/exec` shape), not our logic, so it is not a mock of our own code.
- **`host.e2e.test.ts`** starts a real browser host on the dev Mac (no `pasta`), runs `exec ["open", "data:text/html,<h1>hi</h1>"]` and `["get", "title"]`, records the pids of the dashboard, the daemon and Chrome, then (a) stops the host gracefully and (b) in a second run kills it with SIGKILL and starts it again, and asserts after each that none of the recorded pids is alive and that the profile reopens (the login cookie from a local test page survives). Skips with a printed reason when no Chrome binary resolves, so a missing browser is visible in the test output.
- **No tour:** the menu item is one link; the walk is the e2e test plus the manual F0 run.
- **Production behaviour** (namespace, AppArmor, memory) is held by F0's recorded note and the security report rows; it is not testable in CI.

## Implementation order

1. A1: version bump, help snapshots, acknowledgement. (Track A) Done 2026-10-30.
2. B1: `paths.ts`, `install.ts`, tests. (Track B) Done 2026-10-30.
3. G1, the acceptance gate, on the dev Mac with the pinned version and no beebox code: start a session with a fresh profile and the dashboard; serve a local test login page (a form that sets a cookie); in the dashboard, type a username and password and submit; have `agent-browser snapshot -i` read the logged-in page; stop everything, start it again, and confirm the cookie survived. Record the result in `research/embedded-browser/acceptance-walkthrough.md`. If typing into the form through the dashboard fails, stop and ask the boxholder. Done 2026-10-30, passed ([acceptance-walkthrough.md](../../../research/embedded-browser/acceptance-walkthrough.md)). Known and accepted limit: paste does not reach the page (shown to the boxholder 2026-10-29 before the "desktop only, agent browse seems good" decision); the person types passwords.
4. F0: Linux verification on a throwaway Hetzner VM (boxholder's yes, 2026-10-30; deleted after). Done: [linux-verification.md](../../../research/embedded-browser/linux-verification.md). Record the note. Moved before host and proxy code (cross-model review, 2026-10-30), because a failed isolation check changes the design.
5. C1: `rewrite.ts`, `exec-args.ts`, tests, the bundle contract test (`rewrite.bundle.e2e.test.ts`, 59 path sites in 0.39.2). (Track C, needs A1) Done 2026-10-30.
6. B2: `host/start.ts`, `host/namespace.ts`, `host-process/`, `bbx engine browser-host`, `host/start.e2e.test.ts`, reaper vouching. (needs B1, F0) Done 2026-10-30.
7. C2: command socket, exec route and its tests. (needs B2, C1) Done 2026-10-30.
8. D1: `bbx browser` command, surface entries, CLI test. (needs C2) Done 2026-10-30.
9. C3: proxy route, WebSocket bridge, CSP, origin check, route tests, including a JSON POST whose body the fake upstream receives byte for byte. (needs B2, C1) Done 2026-10-30 (`src/webapp/routes/browser/proxy/`).
10. E1: menu item and test. (needs C3) Done 2026-10-30.
11. Docs: box skill, `box-docs/bbx-commands.md`, guide pointer and ledger row, knowledge audits run. (needs D1, E1)
12. F1: deploy and cloud-init changes, AppArmor profiles per F0, `docs/server/provisioning.md`, security report rows. (needs F0)
13. G2: the boxholder repeats G1's walkthrough through the app on a desktop (menu item, a real login on an account of their choosing, then the agent continues in chat). The plan ships after G2 and only when the boxholder says so.

## Rollout shape

- **Tests first:** each chunk names its tests above; done-when is those tests passing plus `pnpm typecheck`, `pnpm lint`, `pnpm layout-check`, `pnpm lint:guide`.
- **Knowledge audits:** `browser-login-needed` and `browser-vs-webfetch` land run, in chunk 9.
- **No data migration:** nothing in any box changes shape. The browser profile is created on first use.
- **Deploy order:** engine code can ship before F1; until F1 runs, production shows "no browser installed". F1 is a deploy change and runs with the boxholder's go-ahead.
