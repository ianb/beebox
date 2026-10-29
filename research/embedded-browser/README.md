# Embedded shared browser (2026-10-29)

The boxholder's ask: a browser inside beebox that the box agent and the person both work in. The person sees and drives it in a card or panel on desktop and phone. The agent drives the same live session (navigate, read the page, click, fill). Either side hands off to the other: the agent stops at a login or captcha, the person takes over, then hands back. Strong preference for open source. Anchor issue: [agent browser scoped to box](../../issues/features/2026-06-12-agent-browser-scoped-to-box.md); neighbours: [agent cannot see its own visual work](../../issues/features/2026-10-29-box-agent-cannot-see-its-own-visual-work.md), [interface screenshots](../../issues/features/2026-10-05-box-agent-interface-screenshots.md).

| Document | Contents |
|---|---|
| [beebox-today.md](beebox-today.md) | What beebox has now: browser-task card, pending browser requests, Clerk, `bin/browse`, per-box Unix users, CSP, WebSocket path, iOS webview rules, 13 constraints |
| [spike-cdp-screencast.md](spike-cdp-screencast.md) | First-hand spike on this Mac: one Chromium shared by a CDP-screencast viewer and Playwright `connectOverCDP`; latency, frame rate, RSS, what broke |
| [streaming-stacks.md](streaming-stacks.md) | Pixel-streaming stacks: neko, Selkies, KasmVNC and Kasm Workspaces, linuxserver images, noVNC, Guacamole, Xpra |
| [agent-browser-platforms.md](agent-browser-platforms.md) | Open-source agent browser servers: Steel, Kernel images, Skyvern, Auto-Browser, agent-browser, Browserless, Lightpanda and others; reusable viewer code |
| [hosted-and-agent-interfaces.md](hosted-and-agent-interfaces.md) | Hosted services (Browserbase, Cloudflare Browser Run, Kernel, Hyperbrowser, Anchor) and takeover UX in agent products; agent-side tools (agent-browser, chrome-devtools-mcp, Playwright MCP) |
| [site-reality.md](site-reality.md) | Bot detection, datacenter IP reputation, residential paths, stealth projects, captchas, terms of service |
| [security.md](security.md) | Prompt injection with logged-in sessions, CDP exposure, SSRF through the browser, profile storage, Chromium RAM; 12 threats with controls |

## What the survey found

- **A CDP screencast is enough for a first version.** The spike ran one Chromium with a web viewer (JPEG frames from `Page.startScreencast` over a WebSocket; input through `Input.dispatch*`) while Playwright attached over CDP and navigated, read the accessibility tree, clicked and filled. The attach did not disturb the viewer. Click-to-frame latency on localhost was about 10 ms; an idle page sends no frames. Clicks, scroll, typing, touch, JS dialogs, popups, file upload and download worked. No X server, window manager, TURN server or extra port is needed.
- **Its limits:** no audio; `<select>` popups do not appear in the frames (the viewer needs its own picker); the viewport is shared and Playwright resets it on `goto`; Chrome emits 80-95 fps during scrolling, so a frame cap is required (1.6-3.8 MB/s at 30 fps). Phone keyboards need an overlay input, as Steel's open iOS bug (#270) shows.
- **No open-source project solves handoff.** Every server lets the person and the agent send input at once. Neko has a real host/control model but uses WebRTC (extra UDP port, TURN for cellular) and has open iOS bugs. Beebox needs its own input-owner state.
- **Reusable Apache-2.0 code exists for each viewer piece:** Kernel images' phone touch and soft-keyboard client with a CDP focus watcher; agent-browser's frame/ack/input protocol; Steel's 487-line TypeScript screencast relay.
- **Hosted services give the handoff shape to copy:** Cloudflare's `handoff(instructions, timeout)` → Done/Failed → `handoffComplete`; short-lived viewer tokens; OpenAI's rule that the agent takes no screenshots while the person drives. Prices run $0.02-0.48 per browser-hour; logins would live with a third party.
- **Site reality is the main unknown.** Boxes share one Hetzner datacenter IP. No published test measures Hetzner against Cloudflare. Sites with light protection probably work when the person logs in first; ticketing, retail checkout, airlines, some banks and social networks probably challenge or block. A residential IP (the Mac app, or a home relay) removes IP-reputation blocks and leaves fingerprint signals. Rotating residential proxy vendors are rejected: they see logged-in traffic and have a supply-chain record.
- **Security needs work before the browser holds logins.** CDP has no authentication; a TCP debugging port on loopback is reachable by every Unix user on the host, including other boxes. Box users have no network egress filter, so an injected page can drive the browser at loopback services and private ranges. On Linux a Chromium profile's cookies are readable by anyone who can read its files.

## Recommended shape

One Chromium per box, started by a beebox TypeScript broker with `--remote-debugging-pipe` (no listening port) and a profile under the box user's state directory, outside the box git repo and `_tmp/`. On the server it runs `--headless=new`; that mode shares rendering code with headful Chrome and needs no X server.

The broker owns three things:

1. **Viewer stream.** Screencast frames and person input over a WebSocket on the box's own origin through the hub. Same origin means no CSP change and no iOS webview origin problem ([beebox-today.md](beebox-today.md) §5, §7). Frame cap with client ack (agent-browser's design), a keyframe when a viewer joins, a select picker, and Kernel's soft-keyboard overlay.
2. **Agent endpoint.** A CDP proxy for the agent. While the person holds control it drops `Input.*` and navigation, and observation commands return "person is driving" with no page data. The agent uses agent-browser (`--cdp`, `--pin-tab`, `snapshot -i`) through a `bbx browser` command, the same CLI-plus-loopback-bearer shape box agents already use; box agents have no MCP.
3. **Control state.** `agent | person` ownership with a visible banner and one button. `bbx browser handoff --reason <text> --timeout <n>` blocks until the person presses Done or Failed; the agent calls it on its own at logins, captchas, payments and account creation (box guidance).

The pending-browser-request primitive ([beebox-today.md](beebox-today.md) §1) carries one request and one answer, so it cannot carry the live stream. Its ack/timeout/no-client outcomes are the right vocabulary for the handoff call.

## Dispositions

| Item | Disposition | Trace to beebox |
|---|---|---|
| CDP screencast viewer, beebox-built, same-origin through the hub | **adopt** | Spike verdict; CSP `frame-src 'self'`; iOS webview refuses off-origin main frames; nginx and hub already forward WebSocket upgrades |
| agent-browser as the box agent's browser tool, wrapped as `bbx browser` | **adopt** | Already wrapped by `bin/browse` for dev agents; attaches to a shared Chrome with `--cdp`; box agents take tools as `bbx` commands (`skipMcpDiscovery: true`) |
| Cloudflare-style handoff call, OpenAI-style blind-while-person-drives, agent self-pause at logins | **adopt** | Fills the gap no open project covers; the pending-request outcomes give the vocabulary |
| `--remote-debugging-pipe` into a per-box broker, no TCP port | **adopt** | One server, many Unix users: a loopback port is cross-box ([security.md](security.md) threat 4) |
| Kernel images client touch/soft-keyboard code and focus watcher | **adapt** | Apache-2.0; the iOS keyboard failure is the known failure of canvas viewers |
| Steel's screencast relay, agent-browser's frame/ack protocol | **adapt** | Apache-2.0 reference code close to beebox's TypeScript stack; Steel is one session per process and has no touch |
| Skyvern's agent/user input gate | **adapt the idea** | AGPL-3.0; reimplement independently |
| chrome-devtools-mcp attached to the same browser | **later** | For console and network debugging by the agent; telemetry defaults must be turned off |
| neko (WebRTC) | **later** | Only if audio, native popups or full IME become requirements; needs UDP/TURN per box and has open iOS bugs |
| Selkies 2.x (WebSocket pixel stream) | **later** | Single port, no Docker, MPL-2.0; a five-week-old rewrite by one author, no handoff, no CDP recipe. The fallback if screencast fails on real phones |
| KasmVNC, noVNC + VNC, Xpra | **later** / reject | Weaker phone input; add an X server per box |
| Kasm Workspaces CE, Guacamole, Browserless, Selenium/Moon/Selenoid | **reject** | Non-commercial or SSPL licence, duplicate auth, or WebDriver-first |
| browser-use, Stagehand, Playwright MCP | **reject** / later | The first two run their own LLM loop; Playwright MCP's resize and tab tools fight a shared viewer |
| Hosted browser services as the runtime | **reject** | Logins and screen data held by a third party; per-hour cost; kept as design references |
| Rotating residential proxies, captcha solvers, stealth-patched browser binaries | **reject** | Vendor sees logged-in traffic; the person solves captchas; repo policy excludes evasion ([research/AGENTS.md](../AGENTS.md)) |
| Running the browser on the person's network (Mac app VM, home relay) | **later** | Removes datacenter-IP blocks; the Mac sleeps. Decide after the site probe |
| Patchright-style `Runtime.enable` patches | **later** | One-target gain in the only published test; revisit for a named failing site |

## Proposed first spike

Answers: does the recommended shape work on Linux as a box user, and on a real phone?

1. A Linux environment that matches production: Debian, a dedicated unprivileged user under a systemd unit with the production sandbox options (`NoNewPrivileges`, `ProtectHome`, `MemoryMax`). There is no Docker on this Mac; options are a throwaway Hetzner VM (cents per hour, needs the boxholder's yes) or the mac-app VM.
2. Port the spike relay ([spike-cdp-screencast.md](spike-cdp-screencast.md), scratch code) to `--remote-debugging-pipe`, add the agent-side gating proxy, a 30 fps cap with ack, a keyframe on join, and Kernel's soft-keyboard overlay.
3. Record: whether Chromium's sandbox runs without `--no-sandbox` under those unit options (`chrome://sandbox`); RSS with 1 and 3 tabs inside `MemoryMax=2G`; agent-browser `--cdp` through the proxy.
4. The boxholder uses the viewer on an iPhone in Safari and in the iOS app webview over cellular: typing into a search box and a login form, scrolling, a select, and one handoff (agent stops at a login on a test account, person logs in, presses Done, agent continues).

Done when the four answers are written up as a follow-up note in this corpus. Not in scope: real accounts, the egress filter, product UI.

## Decisions for the boxholder

- **Accept the screencast limits for a first version?** No audio, a beebox select picker, one shared viewport. Lean: yes. The alternative is neko or Selkies with an X server per box.
- **Where the browser runs.** Server first; the person's network later, after the [site probe](../../issues/exploration/2026-10-29-shared-browser-site-probe.md) shows which of the boxholder's real sites fail from the datacenter IP.
- **A separate browser Unix user per box.** It keeps cookies away from the agent process and an escaped renderer away from the box files. It adds provisioning. Lean: yes.
- **Egress filter before logins.** The browser makes the missing per-box egress filter reachable by any page the agent opens. Lean: required before the browser holds the person's logins; not required for the spike.

## Issues

- Anchor issue updated: [agent browser scoped to box](../../issues/features/2026-06-12-agent-browser-scoped-to-box.md).
- [Shared browser site probe](../../issues/exploration/2026-10-29-shared-browser-site-probe.md): which real sites challenge or block the server IP compared with a residential IP.
- The egress filter for box users is filed in the private issue repository, because it concerns production infrastructure.
