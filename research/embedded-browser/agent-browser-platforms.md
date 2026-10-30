# Open-source browser infrastructure for agents

Date: 2026-10-29. Scope: self-hostable servers that run Chromium, expose CDP
to an agent, and offer a live view a person can use. Question for beebox: can
any of them be the shared browser behind an embedded card/panel (desktop web,
mobile Safari, the iOS webview) that the box agent and the person drive in
one session, with handoff in both directions?

Method: GitHub API (`gh api`, `gh search issues`) for licence, stars, release
and push dates; shallow clones read for code paths (not run, not installed);
vendor docs fetched for the hosted products. Star and issue counts are
snapshots from 2026-10-29. Clone paths below are relative to the repo root of
the named project. Items marked (unverified) were not confirmed in code or
docs.

Two live-view designs recur, and they decide most of the table:

- **CDP screencast.** The server calls `Page.startScreencast`, sends JPEG
  frames over a WebSocket, and replays mouse/keyboard events with
  `Input.dispatch*`. It sees one page, not the OS window. It needs no X
  server, so it runs headless and unprivileged.
- **Display streaming.** Headful Chromium on Xvfb, streamed with VNC/noVNC or
  WebRTC (Neko). It sees the whole window including native dialogs, file
  pickers, and `<select>` popups. It needs X, a VNC or WebRTC server, and
  more memory per session.

## Comparison table

| Project | Licence (SPDX) | Live view | Takes input | Mechanism | Handoff control | CDP for agent | Stars / last push |
|---|---|---|---|---|---|---|---|
| vercel-labs/agent-browser | Apache-2.0 | yes, WS stream + dashboard | yes: mouse, keyboard, touch | CDP screencast JPEG | none found | yes (`--cdp`, `connect`) | 44.9k / 2026-10-29 |
| steel-dev/steel-browser | Apache-2.0 | yes, `debugUrl` viewer | yes: mouse, keyboard (no touch found) | CDP screencast JPEG q75 | none found | yes (WS proxy) | 7.9k / 2026-10-29 |
| kernel/kernel-images | Apache-2.0 | yes, embedded | yes (read-only flag exists) | Neko WebRTC or noVNC | Neko multi-user host | yes (9222 + proxy) | 1.1k / 2026-10-29 |
| Skyvern-AI/skyvern | AGPL-3.0 | yes | yes | noVNC (RFB) and CDP screencast | explicit agent/user interactor + take-control | internal (Playwright) | 23.3k / 2026-10-29 |
| LvcidPsyche/auto-browser | MIT | yes, noVNC page | yes | Xvfb + x11vnc + noVNC | `request_human_takeover` MCP tool | no raw CDP; MCP + REST | 0.9k / 2026-10-29 |
| browserless/browserless | SSPL-1.0 OR commercial | debugger only in OSS; "hybrid" live view is paid | debugger: yes (unverified); hybrid: yes | JPEG frames over WS (hybrid) | pause/resume in hybrid (paid) | yes | 13.9k / 2026-10-29 |
| AetherAI3/agent-browser | Apache-2.0 | yes, noVNC | yes | Xvfb + x11vnc + noVNC | session owned by one caller; human types in same window | no raw CDP | 14 / 2026-10-27 |
| floomhq/openbrowser | MIT | portal links for auth | auth steps only | (unverified) | "human auth handoff" | broker API | 16 / 2026-07-02 |
| lightpanda-io/browser | AGPL-3.0 | none | none | no rendering engine | none | yes (CDP, partial) | 37.6k / 2026-10-29 |
| m1k1o/neko | Apache-2.0 | yes | yes | WebRTC | host role, multi-user | no (not an agent server) | 22.6k / 2026-10-28 |
| SeleniumHQ/docker-selenium | Apache-2.0 (GitHub shows NOASSERTION) | noVNC on 7900 | yes | x11vnc + noVNC | none | WebDriver; CDP proxied by Grid | 8.7k / 2026-10-29 |
| aerokube/moon | closed source (repo is tracker) | VNC | yes | VNC | none | WebDriver, Playwright, Puppeteer | 0.3k |
| browser-use/browser-use | MIT | none in OSS; `liveUrl` in Cloud | n/a | n/a | n/a | library, not server | 119.5k / 2026-10-27 |
| Browserbase (Stagehand) | MIT (library) | Cloud only | Cloud only | Cloud only | Cloud only | n/a | 25.9k |

## Steel Browser (steel-dev/steel-browser)

Apache-2.0 (GitHub API). 7,888 stars, 74 open issues. Latest release
v0.5.4-beta on 2026-08-25; pushes continue daily. Company-backed (steel.dev)
with a hosted cloud; contributor and funding details not checked.

- **Live view.** `api/src/plugins/browser-socket/casting.handler.ts` (487
  lines) opens a WebSocket per tab. It calls `Page.startScreencast` with
  JPEG quality 75 at the session viewport (line 395) and acks frames
  (`Page.screencastFrameAck`). Each frame message carries page URL, title,
  and favicon. Inbound messages are `mouseEvent`, `keyEvent`, `navigation`,
  `closeTab`, and `getSelectedText`, applied with `Input.dispatchMouseEvent`
  and `Input.dispatchKeyEvent` (lines 300-330). No touch event case exists.
  Viewport uses `Page.setDeviceMetricsOverride` with a mobile preset
  (508x1074, scale 3) when the session device is mobile.
- **Embedding.** Issue #270 (2026-03-22, open) shows the intended pattern:
  `<iframe src="{debugUrl}?interactive=true">`. The same issue reports that
  on iOS Safari, keyboard input inside the iframe is broken: backspace does
  nothing and text arrives in uppercase. That matches the code: the viewer
  sends key events, not text input, so an iOS soft keyboard has nothing
  focused to type into. Issue #333 (open) says the session viewer ignores
  the session in the URL and shows the first session.
- **Agent interface.** CDP WebSocket proxy for Playwright/Puppeteer
  `connectOverCDP`, REST session API (`POST /v1/sessions` with `proxyUrl`,
  `userAgent`, `sessionContext`, `blockAds`, `optimizeBandwidth`). An
  experimental Commands API (`docs/COMMANDS.md`, enabled by
  `ENABLE_COMMANDS_API=true`) gives snapshot-then-act with element refs,
  tabs, and an `expect` guard that fails when an element differs from what
  the agent expected. Selenium compatibility exists (`modules/selenium`).
- **Persistence.** `CHROME_USER_DATA_DIR` sets the profile directory;
  `cdp.service.ts` takes a profile lock and clears stale locks
  (`utils/profile-lock.ts`). `sessionContext` restores cookies and storage
  into a new session.
- **Isolation.** One active session per server process
  (`sessionService.activeSession` in the cast handler). A second user needs
  a second container. Docker is the documented path.
- **Stealth/proxy.** Proxy chain management, fingerprint options, stealth
  plugins (README lines 52-55); strength unmeasured here.
- **Handoff.** No lock or take-control state found. Agent and viewer both
  send CDP input; they interleave.

## Kernel images (kernel/kernel-images; formerly onkernel)

Apache-2.0. 1,118 stars, 73 open issues, pushed 2026-10-29 (HEAD commit
2026-10-28). The repo is the image behind the hosted Kernel product (VC-backed
company, `kernel.sh`). No GitHub releases; tagged images only (unverified).
This is the most complete open piece found for the target use case.

- **Live view.** Headful Chromium on Xorg with Neko (m1k1o) streaming over
  WebRTC, or noVNC when `ENABLE_WEBRTC=false` (`README.md` lines 140-146).
  Read/write by default; `ENABLE_READONLY_VIEW=true` makes it watch-only.
  Resizing and clipboard work in the WebRTC client. Audio is non-functional
  per the README. Kernel carries a fork of the Neko Vue client in
  `images/chromium-headful/client/` and a Neko base image
  (`ghcr.io/kernel/neko/base`).
- **Mobile.** The client has code written for phones:
  - `client/src/utils/touch-gestures.ts` (240 lines): tap, long-press (release
    is right click, move is drag), one-finger scroll with momentum, pinch.
  - `client/src/utils/soft-keyboard.ts` (44 lines): detects whether a soft
    keyboard is up from `visualViewport` height, with an iOS note.
  - `client/src/utils/field-keyboard.ts` (162 lines): copies the remote
    field's `inputmode`, `autocomplete` (one-time code), `autocapitalize`,
    and `enterkeyhint` onto a local overlay input so iOS shows the right
    keyboard and AutoFill.
  - `client/src/utils/remote-focus.ts` (172 lines) plus
    `server/lib/livefocus/` (Go: `watcher.go`, `watcher.js`, `handler.go`):
    the server injects a watcher into the page, reports the focused
    editable field and on-screen field rects over server-sent events at
    `/live-view/focus`, and exposes a blur endpoint for a dismissed
    keyboard. `chrome_e2e_test.go` tests search, password, one-time-code,
    contenteditable, covered, disabled, and iframe fields.
  These solve the problem Steel #270 reports. Whether it works on iOS in
  practice was not tested here. Open Neko issues on iOS exist (m1k1o/neko #719
  clicks after the first ignored, #626 WebKit crash via live URL).
- **Agent interface.** Chromium on `--remote-debugging` port 9222 plus
  `server/lib/devtoolsproxy` (CDP proxy with an observer and an egress gate).
  The Go API (`server/openapi.yaml`, 2,100+ lines) adds `/computer/*`
  (click, move, type, press_key, scroll, drag, screenshot, clipboard
  read/write), `/process/*`, `/fs/*` (upload, download, watch),
  `/playwright/execute`, `/webmcp/*`, `/recording/*` (H.264 mp4), `/chromium/flags`,
  `/chromium/policies`, `/network/egress-policy`, `/webauthn/hook`.
  Because OS-level input goes through X (`xf86-input-neko`), it reaches
  native dialogs that CDP cannot.
- **Handoff.** Neko's role model: `neko.yaml` defines admin and user
  profiles with `can_host` and `can_access_clipboard`. Neko has one "host"
  who controls input; others watch. Agent/human arbitration is not built in:
  the agent uses CDP or `/computer/*` while the human uses Neko input.
  A `livefocus` flag lets a client know when the page wants text input
  (inferred from `watcher.js`; no pause API found).
- **Persistence.** `--user-data-dir=~/user-data` (as the `kernel` user); the `/fs`
  routes zip and restore directories (`download_dir_zstd`,
  `upload_zstd`). Unikraft standby snapshots exist in the hosted product
  only.
- **Isolation and cost.** `run-docker.sh` uses `--privileged` and
  `--tmpfs /dev/shm:size=2g`; the Dockerfile sets `USERNAME=root`. Xorg,
  Neko, Chromium, and the API run under supervisord. One browser per
  container. This conflicts with beebox's per-Unix-user model and would need
  rework to run as the box user without `--privileged`.
- **Stealth.** Humanizing helpers exist in `server/lib/mousetrajectory` and
  `typinghumanizer`; fingerprint-level stealth is in the hosted product
  (unverified).

## Skyvern (Skyvern-AI/skyvern)

AGPL-3.0 (LICENSE file; README says anti-bot measures are cloud-only).
23,303 stars, 292 open issues, release v1.0.56 on 2026-10-14, pushed
2026-10-29. VC-backed company; cloud and OSS are the same repo.

- **Live view and handoff.** `skyvern/forge/sdk/routes/streaming/`:
  `channels/vnc.py` (693 lines) passes noVNC RFB frames through and filters
  keyboard/mouse by an `Interactor = Literal["agent","user"]` (line 61).
  Input from the browser is dropped unless the interactor is `user` (line
  426). `channels/message.py` (840 lines) carries a JSON side channel for
  take-control, copy/paste coordination, and handoff. The frontend
  `skyvern-frontend/src/components/BrowserStream.tsx` (1,007 lines) has an
  `interactive` prop and a `TakeControlButton` ("a click anywhere on the
  picture takes control", line 954).
- **CDP screencast variant.** `screencast.py` (506 lines) streams
  `Page.startScreencast` JPEG frames, and `cdp_input.py` (879 lines) is the
  interactive input channel (mouse, keys, paste, navigation) with URL
  validation. The channel README says first-party sessions use VNC and
  vendor-held sessions without an RFB endpoint use CDP screencast.
- **Mobile.** `novncGestureCrashGuard.ts` (29 lines) and
  `browserStreamClipboard.ts` (160 lines) exist; mobile quality not tested.
- **Agent interface.** Skyvern is an agent product (LLM plus Playwright), not
  a CDP server for another agent. External CDP access (unverified).
- **Licence effect.** AGPL-3.0 on a server component linked to a hosted
  service requires source disclosure of modifications to network users.
  Copying files into beebox imports that obligation. Reading the design is
  free.

## Auto-Browser (LvcidPsyche/auto-browser)

MIT. 914 stars, 4 open issues, created 2026-03-09, release v1.11.2 on
2026-10-29. One primary author (LvcidPsyche) plus a few contributors.
Community project; no company.

- **Fit.** The README describes the target directly: "a shared Playwright
  browser with human takeover, reusable auth profiles, approvals, audit
  trails." MCP over HTTP for Claude Code and Codex, plus a stdio bridge and
  REST. Curated 20-tool MCP profile; a 7-tool "lean" profile includes
  observe, screenshot, `execute_action`, `get_html`, `find_elements`,
  human takeover, close.
- **Live view.** noVNC at `:6080/vnc.html` from an Xvfb display (`resize=scale`).
  Interactive. Takeover is a URL, not an embeddable component. The docs
  advise Cloudflare Access or Tailscale in front (`docs/deployment.md`).
- **Handoff.** `request_human_takeover` MCP tool (`docs/architecture.md`
  line 188). The agent asks; noVNC is the recovery path. No input lock
  between the agent and the human was found.
- **Isolation.** Default `SESSION_ISOLATION_MODE=shared_browser_node`: one
  Chromium, one noVNC desktop, `MAX_SESSIONS=1`; the docs warn that a person
  taking over one session can see the others. `docker_ephemeral` mode gives
  each session its own container.
- **Persistence.** Named auth profiles: log in once, reopen later signed in.
- **CDP.** `controller/app/cdp/passthrough.py` allows only a read-only
  allowlist of CDP commands. A Playwright client cannot attach through it.
- **Risk.** Young repo, one author, large surface (approvals, witness
  receipts, mesh, cron, provider registry). The README says an internal audit
  found "safety controls which reported success while doing nothing."

## Vercel agent-browser (vercel-labs/agent-browser)

Apache-2.0. 44,856 stars, 701 open issues, created 2026-01-11, v0.41.0 on
2026-10-29. Vercel Labs; high commit cadence. Rust CLI and daemon speaking CDP
directly; not a server-with-viewer in the Steel sense, but its stream is the
cleanest small implementation of the protocol beebox would build.

- **Stream protocol** (`docs/content/docs/streaming.mdx`,
  `cli/src/native/stream/websocket.rs`, `cdp_loop.rs`): every session starts a
  WebSocket server. Server sends `frame` (base64 JPEG, `seq`, device
  metadata with scroll offsets and capture timestamp), `url`, and `status`.
  Client sends `input_mouse`, `input_keyboard`, `input_touch`
  (`Input.dispatchTouchEvent`), `config` (`maxFps`, `pacing: "ack"`), and
  `ack`. Frames are latest-first with no backlog. Input is read on a separate
  task so clicks do not wait for a large frame write. Input resets the daemon
  idle timer.
- **Origin rule.** The upgrade accepts only localhost, 127.0.0.1, ::1 or
  `file://` origins; others get 403 and need a proxy. The dashboard
  (`agent-browser dashboard start`, port 4848, `packages/dashboard`, Next.js)
  has `--allowed-origins` for a reverse proxy with a token fragment URL.
- **Agent side.** CLI commands with accessibility snapshots and refs; `--cdp
  <port>` or `connect` attaches to an existing Chrome; `--session` with
  `--pin-tab` pins sessions to tabs on a shared Chrome; `--profile`,
  `--state` (save/restore auth JSON), `--restore`.
- **Handoff.** None found. Docs call it "pair browsing" where a human
  "can watch and interact alongside an AI agent." Both can issue input at
  once.
- **Mobile.** Touch input exists in the protocol. Soft keyboard handling not
  found (unverified).

## Browserless (browserless/browserless)

Dual licence: SSPL-1.0 OR Browserless Commercial License (README line 235;
LICENSE file). GitHub reports NOASSERTION. SSPL is not an OSI licence; the
README says closed-source commercial use, including CI, needs a purchased
licence. 13,873 stars, 14 open issues, v2.58.0 on 2026-10-29. VC-backed
company.

- **OSS features.** Puppeteer/Playwright WebSocket endpoint, REST (`/content`,
  `/screenshot`, `/pdf`, `/scrape`, `/function`), and a "Debug Viewer"
  (`LEARN_MORE.md` line 110: install with `npm run install:debugger`).
- **Paid features.** The README lists "Hybrid automations for streaming live
  browser sessions," persistent sessions, session replay, extensions, stealth
  routes, captcha solving, and residential proxy as Premium.
- **Hybrid automation** (docs.browserless.io, fetched 2026-10-29): the script
  calls `Browserless.liveURL` over CDP, the person opens the link, and the
  script resumes when finished. Default is click, type, scroll, touch, tap;
  `interactable: false` makes it view-only. Frames are JPEG quality 70 over
  a same-origin WebSocket. The page says the URL can be embedded in an app.
  Whether the open-source image includes it was not stated; the README lists
  it as premium.
- **Persistence/isolation.** Chromium per connection; `userDataDir` support
  in launch args. Persistent state is premium.
- **Reading.** Useful as a design reference for "script pauses, hands a URL
  to a person." Not adoptable under beebox's licence preference.

## AetherAI3/agent-browser

Apache-2.0 source (Chrome itself has Google terms). 14 stars, 13 open
issues, created 2026-04-14, pushed 2026-10-27. Individual author, no release
cadence evidence.

One headed Chrome session, a JSON API, MCP, and a noVNC view of the same
display. README demo: agent signs in, stops at 2FA, a human types the code,
the agent resumes. The security section says noVNC is unauthenticated in
v0.x and meant for numeric loopback; there is "no arbitrary JavaScript,
shell, filesystem, upload, clipboard, download, or raw CDP API." No raw CDP
removes it as a Playwright target. The name overlaps with Vercel's
agent-browser; the two are unrelated.

## Other open projects checked

- **floomhq/openbrowser** (MIT, 16 stars, pushed 2026-07-02): broker with
  persistent Chrome profiles, proxy identities, remote API, MCP tools, and
  "human auth handoff" via one-time portal links. Live view mechanism
  unverified. Tiny community.
- **Other "OpenBrowser" repos** are unrelated projects sharing the name:
  ntegrals/openbrowser (9.6k stars), sheying2013/OpenBrowser (778). Not
  examined.
- **ariya/remotebrowser** (AGPL-3.0, 0 stars) and **ReinforceNow/browserstation**
  (MIT, 164 stars, last push 2025-09-27): hosting frameworks; no live view
  found in the descriptions.
- **MemberJunction self-hosted driver** (docs.memberjunction.org): a driver
  inside that framework that serves a viewer URL from the CDP screencast.
  Not standalone; not examined further.
- **Open Browser Use** (Product Hunt, MIT per listing): local Chrome extension
  plus native host; local only.
- **Hyperbrowser.** The `HyperAgent` repo is AGPL-3.0 (LICENSE file begins
  "GNU AFFERO GENERAL PUBLIC LICENSE"); GitHub shows NOASSERTION. The browser
  infrastructure and live view are the hosted product. Nothing server-side
  to self-host found.
- **Browserbase.** Stagehand (MIT, 25.9k stars) is a library; it can drive a
  local Chrome (`localBrowser.launch({ userDataDir })`). The MCP server repo
  `mcp-server-browserbase` is archived (Apache-2.0). Live view is Cloud
  only; docs (docs.browserbase.com/features/live-view) embed it with an
  iframe and say "Mobile keyboards aren't officially supported"; mobile text
  input must be forwarded to the script as key presses.
- **Cloudflare Browser Run** has live view and human handoff; hosted, not
  open source.
- **Camoufox / stealth forks, chrome-devtools-mcp.** Not examined.

## Lightpanda (lightpanda-io/browser)

AGPL-3.0. 37,644 stars, 118 open issues, release 1.0.2 on 2026-10-23.
Company-backed. A Zig browser with a CDP server (port 9222) and WebDriver
BiDi, built for agents. The README states "No graphical rendering engine." It
supports `--dump` for text output; a PNG dump is a text-only rendering. Issue
#2140 (open) requests screencast "useful for agent-browser dashboard mode."
There is no pixel output a person could watch or drive. Use case for beebox:
a cheap headless fetcher for read-only agent browsing, not the shared
session. Claims of partial CDP/Playwright compatibility are tracked in
issue #3076 (open).

## Display-streaming building blocks

- **Neko** (m1k1o/neko, Apache-2.0, 22.6k stars, v3.2.0 on 2026-10-15): the
  WebRTC virtual browser behind Kernel's live view. Multi-user with a host
  role. Open iOS issues (#719, #626, #640, #318). Docs index does not describe
  embedding or mobile (fetched page lacked it).
- **Selenium Grid 4 / docker-selenium** (SeleniumHQ; Apache-2.0 per README):
  standalone images expose noVNC on port 7900 (`password=secret`) and VNC
  on 5900. WebDriver is the native API; CDP for Chrome is proxied by the Grid.
  Interactive but no handoff concept and no screencast embed.
- **Selenoid / selenoid-ui** (Apache-2.0): archived (last push 2024-12-17).
  **Moon**: closed-source commercial product, free for 4 pods; the GitHub
  repo is a tracker.
- **Playwright `launchServer`** (Apache-2.0, 98.8k stars, v1.64.1): serves
  the Playwright protocol at an unguessable `wsPath`; client and server
  major.minor versions must match. `connectOverCDP` is documented as "significantly
  lower fidelity." The server has no viewer.
- **KasmVNC** (GPL-2.0, 5.3k stars): web-native VNC server with a built-in
  client; GPL. **jlesage/docker-chromium** (MIT): Chromium in a browser-
  accessible desktop; the Railway template pairs it with a CDP port.
  Not examined further.

## What this means for beebox

Requirements from the brief: interactive view in a card, mobile Safari and
the iOS webview, agent on CDP/Playwright, handoff both ways, open source,
per-box Unix user.

None of the servers solves handoff arbitration. Skyvern comes closest
(`Interactor` filtering plus a take-control message), and its code is AGPL.
The other projects let the human and the agent both send input. Beebox will
need its own state machine: who holds input, a "pause agent" signal in the
agent's tool layer, and a "hand back" action.

Mobile Safari is the weak point of the CDP-screencast designs. Steel's iOS
bug (#270) and Browserbase's "mobile keyboards aren't officially supported"
show the failure: a canvas or image has no focused text control, so iOS
shows no keyboard. Kernel's `field-keyboard.ts`, `soft-keyboard.ts`, and
`livefocus` implement the fix (overlay input mirroring the remote field).

| Candidate | Lean | Reason |
|---|---|---|
| vercel-labs/agent-browser | adapt (protocol and daemon design); adopt as agent CLI later | Apache-2.0; WS protocol with frames, mouse, keyboard, touch, ack pacing, `--cdp` attach. Its origin rule needs a beebox proxy. No handoff. Closest model for a beebox-owned screencast endpoint. |
| Steel Browser | adapt (code reference); adopt as a fallback runtime | Apache-2.0; `casting.handler.ts` is a readable 487-line screencast + input relay; session context and profile lock are reusable ideas. One session per process; iOS keyboard bug; no touch. |
| Kernel images | adapt (client and livefocus pieces); later (whole image) | Apache-2.0; only project with mobile-aware live view code, OS-level input, `/computer/*` API, CDP proxy. Image needs `--privileged` and root, and runs one Xorg+Neko per browser; mismatched with per-Unix-user boxes until reworked. |
| Skyvern | reject code; adopt the idea | AGPL-3.0. Its agent/user interactor gate and take-control message are the handoff model beebox needs; reimplement independently. |
| Auto-Browser | later / watch | MIT and the closest product match (MCP, takeover, auth profiles), but one author, 7 months old, noVNC as a separate page, no raw CDP, single shared desktop. Useful to read for MCP tool shape (`request_human_takeover`). |
| Browserless | reject | SSPL/commercial; live view that takes input is paid. Keep the "pause script, hand over a URL" shape as a design reference. |
| AetherAI3/agent-browser | reject | No raw CDP, unauthenticated noVNC, 14 stars. |
| floomhq/openbrowser | later / watch | MIT; "human auth handoff" idea; 16 stars. |
| Lightpanda | later | AGPL-3.0, no rendering; possible cheap read-only fetch backend, not a shared session. |
| Neko | later | Apache-2.0 WebRTC option if CDP screencast frame rate or fidelity proves too low; iOS issues open. |
| Selenium/Moon/Selenoid | reject | WebDriver-first; Moon closed source; Selenoid archived. |
| Playwright launchServer | reject for the shared session | No viewer; version-locked; the person-facing view would be separate. |
| browser-use, Stagehand, Hyperbrowser, Browserbase | reject as infrastructure | Libraries or hosted live view; Cloud is not open source (`browser-use/CLOUD.md`). |

Most reusable code for a beebox-built viewer, in order:

1. `kernel-images/images/chromium-headful/client/src/utils/` (`touch-gestures.ts`,
   `soft-keyboard.ts`, `field-keyboard.ts`, `remote-focus.ts`) and
   `kernel-images/server/lib/livefocus/` (`watcher.js`, `watcher.go`,
   `handler.go`): mobile gestures and soft keyboard for a remote canvas,
   Apache-2.0. The focus watcher works over CDP and does not need Neko.
2. `agent-browser/cli/src/native/stream/websocket.rs` and
   `docs/content/docs/streaming.mdx`: frame/ack/input message design.
3. `steel-browser/api/src/plugins/browser-socket/casting.handler.ts`: a
   TypeScript screencast relay on puppeteer-core, close to beebox's stack.
4. `skyvern/forge/sdk/routes/streaming/channels/vnc.py` and
   `BrowserStream.tsx`: handoff semantics only; AGPL.

Candidate beebox shape: a small TypeScript relay per box (Steel's handler
plus agent-browser's ack pacing), a card component that uses Kernel-style
touch and soft-keyboard handling, and an input-owner flag enforced in the
relay and surfaced to the agent through a tool. Chrome runs headless as the
box user with `--remote-debugging-port` bound to loopback and the relay as
the only exposed path. Open question: screencast shows one page and misses
native dialogs, file pickers, and `<select>` popups; the Kernel/Neko design
covers them at the cost of X and root. That trade belongs in a plan, not
here.

Not verified: iOS Safari behaviour of any viewer (no device test); Neko
embedding docs; Steel's funding; Auto-Browser takeover on a phone;
whether Browserless's open-source image ships hybrid live view.
