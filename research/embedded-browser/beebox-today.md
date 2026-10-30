# What beebox already has for an embedded shared browser (2026-10-29)

Goal under study: one live browser session that the person sees and drives in the app (desktop and phone) and the box agent drives programmatically, with handoff both ways. This note lists what exists today that the feature would build on or collide with. Paths are relative to the repo root. No product code was changed.

Short answer: beebox has no browser runtime of its own. Every browser-shaped feature today runs in the person's own Chrome (Clerk extension, Claude in Chrome) or in a dev-only agent-browser wrapper. The server image ships no Chromium.

## 1. How the agent asks the person's Chrome to do things today

There are three separate mechanisms. None is a live shared session.

**a. browser-task card (a prompt card that is its own inbox).** Plan: `beebox/docs/implemented-plans/browser-task-card.md`; follow-ups (cadence, run history, review table): `beebox/docs/implemented-plans/browser-task-followups.md`. Schema: `beebox/src/schemas/browser-task.ts`; listing: `beebox/src/core/browser-task/list.ts`.
- The card holds a prompt, a record JSON Schema, a watermark, and an attach directory used as an inbox. The box agent authors the card.
- The executor is a person-started Claude Code session on the boxholder's own machine, using the Claude in Chrome extension in the real logged-in profile (`browser-task-card.md:26-30`). The boxholder opens the card page, copies the prompt, pastes it into a local session started with `--chrome`.
- Results come back as an upload. The card view has a drop zone that validates records against the schema; the executor drives it with `file_upload` and a Submit click (`browser-task-card.md:191-222`). The upload rides the box session (cookie), not an agent token.
- A drain procedure files the batch. Nothing in the box starts a run. A due task only shows on the dashboard.
- The box cannot see, steer, or interrupt the browsing. There is no channel while the scan runs.
- Open issues: `issues/features/2026-09-17-box-as-mcp-server-hands-out-tasks.md` (make the box an MCP server so one Claude Code session pulls tasks and posts batches), `issues/features/2026-09-21-browser-task-remaining-design-gaps.md`, `issues/features/2026-09-21-browser-task-no-structured-way-to-report-degraded-results.md`.
- Premise recorded in the plan: every working pattern is either an extension in the real browser or a paid cloud browser profile; Chrome 136 closed remote debugging on the default profile.

**b. Pending browser requests (CLI long-poll to browser tab round trip).** `beebox/src/core/pending-browser-request.ts`.
- `create()` parks a promise under a server-minted UUID (never caller-supplied, `:49-57`). A route broadcasts the id to connected tabs; a tab answers `fulfill` (first wins), `reportNone`, or `ack`. Outcomes: `fulfilled | none | timeout | no-client`. With `ackGraceMs`, no ack inside the window gives `no-client` (tab closed, mobile, stale frontend).
- Consumers: `beebox/src/webapp/routes/chat/screenshot-routes.ts` (`bbx chat screenshot`) and `beebox/src/webapp/routes/chat/last-audio-routes.ts` (`bbx chat get-last-audio`), via `beebox/src/core/last-audio-pending.ts`.
- Transport: the agent subprocess calls the route over loopback HTTP with the agent bearer (`screenshot-routes.ts:217`, `verifyAgentBearer`). The server emits a transient `screenshot-request` event on the event bus (`screenshot-routes.ts:242`) to open tabs over the existing tRPC WebSocket. The tab holding that chat session acks, captures, and uploads a PNG to `POST /api/chat/screenshot/:requestId` under the user session. The route writes `<boxRoot>/_tmp/screenshot-<id>.png` and the CLI prints the path.
- Frontend: `beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/screenshot-request-handler.ts`, `ScreenshotConsentPopup.tsx`, `screenshot-relay.ts`.
- This pattern gives request/response with one consent step. It does not carry a stream.

**c. Clerk extension (beebox-clerk/).** Read `beebox-clerk/AGENTS.md`, `beebox-clerk/README.md`.
- Chrome MV3 (WXT). "A surface, not an engine": it routes pages, memos, and tab snapshots into the box's clerk tRPC router (`beebox/src/webapp/trpc/routers/clerk.ts`). The box does the thinking.
- No credentials in the extension. The browser's `bbx_session` cookie authenticates; per-origin host permission is the consent. The box page announces itself with `<meta name="beebox">`.
- Box relay: a runtime-registered content script on enabled box pages relays `capture-request` postMessages to the background, which calls `captureVisibleTab` and re-checks the live tab URL (`beebox-clerk/AGENTS.md`, "Box relay"). Chrome match patterns cannot express a port, so the background's `isUrlUnderBoxUrl` is the real gate.
- Clerk can read and freeze pages (`extract-readable.ts`, `freeze-page.ts`) and arrange tabs. It does not click or fill on the agent's behalf.
- `browser-task-card.md:100` records that two extensions do not cooperate and Claude in Chrome cannot click Clerk's popup.
- Issue: `issues/features/2026-09-05-agent-knows-which-client-and-whether-clerk-is-installed.md`.

## 2. Agent token and browser auth

- `beebox/src/core/agent/token.ts`: per-box loopback token at `.beebox/agent-token` (0600, gitignored, generated on first use). Injected as `BBX_AGENT_TOKEN` into every spawned subprocess; `bbx chat` commands send it as a bearer. The per-box auth wall (`beebox/src/webapp/server-box-scope.ts`) accepts it as box-scoped auth. Any process running as the box user can read it.
- `beebox/docs/implemented-plans/agent-token-browser-auth.md` (historical) is about dev: letting `bin/browse` reach a local dev page. It rejected the agent token as a browser credential, because accepting a file secret at the public front door and exporting it into browser request headers is unsafe. It chose an opt-in `BBX_BROWSE_API_KEY` (`beebox/src/core/browse-key.ts`), accepted as bearer or `bbx_browse_key` cookie at the dev router, hub, and box gates. Reason for a cookie over a header: browsers attach cookies to WebSocket handshakes, not `Authorization` headers.
- The same plan notes a credential riding every request of a shared browser profile has no CSRF protection, and says a shared browser would need that first (accepted for a throwaway dev profile only).
- Relevance: an in-box Chromium that loads the box's own pages needs a box-scoped credential that is not the agent token, is absent by default, and is not valid at the public hub. `issues/features/2026-06-12-agent-browser-scoped-to-box.md` (workstream `shared-browser`, has an uncommitted edit in this worktree) already frames this: a short-lived cookie minted from the agent token, gated to the box prefix, read-oriented first.

## 3. bin/browse and browse/ (dev agents)

- `bin/browse` is a bash wrapper (`bin/browse:1-122`) over the upstream `agent-browser` Chromium CLI; TypeScript source in `browse/src/` (`cli.ts`, `act.ts`, `controls.ts`, `launch-options.ts`, `worktree.ts`, `screenshot.ts`, `clerk-popup.ts`). Agent-facing guidance: `.claude/skills/browse/SKILL.md` and its `references/`.
- agent-browser runs a per-worktree daemon (socket dir `AGENT_BROWSER_SOCKET_DIR`) and a per-worktree Chrome profile under `~/.cache/beebox/browse/<worktree>/`, plus one profile per `--session` because Chrome's SingletonLock allows one instance per profile. Idle timeout 5 min by default.
- Commands: `open`, `snapshot -i` (accessibility tree with `bbx-` ids), `click`, `fill`, `screenshot`, `get`, `scroll`. The wrapper adds app-readiness waits, stale-ref refusal, geometry checks on clicks.
- It is dev-only: `deploy.sh` marks agent-browser dev-only and the image has no Chromium (`issues/features/2026-10-04-fetch-blocked-pages.md:88-90`).
- `BROWSE_CLERK=1` loads the Clerk test build; loading any extension forces headed mode.
- Known problems that apply to any managed Chromium: `issues/bugs/2026-08-14-hand-launched-chrome-for-testing-unreapable.md` (a stray Chrome burned 21h CPU), `issues/bugs/2026-10-22-perf-load-hangs-silently-on-a-wedged-browse-daemon.md`, `issues/bugs/2026-08-09-agent-browser-wheel-dispatch-flaky.md`. Reaping lives in `bin/process-cleanup.ts`.

## 4. Production topology

- One Ubuntu VPS, many boxes (`beebox/deploy/README.md`, `beebox/docs/server/provisioning.md:95-130`). Per-box isolation (`beebox/docs/implemented-plans/per-box-units.md`): Linux user `bbx-<slug>` (UID 2000-2999) with home `/var/lib/beebox/<slug>/`; hub user `beebox` routes to `/run/beebox/<slug>.sock`; scheduler user `beebox-sched` with one sudo grant (`bbx-box-run`).
- `beebox-box@<slug>.service` runs `bbx engine serve` and exits after 30 idle minutes; the socket reactivates it. The agent subprocesses (Claude Code, Codex) run inside that unit's cgroup.
- Sandbox drop-in `beebox/deploy/systemd/box-sandbox.conf`: `ProtectSystem=strict`, `ProtectHome=yes`, sibling boxes hidden by `TemporaryFileSystem`, `PrivateTmp=yes`, `NoNewPrivileges=yes`, `MemoryHigh=1G`, `MemoryMax=2G` (whole cgroup, "first guess, to be measured"). Chromium would count against that 2 GB with the engine, the Claude subprocess, and Docling.
- Egress: no network filtering exists in `deploy/` (no `IPAddress*`, `RestrictAddress*`, `PrivateNetwork`, nftables). Egress control is by credential, not by network: `beebox/docs/design/privacy-and-egress.md`, `beebox/docs/security-report.md` section 3. SSRF guards cover only server fetches (`proxy-image.ts`, `url-fetch.ts`). A box agent can already reach any host the server can reach, including `127.0.0.1:3210`. Other boxes' sockets and homes are hidden by the filesystem view only. A browser that follows arbitrary links would reach loopback, cloud metadata, and the hub port unless filtered.
- Server egress IP is a datacenter address (Hetzner example provisioner). Sites that block datacenter IPs would block it.
- Docker image (`beebox/docker/Dockerfile`): `node:24-bookworm-slim`; apt installs pandoc, imagemagick, poppler, ffmpeg, git, git-annex, sudo, and others (lines 97-101). No Chromium, Playwright, or browser fonts. The image carries `bbx-host-apt` with a NOPASSWD sudoers entry so a box can `bbx host install <package>` (distro packages only, exact names, no services/setuid, logged; `docs/implemented-plans/box-host-packages.md`, `docs/security-report.md:417`). Installs are host-wide. On a unit host the sandbox sets `NoNewPrivileges`, so `bbx host install` only records the package and the deploy installs it (`box-sandbox.conf` comment). Debian `chromium` is an apt package; Ubuntu's `chromium-browser` is a snap and would not install this way. Chromium's setuid sandbox conflicts with `NoNewPrivileges=yes`; it would run with user namespaces or `--no-sandbox`.
- Per-box volume: production boxes live on a volume at `/var/lib/beebox` (snapshots exclude it).

## 5. Auth wall, router, CSP, WebSocket proxying

- Auth wall: `beebox/src/webapp/server-box-scope.ts` (per-box), hub gate in `beebox/src/hub/server/core.ts`. Session cookie, agent bearer, mobile bearer, and the opt-in browse key are accepted at box scope. Boxes are path siblings on one origin (`/<slug>/...`); `docs/content-security-policy.md` states cross-box isolation is single-operator by design, with ambient same-origin access between one operator's boxes. Per-box origins are listed as a future step if content is shared across people.
- CSP: `beebox/src/lib/csp.ts:35-44`, Report-Only today (`Content-Security-Policy-Report-Only`, set in `beebox/src/webapp/server-root/root-routes.ts`). Directives: `default-src 'self'`; `connect-src 'self'` plus Deepgram and OpenAI https/wss; `frame-src 'self' https://www.youtube-nocookie.com`; `frame-ancestors 'self'`; `script-src 'self'` in prod; `img-src 'self' data: blob: https:`; `media-src 'self' blob:`; `worker-src 'self'`; `object-src 'none'`.
- Consequences once enforced: a viewer iframe from the same origin passes `frame-src 'self'`. A viewer on another origin (a separate port, subdomain, or a hosted service) needs that origin added to `frame-src` and, for a WebSocket/WebRTC/SSE stream from it, to `connect-src`, plus a test update in `test/lib/csp.test.ts` (the doc's "Adding a new external origin" rule). `frame-ancestors 'self'` means a same-origin framed page can be embedded, and a viewer page that frames the app cannot. `media-src` has no `mediastream:`; a WebRTC `<video>` fed by `srcObject` is not governed by `media-src`, but a blob/MSE path is covered by `blob:`.
- Frozen captured pages already use a strict per-route policy `sandbox allow-scripts; script-src '<hash>'` (`beebox/src/webapp/routes/api/register/files.ts:40-45`), which the global hook yields to. This is the existing precedent for serving untrusted HTML framed with an opaque origin.
- WebSocket proxying: nginx forwards `Upgrade`/`Connection` with `proxy_read_timeout 86400` (`beebox/deploy/nginx/beebox.conf:30-35`). The hub owns the `upgrade` event on its server (`beebox/src/hub/server/core.ts:541`), applies the same cookie/bearer gate, then proxies to the box socket. WebSocket upgrades never wake a sleeping box (`core.ts:198`, `socket-provider.ts:12`); a viewer socket needs the box already running, so the HTTP page load must wake it first. The dev router has the same rule (`bin/AGENTS.md`).
- Only one WebSocket route is documented today (tRPC). A second upgrade path on the box socket (a screencast or input channel) would pass the same gate if the box serves it; a service outside the box process would need its own hub route or origin.
- Idle exit: a box unit exits after 30 idle minutes. A live browser session needs to count as activity or it dies with the box.

## 6. Secrets and profile placement

- `beebox/docs/secrets.md`: connector credentials live in one machine-level store (`~/.config/beebox/secrets.json`, 0600, outside every box tree) with per-box grants. In production each box user also has its own store at `/var/lib/beebox/<slug>/.config/beebox/secrets.json`, outside `box/` (`docs/server/provisioning.md:112-118`). Grants are keyed by box slug.
- Box layout (`beebox/docs/box-layout.md`): the box root is a git repo with a closed top-level vocabulary. `.beebox/` is runtime and mostly gitignored; `_tmp/` is scratch, not committed, swept by wakeup housekeeping (so unsuitable for a long-lived profile). Box content is committed and backed up with restic; a cookie jar in the box repo would enter history and backups.
- Placement that fits existing rules: a Chromium user-data directory outside `box/`, such as `/var/lib/beebox/<slug>/.config/beebox/browser-profile/` in production (inside the box user's home, hidden from siblings by `box-sandbox.conf`, outside git, outside the box repo's backup scope unless backup is extended). Locally the equivalent is a path next to `~/.config/beebox/`. It is already writable: `ReadWritePaths` covers `/var/lib/beebox/%i`.
- A login the person types into this browser is a new kind of secret: a session cookie. The secret store has no entry type for it. Agents running as the box user can read the profile directory, same trust boundary as the agent token.

## 7. UI surfaces for embedding

- Existing iframe/embedded content: `beebox/src/frontend/src/components/ui/VideoEmbed.tsx` (YouTube nocookie iframe), `PdfFrame.tsx` (`<object>` on purpose, sandboxed viewer), frozen captured pages (sandboxed iframe, section 5), theme studio harness (`ThemeStudioHarness/view.tsx:111`, dev only). Box views run as same-origin compiled ES modules (`docs/content-security-policy.md`); a figure needing eval is told to iframe-isolate.
- Card/view registry: `registerFileType` in `beebox/src/frontend/src/file-type-registry.ts:125` binds a card type to a view. A browser-task-like card, or a new `browser` card type, could register a view hosting the viewer. Panels and layouts: split pane on desktop; `issues/features/2026-07-23-mobile-modal-not-split-pane.md` notes mobile uses a modal.
- Chat: the interactive chat shell is `.../chat/everywhere/InteractiveChat/` (`shell.tsx`, consent popup precedent for agent-initiated requests that need the person). The consent popup is the existing handoff pattern for "agent needs the person now".
- Mobile: the iOS app is a WKWebView of the web app (`ios-app/BeeBox/Views/ChatWebView.swift`); contract in `beebox/docs/mobile-contract.md` section 3 (webview embedding) and section 4 (bridge channels `beeboxNativePost`). `decidePolicyFor` refuses main-frame loads off `allowedOrigin` (`mobile-contract.md:286`), so a viewer on another origin must be framed (subframe), not navigated. The mobile token lives in localStorage and is sent as `Authorization`, so a subframe from another origin would not carry it. `getDisplayMedia` is unsupported on mobile Safari (`screenshot-capture.ts` returns `unsupported`), so the screenshot relay does not work there.
- Touch input, on-screen keyboard, and pinch/scroll inside a remote-rendered frame are not addressed anywhere in the repo.

## 8. Agent engines and tool delivery

- Engines: Claude Code via `@anthropic-ai/claude-agent-sdk` and Codex via `@openai/codex-sdk` (`beebox/package.json:142,149-150`). Code: `beebox/src/core/agent/` (`invoke/run.ts`, `codex-agent.ts`, `codex-run/`, `box-session-settings.ts`). Chat services: `beebox/src/services/claude-chat/`, `beebox/src/core/chat/`; docs `beebox/docs/chat/`.
- Tools are given as shell commands, not MCP. Agents get file/shell/web built-ins plus the `bbx` CLI, documented by the always-loaded agent guide (`beebox/src/core/agent-guide/guide.md`, ledger-governed budget; `beebox/docs/agent-guide.md`) and by `--help`. `run.ts:110` sets `skipMcpDiscovery: true`. `disableClaudeAiConnectors: true` and `disallowedTools: HOST_ACCOUNT_TOOLS` in `box-session-settings.ts`. No MCP server is wired to box agents today; `issues/features/2026-09-17-box-as-mcp-server-hands-out-tasks.md` proposes the box as an MCP server for an external session.
- Subprocess env: `buildScriptEnv` (`beebox/src/core/script-env/core.ts`, allowlist in `allowlist.ts`) injects `BBX_AGENT_TOKEN`; the CLI sends it via `loopbackHeaders()`.
- A browser tool would most naturally be `bbx browser ...` subcommands calling loopback routes with the agent bearer, the same shape as `bbx chat screenshot` (`beebox/src/cli/commands/chat/ui.ts`, `command.ts`). Both engines already run `bbx`. New CLI surface costs agent-guide budget, so mechanics belong in a package doc or skill, with at most a pointer in the guide.
- Screenshot today: `screenshot-capture.ts` uses `getDisplayMedia` with current-tab hints, a one-shot PNG of the user's viewport. Issue `issues/features/2026-10-29-box-agent-cannot-see-its-own-visual-work.md` states the agent cannot see a view it built; a server-side browser would also serve that need. Related: `issues/features/2026-10-05-box-agent-interface-screenshots.md`.

## 9. mac-app/ and residential IP

- `mac-app/README.md`: menu-bar app that pairs with boxes, uploads watched folders and Photos, and can run the beebox image in a VM through Apple's Containerization (off by default). Findings: `research/installable-app/phase1-spike-app.md` (works; memory, stable address, image delivery open). The VM gets a bridge address that changed across launches (192.168.64.3, 65.2, 66.2); a bundled app hit "Local network prohibited" reaching it.
- A box in that VM egresses from the Mac's network, so its outbound IP is the person's home or office IP. That IP class passes many bot checks that a datacenter IP fails. No code exists for this use. The VM image has no Chromium either; `research/installable-app/runtime-inventory.md` lists the image's contents and drift from the server.
- A laptop sleeps; "a laptop that sleeps is not reachable" (`research/installable-app/README.md`, finding 1). A browser session hosted there stops when the lid closes.
- A native Mac process (not the VM) would run with the person's own profiles and keys; the research note counts that as lost containment.
- Issue: `issues/features/2026-10-07-mac-companion-app.md`.

## 10. Existing issues that touch browsers

- `issues/features/2026-06-12-agent-browser-scoped-to-box.md`: give each box agent an authenticated, box-scoped agent-browser to see rendered views; workstream `shared-browser`.
- `issues/features/2026-10-04-fetch-blocked-pages.md`: agents cannot read Reddit, Instagram, and others; records that the image has no Chromium; excludes stealth browsers and residential-proxy fetchers on principle (they evade bot detection).
- `issues/features/2026-09-11-server-side-webpage-capture.md`: capture a page into a card without a browser.
- `issues/features/2026-09-17-box-as-mcp-server-hands-out-tasks.md`: box as MCP server for browser-task work.
- `issues/features/2026-09-21-browser-task-remaining-design-gaps.md` and `...-no-structured-way-to-report-degraded-results.md`: browser-task feedback.
- `issues/features/2026-10-29-box-agent-cannot-see-its-own-visual-work.md`, `2026-10-05-box-agent-interface-screenshots.md`: agent vision of the app.
- `issues/features/2026-09-05-agent-knows-which-client-and-whether-clerk-is-installed.md`: client awareness.
- `issues/features/2026-10-07-mac-companion-app.md`: Mac app, optionally hosts a box.
- `issues/features/2026-07-17-regenerable-app-demo-video.md`: Playwright `recordVideo` vs agent-browser CDP screencast (a capture precedent).
- `issues/bugs/2026-08-14-hand-launched-chrome-for-testing-unreapable.md`, `2026-10-22-perf-load-hangs-silently-on-a-wedged-browse-daemon.md`, `2026-08-09-agent-browser-wheel-dispatch-flaky.md`: Chromium lifecycle and input problems seen in dev.
- `issues/bugs/2026-09-07-ios-open-directory-webview-freeze.md`: iOS webview freeze, relevant to a heavy embedded frame.
- No issue mentions captcha handoff or residential IP as a feature request (grep of `issues/` for captcha, residential, playwright, chromium).

## Constraints for an embedded browser

1. No Chromium ships in the image or on the server. Adding one is a new image/provision dependency (apt `chromium` on Debian; the `bbx host install` wrapper is host-wide and distro-only). Image size and arm64/amd64 parity need a decision.
2. Per-box cgroup limit is 2 GB total (`MemoryMax=2G`), shared with the engine and the agent subprocess. A per-box Chromium needs its own budget or a separate unit, and idle exit (30 min) must account for a live session.
3. A browser run by `bbx-<slug>` inherits `NoNewPrivileges`, `ProtectHome`, and a private `/tmp`. Chromium's sandbox needs user namespaces or is disabled; the choice weakens or keeps the isolation and is a security-report row.
4. No network egress filter exists. A browser that follows links reaches loopback, the hub, cloud metadata, and private ranges unless blocked. This is a new SSRF-class surface, larger than the existing server fetch guards.
5. The browser profile (cookies) belongs outside the box git repo and `_tmp/`, in the box user's home config area. It is a secret in practice; backup scope and the secret store need an explicit decision.
6. Credentials for the in-box browser must not be the agent token or any file secret valid at the public hub. Follow the `BBX_BROWSE_API_KEY` precedent: opt-in, cookie-carried (WebSockets), box-scoped. Same-origin ambient access between boxes is accepted only for single-operator deployments.
7. CSP is Report-Only now but `frame-src` allows only `'self'` and YouTube; `frame-ancestors 'self'`. A same-origin viewer needs no CSP change. Another origin needs `frame-src` and `connect-src` entries and a test change before the policy is enforced. Frozen-page sandboxing is the existing way to frame untrusted content.
8. Streaming must pass nginx and the hub WebSocket gate (`Upgrade` forwarded, 24 h read timeout). WS upgrades never wake a stopped box, so the page load must start it first.
9. The iOS webview refuses main-frame navigation off the box origin and carries its token in localStorage/`Authorization`. Cross-origin viewer frames would not be authenticated; a same-origin path through the hub avoids this. Mobile Safari has no `getDisplayMedia`.
10. Handoff has precedent: the pending-request primitive (ack, no-client, timeout) and the consent popup in the chat shell. A live session needs a longer-lived state model than a request/response; the primitive does not carry streams or lease/ownership.
11. Agent tooling fits the `bbx` CLI + loopback bearer shape; no MCP is configured for box agents. Both engines can call it. Guide budget limits how much of it can be always-loaded.
12. Server IP is a datacenter address. Sites that block such IPs need the browser on a person-controlled network (mac-app VM, home server) or the person's own Chrome (Clerk, Claude in Chrome). The repo's stated policy excludes stealth and residential-proxy evasion.
13. Existing cross-origin and one-request-at-a-time assumptions: Clerk's relay authorizes by live tab URL under an enabled box URL, and the `bbx chat screenshot` flow targets one chat session. A shared browser has its own tab identity and needs its own authorization rule.
