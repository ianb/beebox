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
| [agent-browser-dashboard.md](agent-browser-dashboard.md) | After the boxholder's direction: what agent-browser's dashboard lets the person do, and what serving it behind beebox needs |
| [acceptance-walkthrough.md](acceptance-walkthrough.md) | Plan gate G1 (2026-10-30): a login typed through the dashboard, read by the agent, kept across a restart |
| [security.md](security.md) | Prompt injection with logged-in sessions, CDP exposure, SSRF through the browser, profile storage, Chromium RAM; 12 threats with controls |

## What the survey found

- **A CDP screencast is enough for a first version.** The spike ran one Chromium with a web viewer (JPEG frames from `Page.startScreencast` over a WebSocket; input through `Input.dispatch*`) while Playwright attached over CDP and navigated, read the accessibility tree, clicked and filled. The attach did not disturb the viewer. Click-to-frame latency on localhost was about 10 ms; an idle page sends no frames. Clicks, scroll, typing, touch, JS dialogs, popups, file upload and download worked. No X server, window manager, TURN server or extra port is needed.
- **Its limits:** no audio; `<select>` popups do not appear in the frames (the viewer needs its own picker); the viewport is shared and Playwright resets it on `goto`; Chrome emits 80-95 fps during scrolling, so a frame cap is required (1.6-3.8 MB/s at 30 fps). Phone keyboards need an overlay input, as Steel's open iOS bug (#270) shows.
- **No open-source project solves handoff.** Every server lets the person and the agent send input at once. Neko has a real host/control model but uses WebRTC (extra UDP port, TURN for cellular) and has open iOS bugs. Beebox needs its own input-owner state.
- **Reusable Apache-2.0 code exists for each viewer piece:** Kernel images' phone touch and soft-keyboard client with a CDP focus watcher; agent-browser's frame/ack/input protocol; Steel's 487-line TypeScript screencast relay.
- **Hosted services give the handoff shape to copy:** Cloudflare's `handoff(instructions, timeout)` → Done/Failed → `handoffComplete`; short-lived viewer tokens; OpenAI's rule that the agent takes no screenshots while the person drives. Prices run $0.02-0.48 per browser-hour; logins would live with a third party.
- **Site reality is the main unknown.** Boxes share one Hetzner datacenter IP. No published test measures Hetzner against Cloudflare. Sites with light protection probably work when the person logs in first; ticketing, retail checkout, airlines, some banks and social networks probably challenge or block. A residential IP (the Mac app, or a home relay) removes IP-reputation blocks and leaves fingerprint signals. Rotating residential proxy vendors are rejected: they see logged-in traffic and have a supply-chain record.
- **Security needs work before the browser holds logins.** CDP has no authentication; a TCP debugging port on loopback is reachable by every Unix user on the host, including other boxes. Box users have no network egress filter, so an injected page can drive the browser at loopback services and private ranges. On Linux a Chromium profile's cookies are readable by anyone who can read its files.

## Boxholder direction (2026-10-29)

After reading the survey, the boxholder set three limits: input conflicts between the person and the agent do not matter ("I don't care about conflicts in clicking"); no beebox-built viewer ("very reluctant to make our own"); desktop only, no image per box ("An image is a lot. So agent browse seems good"). The person must still be able to set things up, log in and get past blocks.

That rules out the beebox-built broker this survey first recommended (viewer, agent CDP proxy, control state), neko and the other image-based stacks, and phone support. It points to the agent-browser dashboard, checked in [agent-browser-dashboard.md](agent-browser-dashboard.md).

## Recommended shape

One agent-browser session per box, run as the box user with a profile under the box user's state directory, outside the box git repo and `_tmp/`. The box agent drives it through a `bbx browser` command that wraps agent-browser, the same CLI-plus-loopback-bearer shape box agents already use (box agents have no MCP). The person drives the same session in agent-browser's dashboard on a desktop: the dashboard sends mouse, wheel and keyboard input to the page. Both act at once; nothing arbitrates.

Handoff is conversational: the agent says it is stuck at a login or captcha and gives the person a link to the dashboard; the person finishes and tells the agent to continue. A blocking `bbx browser handoff` call is optional later.

Integration work, none of it a viewer:

- Serve the dashboard per box on its own origin (its assets use root paths), behind beebox auth, linked or framed from the app.
- Paste: an upstream patch so a password from a password manager reaches the page.
- Decide whether the dashboard's developer panes (Storage shows cookies) are acceptable for a single boxholder.
- Loopback stream ports are reachable by other box users; needs an upstream Unix-socket option or the egress filter.
- Chromium on the server, its RAM inside the box's 2 GB cgroup, and its sandbox under the box user.

## Dispositions

| Item | Disposition | Trace to beebox |
|---|---|---|
| agent-browser for the agent (`bbx browser`) and its dashboard for the person, desktop only | **adopt** | Boxholder direction 2026-10-29; dashboard input verified in code ([agent-browser-dashboard.md](agent-browser-dashboard.md)); already wrapped by `bin/browse`; box agents take tools as `bbx` commands (`skipMcpDiscovery: true`) |
| Paste patch upstream in agent-browser | **adapt** | Logins with a password manager; small change in `viewport.tsx` |
| Agent self-pause at logins, captchas, payments and account creation | **adopt** | Box guidance only; copies ChatGPT agent and Gemini behaviour ([hosted-and-agent-interfaces.md](hosted-and-agent-interfaces.md)) |
| Profile per box outside git and `_tmp/` | **adopt** | [beebox-today.md](beebox-today.md) §6; Chrome 136 requires a non-default profile for CDP |
| Beebox-built viewer, agent CDP proxy and control state | **reject** | Boxholder direction 2026-10-29; first recommendation of this survey |
| Phone support (touch, soft keyboard; Kernel images' client code) | **later** | Desktop only by decision; the dashboard sends no touch and raises no keyboard |
| neko, Selkies, KasmVNC and other pixel-streaming stacks | **reject** for now | An X server or image per box; boxholder direction |
| Steel Browser, Kernel images, Skyvern | **reject** | Second viewer to run, a privileged image, or AGPL |
| chrome-devtools-mcp attached to the same browser | **later** | Console and network debugging by the agent; telemetry defaults must be turned off |
| Hosted browser services as the runtime | **reject** | Logins and screen data held by a third party; per-hour cost |
| Rotating residential proxies, captcha solvers, stealth-patched browser binaries | **reject** | Vendor sees logged-in traffic; the person solves captchas; repo policy excludes evasion ([research/AGENTS.md](../AGENTS.md)) |
| Running the browser on the person's network (Mac app VM, home relay) | **later** | Removes datacenter-IP blocks; the Mac sleeps. Decide after the site probe |
| Patchright-style `Runtime.enable` patches | **later** | One-target gain in the only published test; revisit for a named failing site |

## Proposed first spike

Answers: can the boxholder log in to a real site in the dashboard while the box agent drives the same session, on Linux as a box user?

1. A Linux environment like production: Debian, an unprivileged user under a systemd unit with `NoNewPrivileges`, `ProtectHome` and `MemoryMax=2G`. This Mac has no Docker; use a throwaway Hetzner VM (cents per hour, needs the boxholder's yes) or the mac-app VM.
2. Install Chromium and agent-browser 0.41; start one session and the dashboard as that user, with `--allowed-origins` for a test host name behind a TLS proxy.
3. The boxholder opens the dashboard on a desktop: types into a search box and a login form on a test account, clicks through a challenge if one appears, uses a select by keyboard. The agent then reads the page with `snapshot -i` and continues.
4. Record: Chromium sandbox status without `--no-sandbox`; RSS with 1 and 3 tabs; whether paste is needed in practice; what the developer panes show.

Done when the answers are written up as a follow-up note in this corpus. Not in scope: product UI, the egress filter, phones.

## Decisions for the boxholder

- **Where the browser runs.** Server first; the person's network later, after the [site probe](../../issues/exploration/2026-10-29-shared-browser-site-probe.md) shows which real sites fail from the datacenter IP.
- **Developer panes.** Show the dashboard as it is (the boxholder sees their own cookies), or ask upstream for a viewer-only mode.
- **Egress filter before logins.** The browser makes the missing per-box egress filter reachable by any page the agent opens. Lean: required before the browser holds the person's logins; not required for the spike.

## Issues

- Anchor issue updated: [agent browser scoped to box](../../issues/features/2026-06-12-agent-browser-scoped-to-box.md).
- [Shared browser site probe](../../issues/exploration/2026-10-29-shared-browser-site-probe.md): which real sites challenge or block the server IP compared with a residential IP.
- The egress filter for box users is filed in the private issue repository, because it concerns production infrastructure.
