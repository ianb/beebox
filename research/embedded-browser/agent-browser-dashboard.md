# agent-browser dashboard as the person's view (2026-10-29)

After the survey, the boxholder chose desktop only and no image per box (2026-10-29): "I'm ok for this to be desktop only. An image is a lot. So agent browse seems good." This note checks whether the dashboard bundled in [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) (Apache-2.0) lets the person set things up, log in and get past blocks in the session the agent drives. Sources: the upstream `docs/content/docs/dashboard.mdx` and `streaming.mdx`, `packages/dashboard/src/components/viewport.tsx` at `main` on 2026-10-29, and the 0.27.0 binary in this repo's `node_modules/agent-browser` (current upstream is 0.41.0).

## Person input

The live viewport is a `<canvas>` with `tabIndex={0}` (`viewport.tsx` lines 505-525). It sends to the session's stream WebSocket:

- `input_mouse` for `mouseMoved`, `mousePressed`, `mouseReleased` and `mouseWheel`, with coordinates scaled from the canvas to the page viewport and CDP modifier bits (lines 309-358).
- `input_keyboard` for `keyDown` and `keyUp` while the canvas has focus, with `key`, `code`, `text` and `windowsVirtualKeyCode` (lines 360-399). Focus moves to the canvas on mouse down.

So on a desktop the person can click, scroll, and type into a login form, a captcha or a Cloudflare check. Gaps:

- **Paste.** Cmd/Ctrl+V sends the key only; clipboard text does not reach the page. A password manager cannot fill the remote page either, so typing is the only way to enter a password. Adding paste is a small upstream change: read the `paste` event's text and send it as `Input.insertText`.
- **Touch and phone keyboard.** The protocol accepts `input_touch`; the dashboard never sends it. A canvas raises no soft keyboard. Out of scope under the desktop-only decision.
- **Native popups.** `<select>` popups do not appear in screencast frames ([spike-cdp-screencast.md](spike-cdp-screencast.md)). Keyboard selection (focus the select, type or use arrow keys) is the likely workaround; not tested.
- **Not tested live.** The check on this Mac hung at the screenshot step; the spike saw the same hang while the macOS screen was locked.

## What else the dashboard exposes

The dashboard is a developer tool. Beside the viewport it has Activity, Console, Network, Storage and Extensions panes, a session-creation form with cloud providers (AgentCore, Browserbase, Browserless, Browser Use, Kernel), and an AI chat pane that calls the Vercel AI Gateway when `AI_GATEWAY_API_KEY` is set. The Storage pane shows the profile's cookies. For one boxholder on their own box that is their own data; it still means the dashboard credential is equal to the browser's logins.

## Serving it behind beebox

- **Origin.** The page loads its assets from root paths (`/_next/static/...`, checked with `curl` against 0.27.0). It cannot sit under the hub's `/<box>/...` path without a rewriting proxy. It needs its own origin (a per-box host name) or an upstream base-path option. A separate origin needs `frame-src` and `connect-src` entries if the app frames it ([beebox-today.md](beebox-today.md) §5).
- **Auth.** Loopback origins need no token. For a proxied origin, `--allowed-origins` makes the server print a tokenized URL once; the token moves from the URL fragment to a Secure, host-bound, same-site cookie. Beebox's own auth would sit in front of that.
- **Session discovery.** The dashboard lists the sessions in its `AGENT_BROWSER_SOCKET_DIR`. One dashboard per box user, with that box's socket directory, keeps boxes apart. Unix socket paths are capped at 103 bytes on macOS, so the socket directory needs a short path.
- **Ports.** Each session's stream server binds a loopback port; the dashboard proxies it. That port is reachable by other Unix users on the host, the same cross-box exposure as a CDP port ([security.md](security.md) threat 4). Upstream would need a Unix-socket option, or the hub's egress filter must cover loopback.

## Dispositions

| Item | Disposition | Trace |
|---|---|---|
| agent-browser dashboard as the person's view, desktop only | **adopt** | Boxholder decision 2026-10-29; desktop input works in code; no image, no X server; same tool the agent uses |
| Paste through `Input.insertText` | **adapt** (upstream patch) | Needed for passwords from a password manager; small change in `viewport.tsx` |
| Hide developer panes (Console, Network, Storage, provider sessions, AI chat) | **investigate** | Check for an upstream option; otherwise accept for a single boxholder, or ask upstream for a viewer-only mode |
| Base-path support vs per-box origin | **investigate** | Decides how the hub serves it; per-box origin needs CSP entries |
| Loopback stream ports | **investigate** | Unix-socket option upstream, or the private egress-filter issue covers loopback |
