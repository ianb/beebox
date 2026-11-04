# Hosted browser services, agent products, and agent-side interfaces

Date: 2026-10-29. Scope: design references for a shared live browser in beebox
(agent and person drive one session; handoff either way), and the agent-side
interfaces (MCP servers, CLIs, libraries) that could attach to a Chromium that
a human also views.

Method: vendor docs fetched on 2026-10-29, GitHub metadata via `gh`, and web
search. Items marked **[unverified]** come from one secondary source, a search
snippet, or a page that did not state the fact. Prices are list prices in USD
and change often. Reddit was not used.

Two facts frame everything below.

1. Every hosted service with a live view ships the same shape: a Chromium
   session with a CDP endpoint for the agent, and a separate viewer URL (iframe)
   for the person. The viewer URL is a bearer credential.
2. The agent-side question is separate from the viewer question. An agent
   interface that attaches by CDP can share a Chromium with any viewer that also
   attaches by CDP, provided neither resets emulation or closes the page.

---

## Part A. Hosted services and agent products

### A1. Hosted browser services

| Service | Viewer embed | Auth / expiry | Interactive? | Mobile | Handoff signal | Persistence | List price (browser time) | Retention |
|---|---|---|---|---|---|---|---|---|
| Browserbase | iframe `src` = `debuggerFullscreenUrl` (or `debuggerUrl` with chrome borders); `&navbar=false` | Expiry not stated in the doc | Default yes; `pointer-events: none` on the iframe makes it watch-only | Set a mobile viewport; mobile keyboard unsupported, forward key events yourself | None built in; app-level. Iframe posts `browserbase-disconnected` on end | Contexts: Chromium user-data-dir (cookies, localStorage, IndexedDB), encrypted at rest | $0.12/hr (Developer, 100 h incl.), $0.10/hr (Startup) | Plan-based: 7 d free, 30 d paid |
| Cloudflare Browser Run (formerly Browser Rendering) | `devtoolsFrontendUrl` from CDP `Cloudflare.getLiveView`; hosted UI at live.browser.run; dashboard | `expiresInMs`: default 5 min, max 1 h | Yes (operator uses DevTools frontend) | Not documented | Structured: CDP `Cloudflare.handoff` (instructions + timeout) then event `Cloudflare.handoffComplete` (success/reason) | Not documented | $0.09/hr after 10 h/mo (Workers Paid); $2/extra concurrent browser | Not documented |
| Kernel | iframe of `browser_live_view_url`; `kiosk_mode` removes address bar and tabs | Token in URL path; dead when browser is deleted or times out | `?readOnly=true`, switchable at runtime by postMessage `KERNEL_SET_READ_ONLY` | Not documented | None built in | Managed auth + vaults; profile persistence not stated on pricing page | Headless $0.06/hr; headful $0.48/hr; headful GPU $2.88/hr; standby after 5 s idle costs nothing | Replays: 1 d / 7 d / 30 d by plan |
| Steel (cloud, also OSS) | iframe of `debugUrl` with `interactive=true&showControls=true`; WebRTC H.264 stream | URL has no auth; Steel says to put it behind your own ACL or signed URL | `interactive=false` disables everything | Not documented | None documented | Sessions, restore of cookies/localStorage **[unverified for cloud]** | Not confirmed (no number in fetched pages) | Not confirmed |
| Hyperbrowser | `liveUrl` in iframe | Token expires after 12 h; GET session returns a fresh URL | Interactive by default; `viewOnlyLiveView: true` at session creation | Not documented | None documented | Profiles: cookies, local/session storage, cache | $0.10/hr (100 credits); proxy $10/GB | Not confirmed |
| Anchor Browser | `live_view_url` in iframe | `one_time_url: true` makes the link single-use (dies after first viewer disconnects; headful only) | Interactive by default; `pointer-events: none` on the iframe for read-only; `show_cursor=1` draws the remote pointer | Not documented | None documented | Profiles (marketing) | $0.05/hr plus proxy and AI-step fees (docs via search; secondary sources disagree) | Not confirmed |
| Browser Use Cloud | `live_view_url` on `live.browser-use.com`, iframe | URL is a credential; browser stops 2 min after last activity unless `keepAlive` (120-14400 s) | `readOnly=true` param, or `inert` wrapper (UI-level only) | Not documented | None built in; remove the `inert` wrapper to allow takeover | Profile reused across follow-ups | $0.02/hr per a pricing mirror; another snippet says $0.06/hr **[unverified]**; idle browsers bill | ZDR option exists (zero data retention) |
| Airtop | `liveViewUrl` in iframe; `includeNavigationBar`; postMessage events (`UrlChange`) | Expiry not documented | Interactive; docs list "human in the loop" use | Not documented | postMessage events from iframe | Profiles and shared auth (marketing) | Tier-based; no per-hour figure found | Not confirmed |

Sources: Browserbase [live view](https://docs.browserbase.com/features/session-live-view), [contexts](https://docs.browserbase.com/features/contexts), [pricing](https://www.browserbase.com/pricing); Cloudflare [human in the loop](https://developers.cloudflare.com/browser-run/features/human-in-the-loop/index.md), [pricing](https://developers.cloudflare.com/browser-run/pricing/), [changelog entry 2026-07-28](https://developers.cloudflare.com/changelog/post/2026-07-28-human-in-the-loop/); Kernel [live view](https://kernel.sh/docs/browsers/live-view), [pricing](https://www.kernel.sh/docs/info/pricing); Steel [human in the loop](https://docs.steel.dev/overview/sessions-api/human-in-the-loop), [live sessions](https://docs.steel.dev/overview/sessions-api/embed-sessions/live-sessions); Hyperbrowser [live view](https://docs.hyperbrowser.ai/sessions/live-view), [reference](https://docs.hyperbrowser.ai/reference); Anchor [live view](https://docs.anchorbrowser.io/advanced/browser-live-view.md), [pricing](https://docs.anchorbrowser.io/pricing.md); Browser Use [live preview](https://docs.browser-use.com/cloud/browser/live-preview.md), [pricing](https://browser-use.com/pricing.md); Airtop [live view](https://docs.airtop.ai/guides/how-to/creating-a-live-view), [pricing](https://www.airtop.ai/pricing).

Price range for scale: $0.02 to $0.12 per hour for headless-priced sessions;
Kernel's headful rate is $0.48 per hour, which is the relevant rate for any
service whose live view needs a real display. One always-on personal box
(about 730 h per month) would cost roughly $15 to $90 per month at those
headless rates, or about $350 at Kernel headful. Self-hosting removes this.

The Steel, Anchor, and Browser Use pages describe the viewer as UI-level
control only. The CDP URL and the viewer URL each grant full control to anyone
holding them.

### A2. Per-service notes (patterns worth copying)

**Browserbase.** The viewer is an iframe with two modes decided by the host
page, not the server: `pointer-events: none` makes it watch-only. This is a
client-side switch, so the viewer URL still accepts input if loaded outside the
iframe. Worth copying: one URL per tab (`pages[n].debuggerFullscreenUrl`), a
`disconnected` postMessage so the host UI can show an ended state, and the
recommended iframe `sandbox` and `clipboard-read; clipboard-write` attributes.
The mobile guidance is the closest published account of a mobile problem
beebox has: the iframe cannot summon the phone's keyboard well, so the host
page captures key events and forwards them over its own channel. Beebox
controls both ends, so it can use a hidden text input instead.
Contexts persist the user-data-dir and are advised one-per-site-per-login, and
not used by two sessions at once because sites log the user out.

**Cloudflare Browser Run.** The handoff protocol is the most complete
published design:
- The agent calls `Cloudflare.getLiveView` with `mode: "tab"` (the only mode
  that supports handoff) and `expiresInMs`.
- The agent sends `Cloudflare.handoff` with free-text instructions for the
  person and an optional timeout (max 30 min).
- The person works in the viewer and presses Done or Failed.
- The agent receives `Cloudflare.handoffComplete` with `success` and `reason`,
  or a timeout.
- `Cloudflare.getHandoffState` returns whether a handoff is active, its id, and
  duration.
This gives a structured state machine: idle, agent-driving, handoff-requested
(with message), human-driving, returned (ok/failed/timeout). The doc says
humans can enter credentials "you don't want to pass to the script", but does
not state what CDP events the script still receives while the human drives, and
does not mention recording of keystrokes **[unverified]**. Short-lived viewer
URL (5 min default, 1 h max) is worth copying; it means a leaked link ages out.
Cloudflare notes its sessions are always identified as bot traffic, so a human
in the loop does not clear bot checks.

**Kernel.** `kiosk_mode` (no address bar or tabs) gives a clean card view, but
enabling it restarts Chromium. A runtime `readOnly` toggle by postMessage lets
the host page flip watch-only and interactive without reloading the iframe;
this is the cleanest handoff-by-UI pattern found. The 5-second standby (no
charge when no CDP or viewer activity) is a useful idle model for a
self-hosted Chromium: suspend rendering and screencast when nobody watches.
The headful versus headless price split shows the cost of a real display.
Pricing is per second.

**Steel.** Open source (`steel-dev/steel-browser`) with a WebRTC H.264 viewer.
`showControls` adds a URL bar and back/forward. Doc advice for handoff UI:
state clearly when the person can interact (a banner "Automated session - click
inside to take control"), use at least 600 px height. The docs document no
agent signal for takeover, so the host app has to track it.

**Hyperbrowser.** Refreshable viewer token (12 h) with a GET that re-issues
the URL: a simple model for long sessions. `viewOnlyLiveView` is fixed at
creation, so it cannot switch mid-session.

**Anchor, Browser Use Cloud, Airtop.** All three embed by iframe and leave
handoff to the host app. Browser Use warns that the `ui=false` and `inert`
options are UI-only and that "anyone with the live URL or the underlying CDP
URL can still control the browser." Anchor's `one_time_url: true` (single-use viewer link that dies after the
first viewer disconnects, headful only) is a useful property to copy.
Airtop uses postMessage for `UrlChange` events from the iframe; this is a way
for the host card to show the current URL and title without its own CDP link.

### A3. Agent products with a takeover UX

| Product | Takeover control | Agent sees during takeover | Persistence / profile | Retention | Notes |
|---|---|---|---|---|---|
| ChatGPT agent (successor of Operator) | Agent pauses at logins and prompts; person opens the menu and picks "Take over browser" | Help pages say screenshots are not captured and typed passwords and sensitive data are not captured while the person drives | Remote virtual browser; sign-ins per session | Screenshots kept until the conversation is deleted | One help page says "ChatGPT agent is no longer available" and points to ChatGPT Work; whether Work keeps takeover is **[unverified]**. Official page returned 403 to fetch; facts come from search snippets of [help.openai.com article 11752874](https://help.openai.com/en/articles/11752874-chatgpt-agent) |
| Gemini in Chrome "auto browse" (Mariner successor) | "Take over task" button on the task tab; Gemini also stops itself at sign-in, terms, account creation, and payment finalization | Not stated | Runs in the person's own Chrome; can use Password Manager credentials with permission | Not stated | [Google help](https://support.google.com/chrome/answer/16821166). Project Mariner shut down 2026-05-04 and folded into Gemini Agent / auto browse ([Android Authority](https://androidauthority.com/google-project-mariner-shutdown-3664323/)) |
| Claude in Chrome | No takeover flow documented. Three approval modes (manual, automatic with safety check, skip) and per-site permissions | The extension drives the person's own tabs through the Chrome debugger API; sensitive-data entry always asks the person | Person's real browser and logins | Not stated | [Permissions guide](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide). It refuses account creation, payments, and ID/card data; the person does those steps |
| Claude computer use (API) | None; the host app builds it | Screenshots the host sends | Host-defined | Host-defined | Reference loop only |
| Manus | "Take over" by clicking the task's tab to drive Manus's browser or VS Code; closing the tab stops the task | Not stated | Browser Operator uses the person's local browser and sessions | Not stated | [Manus help](https://help.manus.im/en/articles/11711218-how-can-i-take-over-manus-browser-or-vs-code) |
| Perplexity Comet | Assistant acts in the person's browser | Not stated | Person's browser | Not stated | Zenity research led Perplexity to add stricter confirmation for sensitive actions and admin per-site disable **[secondary source]**. No takeover flow found |

Patterns worth copying from the products:
- **Pause at the boundary, not on a timer.** ChatGPT agent and Gemini stop
  themselves at sign-in, terms, account creation, and payment. The agent
  announces why it stopped ("needs you to log in") instead of failing.
- **Do not capture while the person types.** OpenAI states that screenshots
  are not taken during takeover so passwords stay out of model context. The
  same property for beebox: while the person drives, the agent's snapshot and
  screenshot tools return "human driving" and no page data, and the viewer
  stream is not written to a recording or log.
- **One visible control to take and to give back.** Gemini: "Take over task";
  Cloudflare: Done / Failed buttons; Manus: click the tab. All three are one
  click, visible on the card.
- **The agent keeps the page, not the pixels.** After handoff returns, the
  agent re-reads page state with a fresh snapshot. Nothing from the human
  phase needs to flow back except success/failure and optional note.

---

## Part B. Agent-side interfaces

Repositories checked 2026-10-29 with `gh`: chrome-devtools-mcp 54.4k stars,
Apache-2.0, pushed today; playwright-mcp 38.8k, Apache-2.0, pushed 2026-10-22;
agent-browser 44.9k, Apache-2.0, pushed today; browser-use 119k, MIT, pushed
2026-10-27; Stagehand 25.9k, MIT, pushed today.

### B1. Table

| Interface | Attach to a running Chromium | Own tabs / focus / emulation behavior | Observation format | Fit with Claude Code and Codex CLI |
|---|---|---|---|---|
| Playwright MCP (microsoft/playwright-mcp) | `--cdp-endpoint <url>` (+ `--cdp-header`, `--cdp-timeout`); `--extension` attaches to the person's Chrome through the Playwright extension; `--shared-browser-context` shares one context across HTTP clients | `browser_tabs` can create, close, and select tabs; `browser_resize` calls `setViewportSize`; `--viewport-size`, `--device`, `--mobile` set emulation. Persistent profile allows one instance at a time | Accessibility snapshot by default (`--snapshot-mode full` or `none`); screenshots only with `--caps=vision` or tools | MCP stdio, works in both. README steers coding agents to the Playwright CLI with skills for lower tokens |
| Chrome DevTools MCP (ChromeDevTools/chrome-devtools-mcp) | `--browserUrl http://127.0.0.1:9222`, `--wsEndpoint ws://...` (+ `--wsHeaders` JSON), `--autoConnect` (Chrome 144+, user allows a prompt in `chrome://inspect/#remote-debugging`) | Default launches its own Chrome with its own profile; connecting to a running Chrome is documented for "maintaining state between manual and agent-driven testing". `--viewport` applies only to Chrome the server starts. `pageId` routing exists for shared servers. Whether it creates new tabs on attach: **[unverified]** | Accessibility snapshot, screenshots (JPEG/WebP option, `--screenshotMaxWidth`), console, network, performance traces | MCP stdio plus a CLI (`chrome-devtools`) and an agent skill. Telemetry on by default (`--no-usage-statistics`), update check, CrUX calls (`--no-performance-crux`). All three need disabling on a private box |
| agent-browser (vercel-labs) | `--cdp <port\|url>`, `connect <port>`, `--auto-connect`; the attached browser is externally owned (lifecycle not managed) | `--session` gives isolated state; `--pin-tab` binds a session to its own tabs on a shared `--cdp` Chrome; `set viewport` and `set device` change emulation only when called; headed mode starts private Xvfb on Linux | `snapshot` returns accessibility tree with refs (`@e2`); `-i`, `-c`, `-d`, `-s`, `--delta` shrink output; `screenshot --if-changed`; `batch` | Plain CLI, works in both through a shell tool. Beebox's `bin/browse` wraps it |
| browser-use (library) | `cdp_url="http://localhost:9222"`; `keep_alive` | `no_viewport` disables viewport emulation; behavior of viewport/profile settings when `cdp_url` is set is not documented | DOM tree with indexed elements plus optional screenshot (vision) **[unverified]** | Python library with its own LLM loop. It runs a second agent inside the first, which duplicates the box agent |
| Stagehand (browserbase) | Local launch with a fixed debug port; reconnect to a Browserbase session id; direct `cdpUrl` attach not found in the fetched doc **[unverified]** | `keepAlive` leaves Chrome running | `act`/`observe`/`extract` with its own LLM calls | TypeScript library; also embeds its own LLM. Adds a model call per action |
| Playwright CLI | Same engine as Playwright MCP | Writes snapshots to disk, returns a path | File path to snapshot | Reported 4x cheaper in tokens than the MCP (below) |

Sources: [playwright-mcp README](https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md), [chrome-devtools-mcp configuration](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md) and [advanced usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md), [agent-browser README](https://github.com/vercel-labs/agent-browser), [browser-use parameters](https://docs.browser-use.com/customize/browser/all-parameters), [Stagehand browser config](https://docs.stagehand.dev/v3/configuration/browser).

### B2. Notes

**Sharing a Chromium with a viewer.** CDP allows many clients on one browser.
Conflicts come from three actions, not from attaching:
1. Emulation overrides (`Emulation.setDeviceMetricsOverride`, viewport resize,
   device presets). These change what the viewer's screencast shows and make
   the person's pointer coordinates wrong. Playwright MCP exposes
   `browser_resize` and `--viewport-size`; agent-browser exposes
   `set viewport`/`set device`; chrome-devtools-mcp applies `--viewport` only
   to Chrome it launches. For a shared page, the box should set viewport once
   (by the viewer, matching the card) and tell the agent tools not to resize.
2. Tab management. Playwright MCP `browser_tabs` and agent-browser `open` can
   create tabs; `Target.activateTarget` or `bringToFront` can steal focus from
   the screencast target. Agent-browser `--pin-tab` and chrome-devtools-mcp
   `pageId` routing keep an agent on one tab. I found no documented focus-steal
   bug report for any of the three **[unverified; needs a local test]**.
3. Screencast ownership. `Page.startScreencast` is per CDP session, so a
   viewer and an agent each start their own. Only `Page.screencastFrameAck`
   pacing is per session. Two simultaneous screencast consumers on one page
   work in principle but I did not find a source that tests it **[unverified]**.
   Plain `Page.captureScreenshot` from the agent does not interfere with a
   running screencast in general **[unverified]**.

Ranking for "attach without fighting a viewer", from the docs only:
1. agent-browser `--cdp` with `--pin-tab` and its default of not owning the
   browser. It already exists in the repo and requires no new tool.
2. chrome-devtools-mcp `--browserUrl`/`--wsEndpoint`. It is built for
   attach-to-running-Chrome as a first-class case, and has `--wsHeaders` for a
   bearer-token proxy in front of CDP. Its telemetry defaults need turning off.
3. Playwright MCP `--cdp-endpoint`. Works. The viewport and tab tools are the
   hazard; `--extension` mode targets a desktop Chrome with an extension, not a
   server Chromium.
4. browser-use, Stagehand. Libraries with their own LLM calls; not an
   interface for Claude Code or Codex.

**Token cost of observation.** Figures are from vendor blogs and single-author
benchmarks; no independent reproducible benchmark found.
- Playwright team numbers repeated by [TestDino](https://www.testdino.com/blog/playwright-cli) and [Morph](https://morphllm.com/playwright-mcp): about 114k tokens per task through MCP versus about 27k through the CLI; about 3,800 versus 830 tokens per interaction. The CLI writes snapshots to disk and returns a path, so the agent reads only what it needs.
- Accessibility snapshot: roughly 120 to 5,000 tokens depending on the page; screenshot: roughly 1,500 to 8,000 tokens (image tokens scale with dimensions, per the chrome-devtools-mcp config note) ([Builder.io](https://site.builder.io/blog/playwright-mcp-server-claude-code), [Mintlify](https://www.mintlify.com/microsoft/playwright-mcp/concepts/accessibility-snapshots)).
- Controls that reduce cost: agent-browser `snapshot -i -c -d -s --delta`,
  `screenshot --if-changed`, `--max-output`; chrome-devtools-mcp
  `--slim` and screenshot max width; Playwright MCP `--snapshot-mode none`
  and `--image-responses omit`.
- Takeaway: snapshots default, screenshots on demand for visual questions
  (canvas, charts, CAPTCHA), delta snapshots between actions.

**Viewer options on a self-hosted Chromium.**
- *CDP screencast*: `Page.startScreencast` returns JPEG frames (`screencastFrame`
  events, each needing `screencastFrameAck`), and `Input.dispatchMouseEvent`,
  `dispatchKeyEvent`, and `dispatchTouchEvent` carry input back. Agent-browser
  already runs this: a WebSocket per session (`ws://localhost:<port>`) with
  JSON `frame` messages (base64 JPEG, `seq`, metadata with device size and
  scroll offsets) and client messages `input_mouse`, `input_keyboard`,
  `input_touch`; pacing via `?pacing=ack&maxFps=10`. It accepts browser clients
  only from localhost origins (403 otherwise) and documents no auth, so beebox
  would put its own authenticated proxy in front ([agent-browser streaming](https://agent-browser.dev/streaming)). Whether streaming works in `--cdp` attach mode is
  not documented **[unverified]**.
- Other open examples from search: kernel-images PR #176 (`cdp-live-view`, Go
  service with canvas viewer; PR state unconfirmed), a Next.js canvas viewer
  repo (PixelStream-BLD; license unclear), Sentri's `screencast.js`
  (1280x720 cap, JPEG q50). I did not evaluate code quality or licences
  **[unverified]**. Searches for "puppeteer-screencast" and "cdp-screencast"
  returned recorders, not interactive viewers.
- *Chrome DevTools frontend*: Cloudflare hands the person a
  `devtoolsFrontendUrl` as its live view, so a hosted devtools-frontend with a
  screencast pane is a working product path. The frontend's screencast and
  device-mode panel is built for desktop pointer input; mobile Safari quality
  is **[unverified]**. It carries more surface (console, network, sources)
  than a card needs, which bears on the "person can do anything" security
  model.
- *WebRTC / VNC (Steel, noVNC-style)*: Steel streams H.264 over WebRTC from a
  headful browser; lower latency and smoother than JPEG at the cost of a
  display server and an encoder. Not evaluated further here.

---

## What this means for beebox

Disposition per item. "Adopt" means use as designed; "adapt" means copy the
idea with changes; "later" means not now.

| Item | Disposition | Reason |
|---|---|---|
| Structured handoff state machine from Cloudflare (`handoff` with instructions, `handoffComplete` with success/reason, `getHandoffState`, 30 min cap) | Adapt | Model it as a card/tool pair: a box tool `request_handoff(message, timeout)` that returns when the person presses Done or Failed. Same shape works for the person-to-agent direction ("agent, continue"). Nothing in CDP needs to carry it; a box-side state record does |
| Short-lived, per-tab viewer URL (Cloudflare 5 min default; Hyperbrowser refreshable token) | Adopt | Viewer URL is a bearer credential everywhere. Issue a token per card view, bound to box user and session, refreshed by the web app; never expose raw CDP to the browser. Beebox auth should replace the token entirely |
| Runtime read-only/interactive toggle (Kernel `KERNEL_SET_READ_ONLY` postMessage) | Adapt | Enforce server-side in the screencast proxy (drop `input_*` messages when the agent holds control), plus a client-side overlay. Browserbase's `pointer-events: none` alone is bypassable |
| No page data to the agent while the person types (OpenAI takeover) | Adopt | Passwords are the main reason for takeover. While `human` holds control, agent observation tools return a fixed "human driving" result; the box does not log, record, or persist screencast frames or keystrokes for that period |
| Agent self-pause at logins, terms, account creation, payments (ChatGPT agent, Gemini) | Adopt | Put in the box agent's browser guidance (see bbx-context) and have the handoff tool take a `reason`. Cheap, matches how products already behave |
| One-click take over / give back control on the card (Gemini, Cloudflare Done/Failed, Steel banner) | Adopt | Visible banner stating who controls the browser; button flips it. State text shown to the person: "Agent is driving" / "You are driving" |
| Mobile keyboard via host-captured key events (Browserbase guidance) | Adapt | Beebox owns both ends, so use a focused hidden input in the card that forwards composed text and key events to `Input.insertText` / `dispatchKeyEvent`. Needs a mobile Safari test; also in the iOS webview |
| Idle standby with no cost (Kernel 5 s) | Adapt | Stop screencast when no viewer is attached; keep Chromium alive. Saves CPU on one shared server |
| Persistent contexts, one per site login (Browserbase Contexts) | Adapt | One Chromium user-data-dir per box Unix user. Do not share a profile across boxes. Do not run two Chromium instances on one profile |
| Hosted services as runtime (Browserbase, Kernel, Steel cloud, Hyperbrowser, Anchor, Browser Use, Airtop, Cloudflare) | Reject for runtime, keep as references | $0.02 to $0.48 per hour, retention in a third party, and login cookies would live off the box. Operational simplicity and privacy favour self-hosting. Steel's open-source `steel-browser` is a possible code reference |
| Agent-side: agent-browser through `bin/browse`-style CLI against the shared Chromium (`--cdp`, `--pin-tab`, `snapshot -i --delta`) | Adopt (first choice) | Already in the repo, CLI works from Claude Code and Codex, small outputs, does not own the browser. Test: does `screenshot`/`snapshot` interfere with a live screencast; does streaming work with `--cdp` |
| Agent-side: Chrome DevTools MCP with `--wsEndpoint` + `--wsHeaders` | Adapt (second choice, console/network/perf) | First-class attach to running Chrome; add for debugging tasks. Set `--no-usage-statistics`, `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS`, `--no-performance-crux`; confirm no new tab on attach |
| Agent-side: Playwright MCP `--cdp-endpoint` | Later | Works, larger tool schema and per-action snapshot cost; `browser_resize` and `browser_tabs` conflict with a shared viewer. Revisit if the box agent needs Playwright-style tests. Prefer Playwright CLI over MCP if used |
| browser-use, Stagehand as libraries | Reject | They run a second LLM loop inside the box agent. Neither is an interface for Claude Code or Codex CLI |
| Viewer: CDP screencast (JPEG) plus input over WebSocket through a beebox-authenticated proxy | Adopt as the starting point | Works on mobile Safari and in a webview with a canvas; no extra display server; same primitive agent-browser uses. Needs frame pacing (ack), a viewport rule (viewer sets it, agent never resizes), and touch-to-mouse mapping |
| Viewer: Chrome DevTools frontend embed | Later | Cloudflare ships it, but the surface is large and desktop-oriented. Possible as a "debug" panel for the person |
| Viewer: WebRTC/VNC | Later | Better latency; adds a display server and encoder. Consider when JPEG bandwidth or latency on phones fails |
| Claude in Chrome / Comet / Manus Browser Operator style (agent in the person's own desktop browser) | Reject for this feature | They solve a different problem (person's laptop browser). Beebox needs a server-side browser reachable from a phone |

### Open questions for the next note

1. Does `Page.startScreencast` by the viewer and `Page.captureScreenshot` or
   agent-browser snapshots by the agent coexist on one page without frame
   drops? Needs a local test.
2. Does agent-browser's stream work under `--cdp` attach, and can the stream
   proxy enforce the input gate?
3. Does chrome-devtools-mcp open a new tab or change emulation on
   `--wsEndpoint` attach?
4. Does OpenAI's takeover behaviour survive in ChatGPT Work? Fetch of the
   official help page returned 403.
5. How does the box agent learn that the person pressed Done, when the agent
   is a Claude Code or Codex CLI process waiting on a shell command?
   (Likely: the handoff tool blocks on a box-side event, with timeout.)
