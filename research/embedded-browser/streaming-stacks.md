# Pixel-streaming stacks for a shared headful Chromium

Researched 2026-10-29. Scope: stacks that run a real, headful Chromium on the
server and stream its pixels to a person's browser, with the agent attached to
the same Chromium over CDP (Playwright `connectOverCDP`). The candidates are
neko, Selkies (including the linuxserver.io images built on it), KasmVNC and
Kasm Workspaces, noVNC with a VNC server, Apache Guacamole, and Xpra. Not
covered: CDP-screencast viewers (the agent-side "live view" family) and
vendor-hosted browsers. Repo facts come from the GitHub API on the date above.
Anything I did not run myself is marked unverified. No stack was installed or
benchmarked for this note.

## Findings that apply to every candidate

- **CDP and the visible window are the same browser only if the agent attaches
  to the default context.** `connectOverCDP` exposes the running browser's
  existing context as `browser.contexts()[0]`. `browser.newContext()` creates a
  separate context that may open its own window. neko issue
  [#572](https://github.com/m1k1o/neko/issues/572) shows the window-manager
  side of this: a window opened over CDP was 50% width until the openbox rules
  were changed.
- **Chrome 136 and later ignore `--remote-debugging-port` on the default
  profile directory.** The flag needs a non-default `--user-data-dir`
  ([Chrome blog](https://developer.chrome.com/blog/remote-debugging-port)). A
  persistent profile on a mounted volume satisfies this.
- **The DevTools port binds to 127.0.0.1 and `--remote-debugging-address` does
  not change that in headful mode.** The usual fix is a `socat` or nginx proxy
  inside the container (neko
  [#377](https://github.com/m1k1o/neko/issues/377), linuxserver
  [#71](https://github.com/linuxserver/docker-chromium/issues/71)). For beebox
  the agent and Chromium sit on the same host, so loopback is enough and no
  proxy is needed. A loopback port is reachable by every Unix account on the
  host, which matters because each box is its own Unix user (see the closing
  section).
- **Pixel streaming gives the agent no DOM-aware human input.** The person's
  clicks arrive as X11 or Wayland input events. The agent reads the
  accessibility tree over CDP and the page sees both sets of input. That works,
  but the agent must re-read state after a handoff because the person may have
  navigated.
- **Phone support is the weak point of the whole category.** Pixel streams
  were built for desktops with a mouse. Touch is mapped to mouse events by the
  client, and soft-keyboard handling varies. Details per candidate below.

## Comparison table

Scores use "yes", "partial", "no", or "unverified". Dates are release dates.

| | neko | Selkies 2.x | linuxserver chromium / webtop | KasmVNC | Kasm Workspaces CE | noVNC + VNC | Guacamole | Xpra |
|---|---|---|---|---|---|---|---|---|
| Licence (SPDX) | Apache-2.0 | MPL-2.0 (GPL parts optional) | GPL-3.0 | GPL-2.0 | Other / source-available (unverified detail) | MPL-2.0 core, VNC servers GPL-2.0 | Apache-2.0 | GPL-2.0; html5 client MPL-2.0 |
| Stars | 22.6k | 2.4k | 407 / 4.5k | 5.3k | n/a (images repo 1.2k) | 14.1k | 1.7k client, 4.0k server | 3.0k |
| Last release | v3.2.0, 2026-10-15 | 2.1.0, 2026-10-21 | rolling, 2026-10-28 | v1.5.2, 2026-10-24 | n/a | v1.7.0, 2026-04-28 | 1.6.0 (tag) | v6.5.5, 2026-10-12 |
| Maintainers | 1 dominant | 1 dominant | 2 active | 3 active | company | 2 to 3 | ASF project | 1 dominant |
| Several people, one session | yes, host model | yes, controllers and viewers | yes (Selkies) | partial, multi-user ACL | yes (KasmVNC) | VNC shared flag | sharing profiles | `sharing=yes` |
| Explicit control handoff | yes, built in | no, all controllers type | no | no (unverified) | no | no | no | no |
| Touch on phone | partial, regressions | yes, direct and trackpad modes | as Selkies | partial, open issues | as KasmVNC | partial | yes (unverified) | partial |
| iOS Safari | open bugs | works, one v2 regression fixed | as Selkies | partial | as KasmVNC | works (unverified) | works (unverified) | unverified |
| Transport | WebRTC, needs UDP or TCP mux port | WebSocket default, WebRTC optional | as Selkies | WebSocket, optional WebRTC | WebSocket | WebSocket | WebSocket via guacd | WebSocket |
| Single HTTPS port via proxy | no for media | yes | yes | yes | yes | yes | yes | yes |
| Native iframe embed | yes, `embed=1` | yes, `frame-ancestors` | yes | yes, with caveats | yes | yes | yes, with caveats | yes |
| CDP recipe exists | yes, community | no recipe found; computer-use API instead | partial, issues open | no recipe found | no recipe found | do it yourself | do it yourself | do it yourself |
| Runs without Docker | possible, documented as not recommended | yes (pip, deb, AppImage) | no | yes (deb, rpm) | no | yes | yes | yes |

## neko

Repo: [m1k1o/neko](https://github.com/m1k1o/neko). Apache-2.0. 22,564 stars,
147 open issues, created 2020-03, v3.2.0 on 2026-10-15, v3.1.6 on 2026-09-30,
v3.0.0 on 2025-04-01. Contributors: m1k1o 1,795 commits, nurdism 188,
mbattista 45. Of the 69 commits to `master` since 2026-07-29, m1k1o authored
42. One maintainer carries it, with a steady stream of one-off contributors.

**Shared session and control.** This is the feature neko was built for. The
server tracks one "host" per room. A member profile carries `can_host`,
`can_watch`, `can_access_clipboard`, `can_share_media`, `is_admin` and cursor
flags ([authentication docs](https://github.com/m1k1o/neko/blob/master/webpage/docs/configuration/authentication.md)).
The HTTP API has `control-request`, `control-give`, `control-take`,
`control-release`, `control-reset` and `control-status`
([API docs](https://github.com/m1k1o/neko/tree/master/webpage/docs/api)). In
`control.go`, when `implicit_hosting` is on, any mouse or key event from a user
who can host makes that user the host. When it is off and a host exists, the
event is refused and the host receives a `CONTROL_REQUEST` message
([source](https://github.com/m1k1o/neko/blob/master/server/internal/websocket/handler/control.go)).
Beebox could drive handoff from its own UI by calling the API with
`session.api_token`, an API user that cannot connect to a room but can run
admin calls ([docs](https://github.com/m1k1o/neko/blob/master/webpage/docs/configuration/authentication.md)).
This is the only candidate with an arbitrated host model out of the box. The
agent does not pass through neko's input path at all, so "agent has control" is
a beebox-side state, not a neko state.

**Embedding and auth.** The client supports `?embed=1`, and the FAQ documents
`?usr=...&pwd=...` to skip the login form
([faq](https://github.com/m1k1o/neko/blob/master/webpage/docs/faq.md),
[#353](https://github.com/m1k1o/neko/issues/353)). Providers: multiuser
(shared passwords), file, object, noauth, and OAuth 2.0/OIDC added in the v3
line. Issue [#722](https://github.com/m1k1o/neko/issues/722) (open) asks for
password and OIDC together. Passing a password in the URL is weak for beebox.
A better fit is the `noauth` or file provider on loopback, with beebox's own
reverse proxy authenticating the person and injecting the neko credentials.
Verification of that exact flow: unverified.

**Network.** The docs state that "it is not possible to use nginx or other
reverse proxies to forward the WebRTC traffic". The signalling websocket goes
through the proxy. Media uses either an ephemeral UDP range (`epr`), one UDP
port (`udpmux`), one TCP port (`tcpmux`), or a TURN server
([webrtc docs](https://github.com/m1k1o/neko/blob/master/webpage/docs/configuration/webrtc.md)).
So HTTPS on 443 alone is not enough. One extra port (TCP and UDP) must reach the
host, and `nat1to1` accepts only one address. Phones on cellular or captive
networks may need TURN. TURN issues are open: time-limited credentials
([#370](https://github.com/m1k1o/neko/issues/370)) and Cloudflare TURN
([#488](https://github.com/m1k1o/neko/issues/488)). For N concurrent boxes, each
neko instance needs its own mux port.

**Input features.**

- Keyboard and mouse: XTEST on an Xorg display.
- Touch: a custom xf86 input driver for touchscreens, loaded as a plugin
  ([desktop docs](https://github.com/m1k1o/neko/blob/master/webpage/docs/configuration/desktop.md)).
  The roadmap lists touch as part of the control layer.
- Clipboard: Clipboard API on Chromium, a button fallback elsewhere. Safari
  fallback was added ([#706](https://github.com/m1k1o/neko/issues/706), closed
  2026-09-30). iOS clipboard sharing ([#473](https://github.com/m1k1o/neko/issues/473))
  was closed 2026-07-31 after the maintainer wrote in 2025-02 that mobile
  support "is currently not planed. Only as best-effort."
- Files: a server-side file transfer plugin (upload, download, delete, with
  per-user flags) and an upload-drop API. Files land in a server directory, not
  Chromium's download folder, unless configured.
- IME: v3.2.0 states that "IME and on-screen keyboard text" are handled as key
  events ([release notes](https://github.com/m1k1o/neko/releases/tag/v3.2.0)).
  Issue [#547](https://github.com/m1k1o/neko/issues/547) (IME behaviour) is still open.

**Phone and iOS evidence.** v3.2.0 replaced the Vue 2 client with a React 19
client two weeks before this note. Open issues since then:

- [#719](https://github.com/m1k1o/neko/issues/719), 2026-10: on iOS Safari
  after 3.2.0 only the first tap clicks. iPhone 15 on iOS 18.5. Android also
  reported. The reporter says 3.1.6 did not have it.
- [#626](https://github.com/m1k1o/neko/issues/626): opening the live URL
  crashes the Safari GPU process on some iPads and iPhones.
- [#318](https://github.com/m1k1o/neko/issues/318): iPad fullscreen problems.
- [#640](https://github.com/m1k1o/neko/issues/640): trackpad-style touch input
  exists "as lib" in the new client and is not yet in the GUI.
- [#566](https://github.com/m1k1o/neko/issues/566): soft keyboard opens at the
  wrong times.
- [#251](https://github.com/m1k1o/neko/issues/251), 2023: "only watching works"
  on phones. Older than the rewrite.

Net: iOS control works in some versions and breaks in others. It is the
weakest part of neko for beebox. A native iOS app with a webview inherits
WKWebView's WebRTC support, which is the same engine as Safari. Whether
WKWebView needs extra entitlements for media: unverified.

**Agent side.** The neko docs have no CDP page. The path is the maintainer's
advice in [#391](https://github.com/m1k1o/neko/issues/391): add
`--remote-debugging-port` to the browser command in `supervisord.conf`. Gaps
found:

- The shipped `chromium` and `google-chrome` supervisor entries do not set a
  remote-debugging port, and they pass `--bwsi` (guest mode)
  ([chromium supervisord.conf](https://github.com/m1k1o/neko/blob/master/apps/chromium/supervisord.conf)).
  Guest mode has no persistent profile (my reading of the Chromium flag;
  unverified in neko). Remove it for CDP use with a persistent profile.
- Chrome policy in the image disables DevTools (`DeveloperToolsAvailability`),
  per the community image below.
- Binding is loopback only; neko's own advice was socat or nginx.

A community image, [frankhommers/neko-chrome-cdp-docker](https://github.com/frankhommers/neko-chrome-cdp-docker)
(MIT, 1 star, created 2026-02, pushed 2026-10-12), does exactly this: Chrome
stable, a socat proxy, DevTools policy re-enabled, one browser for the WebRTC UI
and Playwright. The sibling [neko-helium-cdp-docker](https://github.com/frankhommers/neko-helium-cdp-docker)
(0 stars) does the same with Helium. [aliksir/neko-browser](https://github.com/aliksir/neko-browser)
is a headed Playwright MCP server with persistent profiles ("neko" in the name
refers to a different project, unverified). In issue
[#391](https://github.com/m1k1o/neko/issues/391) a user states the same goal as
beebox: automation that "gets stuck" and a person who takes over via the neko
UI. No answer in that thread shows a working end-to-end recipe. Issue
[#645](https://github.com/m1k1o/neko/issues/645) lists Artemis AI, a shared
authenticated-browser hub on neko plus Traefik, unrelated to CDP.

**Persistence.** Chromium's profile lives under `~/.config/<browser>` of the `neko` user.
The troubleshooting page covers reusing a profile across restarts and notes
that Chromium's singleton lock embeds the hostname, so a fixed container
hostname is needed ([troubleshooting](https://github.com/m1k1o/neko/blob/master/webpage/docs/troubleshooting.md)).
Mount that directory and drop `--bwsi`.

**Cost and isolation.** Software encoding by default (GStreamer VP8 or H.264
pipelines in config), optional NVIDIA/VAAPI. Docs require `shm_size: 2gb` for
Chromium. No per-session RAM or CPU numbers in the docs. Measured per-session
cost: unverified. Docker is the supported path. The FAQ says native use is
possible but "not recommended" and sketches it: Xorg, PulseAudio, GStreamer and
the neko binary. Running under a per-box Unix user would need your own X
server, PulseAudio instance and port allocation per box. That work is
unvalidated.

**neko-rooms.** [m1k1o/neko-rooms](https://github.com/m1k1o/neko-rooms):
Apache-2.0, 774 stars, 28 open issues, v1.6.5 on 2026-03-29, single
maintainer (m1k1o 434 commits). It starts neko containers on demand through the
Docker API with Traefik and a mux port per room. It requires Docker and
Traefik. Beebox already has its own per-box process model, so neko-rooms
duplicates it. It is useful as a worked example of per-room port allocation.

## Selkies

Repo: [selkies-project/selkies](https://github.com/selkies-project/selkies).
MPL-2.0 (the default `pixelflux` build links GPL x264/x265; a flag builds
without them, per the
[pixelflux README](https://github.com/selkies-project/pixelflux)). 2,421 stars,
6 open issues, 2.1.0 on 2026-10-21, 2.0.0 on 2026-09-23. Commits since
2026-07-29 on `main`: ehfd about 1,300, thelamer 75, then single digits. One
author writes almost all the code. The README itself says "We are in need of
maintainers". Bus factor: 1.

Selkies 2.0 is a rewrite. The release notes say GStreamer is gone and
**WebSocket is the default transport on one TCP port**, decoded with WebCodecs,
with striped JPEG as the fallback for browsers without decoders, "nothing about
it needs STUN or TURN". WebRTC is opt-in (`--mode=webrtc`)
([2.0.0 notes](https://github.com/selkies-project/selkies/releases/tag/2.0.0)).
That removes the largest obstacle that neko has. Latency of a TCP-based stream
is higher on lossy links (general property; no measurement found). Dual mode
lets the page switch transports.

**Sharing.** Viewer and "player 2 to 4" links share a running session. Input
authority is enforced server-side: viewers' input is refused. Secure mode
provisions session tokens with a role (`controller` or `viewer`) and a gamepad
slot through `POST /api/tokens` or a tokens file
([secure-mode docs](https://github.com/selkies-project/selkies/blob/main/docs/secure-mode.md)).
In 2.1.0 "several pages can control one display" and a second tab joins beside
the first. There is no handoff protocol and no host concept: every controller
types and moves the pointer at once. Beebox would implement handoff itself by
switching a token between `controller` and `viewer` roles. That relies on the
role of an open connection being re-evaluated; unverified.

**Embedding and auth.** One port serves the bundled client. Token goes in the URL
fragment (`#token=...`), which never reaches proxy logs, or in a query string.
`--frame-ancestors` defaults to `'self'` since 2.1.0; an embedding origin must
be named. A Unix-domain-socket listen option exists
([#285](https://github.com/selkies-project/selkies/issues/285), closed), which
fits a reverse proxy in front of per-user sockets. `--addr`/`--port`,
`selkies session`, and a subfolder path are supported
([README](https://github.com/selkies-project/selkies)).

**Input.** Two touch modes: direct touch (tap clicks, long press right-clicks,
two-finger scroll, pinch zoom) and trackpad mode with acceleration
([usage](https://github.com/selkies-project/selkies/blob/main/docs/usage.md)).
Two-way clipboard for text, images and formatted content on Chromium, Firefox
and Safari, needing HTTPS. File upload and download in both directions
(viewer tokens cannot list or download). Printing to a virtual printer.
Closed issues show the team fixes input details quickly: CJK commit text
([#432](https://github.com/selkies-project/selkies/issues/432)), Ctrl+V stale
clipboard in Chromium ([#480](https://github.com/selkies-project/selkies/issues/480)),
stuck keys on macOS ([#427](https://github.com/selkies-project/selkies/issues/427)).
Whether iOS soft-keyboard input reaches the page reliably: unverified.

**iOS evidence.** Issue [#469](https://github.com/selkies-project/selkies/issues/469)
(closed 2026-10-18): after the v2 update, Safari on macOS and iOS showed a
black screen with an unresponsive play button on first load. Closed within the
release window. WebCodecs audio needs Safari 26 or later; older Safari gets
video without it
([web-client docs](https://github.com/selkies-project/selkies/blob/main/docs/components/web-client.md)).
Stylus tap bug [#456](https://github.com/selkies-project/selkies/issues/456),
closed. I did not test any of this on a device.

**Agent side.** There is no documented CDP recipe. Selkies ships a different
agent surface: the `pixelflux` "Computer Use" HTTP server implementing the
Anthropic computer-use action set (screenshot, mouse, keys) over XTEST/Wayland
input, bearer-token protected, enabled with `PIXELFLUX_CU`
([pixelflux README](https://github.com/selkies-project/pixelflux)).
linuxserver's [Pelorus](https://github.com/linuxserver/pelorus) (15 stars,
2026-10) adds an AT-SPI accessibility-tree agent loop on top. Both are
desktop-level and pixel-coordinate or AT-SPI based. They give the agent no DOM
or Playwright locators. CDP remains available by launching Chromium with
`--remote-debugging-port` and `--user-data-dir` inside the session, as in any X
session; nothing in the Selkies docs prevents it. A related Selkies fix,
[#482](https://github.com/selkies-project/selkies/issues/482), concerns Chromium
GPU flags on Xvfb.

**Cost and isolation.** Hardware encode (NVENC, VA-API) with zero-copy on GPU
hosts; software encoders (x264/OpenH264, libvpx, SVT-AV1) otherwise. CPU cost
per session: unverified; CBR plus congestion control are default in 2.1.0.
Selkies is built for "unprivileged containerized environments" and ships
pip, deb, rpm, apk, and AppImage packages and `selkies session`, which starts
Xvfb and PulseAudio/PipeWire itself. That suits one process tree per Unix user
without Docker. The interposer sockets refuse paths owned by another account
(2.1.0 notes). Running N sessions on one CPU-only host: unverified.

**Risks.** A rewrite five weeks old, one dominant author, about 1,300 commits in three months, and breaking default changes between 2.0 and 2.1 (CBR, `frame-ancestors`, tokens).

## linuxserver.io chromium and webtop images

[linuxserver/docker-chromium](https://github.com/linuxserver/docker-chromium)
(GPL-3.0 for the image scripts, 407 stars, 1 open issue, rolling tags, last
2026-10-28) and
[docker-webtop](https://github.com/linuxserver/docker-webtop) (GPL-3.0, 4,464
stars, a full desktop) are packaging layers on
[docker-baseimage-selkies](https://github.com/linuxserver/docker-baseimage-selkies)
(GPL-3.0, 231 stars). They inherit Selkies behaviour and add: a `CHROME_CLI`
variable for flags, basic auth through `CUSTOM_USER`/`PASSWORD` (no auth by
default), a `SUBFOLDER` for reverse proxying, `/config` for the profile.
Contributors: thelamer plus automation.

CDP status: issue [#75](https://github.com/linuxserver/docker-chromium/issues/75)
(open, 2026-06) asks for CDP support. The maintainer redirected to
[#71](https://github.com/linuxserver/docker-chromium/issues/71), which
explains the pieces: `CHROME_CLI` with `--remote-debugging-port` works only
with a non-default `--user-data-dir` (Chrome 136 rule), and the port stays on
127.0.0.1. A commenter in #71 posts a compose file that sets
`CHROME_CLI="--user-data-dir=/config/ --remote-debugging-port=9223"` and maps a
proxy port; the image evidently contains a forwarder (unverified). Mobile:
issue [#73](https://github.com/linuxserver/docker-chromium/issues/73) reports a
"Waiting for Stream" hang on Android Chromium; switching the encoder to JPEG
fixed it. That predates Selkies 2.x (closed 2026-04). The images are
Docker-only. They take their sharing and token behaviour from Selkies.

The images are a convenient proof of concept for "Selkies plus Chromium plus
CDP" within an afternoon. They are a poor production base for beebox because
beebox does not use Docker and the image bundles a desktop stack.

## KasmVNC and Kasm Workspaces

[kasmtech/KasmVNC](https://github.com/kasmtech/KasmVNC): GPL-2.0, 5,347 stars,
122 open issues, v1.5.2 on 2026-10-24, v1.5.0 on 2026-07-29, v1.4.0 on
2025-10-22. Commits since 2026-07-29: one author (quickiwiki) about 200, then
mattmcclaskey 29. Company-backed (Kasm Technologies).

**What it is.** A VNC server (a TigerVNC fork) with its own web client and a
WebSocket transport on one HTTPS port. Features listed in the README: WebCodecs
H.264/H.265/AV1, WebRTC UDP transit (optional), binary clipboard and seamless
clipboard on Chromium-based browsers, IME support, multi-user permissions
changeable through an API, data-loss-prevention controls, "better mobile
support", DRI3 GPU acceleration
([README](https://github.com/kasmtech/KasmVNC)). `vncserver` runs as the
invoking user; systemd user units exist (`kasmvncserver@:1`). Deb and rpm
packages. That is the best fit among the VNC-family tools for "no Docker, one
Unix user per box".

**Sharing.** Multi-user: users created with `vncpasswd -u name -w -r` have read
and write roles and are managed through the HTTP API. Several clients can view
one session. There is no control-handoff protocol (unverified; I found none in
the README). Per-user control would be a beebox-side token or role change via
the API.

**Embedding.** Issues show friction: black blocks inside an iframe
([#233](https://github.com/kasmtech/KasmVNC/issues/233), open since 2024),
basic-auth removal questions ([#284](https://github.com/kasmtech/KasmVNC/issues/284),
[#268](https://github.com/kasmtech/KasmVNC/issues/268)), and custom HTTP header
parsing bugs ([#336](https://github.com/kasmtech/KasmVNC/issues/336)). Auth is
HTTP basic by default.

**Phone.** Open issues: pinch-to-zoom on iOS
([#329](https://github.com/kasmtech/KasmVNC/issues/329)), mouse tracking in
Android Chrome ([#222](https://github.com/kasmtech/KasmVNC/issues/222), updated
2026-10-19), mouse unusable in Chromium-based Android browsers
([#123](https://github.com/kasmtech/KasmVNC/issues/123)). Clipboard features
are Chromium-only, so iOS Safari does not get seamless clipboard.

**Agent side.** No CDP recipe found. Nothing prevents `chromium
--remote-debugging-port` inside the session (same Chrome 136 rule applies).
Kasm's own browser images (kasmtech/workspaces-images, 1,239 stars,
MIT-style text in the LICENSE file but flagged NOASSERTION by GitHub) do not
document CDP either; a search of that repo's issues for "remote debugging" and
"playwright" returned nothing.

**Kasm Workspaces (the platform).** Community Edition is "for non-commercial
use" with "up to 5 concurrent sessions"
([Kasm licence page](https://docs.kasm.com/docs/reference/license)). The
platform itself is a Docker-based orchestrator with its own database and web
app. It is not open source in the sense beebox wants, and it duplicates box
lifecycle. Reject.

## noVNC with TigerVNC, x11vnc, or Xvfb

[noVNC](https://github.com/novnc/noVNC): core MPL-2.0 (the LICENSE file
splits by path; GitHub reports NOASSERTION), 14,143 stars, v1.7.0 on
2026-04-28 (v1.7.0-beta 2025-11), commits to 2026-10-23. Contributors: samhed,
CendioOssman (Cendio develops TigerVNC too), kanaka. Maintained by a small
group. [TigerVNC](https://github.com/TigerVNC/tigervnc): GPL-2.0, 7,660 stars,
v1.16.2 on 2026-03-26. [x11vnc](https://github.com/LibVNC/x11vnc): GPL-2.0,
last push 2025-05, 134 open issues; treat as slow-moving.

**Fit.** noVNC is a client library, not a product. Pair it with a VNC server
(TigerVNC `Xvnc` as the Unix user, with Xvfb built in) and a WebSocket proxy
(`websockify`, or TigerVNC's built-in web serving). One HTTPS/WebSocket port
through a reverse proxy works. VNC supports a "shared" flag so several viewers
attach to one session. Everyone with a password can type. There is no handoff.
Beebox would own the UI (`viewOnly` can be toggled at runtime in the noVNC API;
my recollection of the API, unverified here).

**Weaknesses.** Pixel encodings are older (Tight, JPEG, ZRLE) and use more
bandwidth and CPU than video codecs. Clipboard needs the VNC clipboard
extension and has known limits for non-text data. File transfer: none in the
protocol. Touch: noVNC maps touch gestures to mouse (tap, drag, long press,
pinch) and shows an extra keyboard button; iOS soft keyboard handling has a
history of bugs (not re-verified for 1.7.0). IME: partial (unverified).

**Agent side.** Same as any X server: launch Chromium with
`--remote-debugging-port` and a `--user-data-dir`. No stack-specific problem.

**Why it still matters.** It has the smallest moving parts, the most users,
permissive core licence, runs as an unprivileged Unix user, and has no WebRTC.
It is the baseline to compare bandwidth, latency, and phone behaviour against.

## Apache Guacamole

[apache/guacamole-client](https://github.com/apache/guacamole-client) and
[guacamole-server](https://github.com/apache/guacamole-server): Apache-2.0,
1,746 and 4,027 stars, client tag 1.6.0, last commit 2026-10-14. Contributors:
mike-jumper 4,695 commits, necouchman 1,298, jmuehlner 902. An ASF project with
a small active core.

**Fit.** Guacamole is a gateway: a Java web app (Tomcat) plus `guacd` (C) that
translates VNC, RDP or SSH into the Guacamole protocol over WebSocket and
HTTP. Everything flows over HTTPS through a reverse proxy. It has users,
groups, connection sharing profiles (read-only or read/write share links), and
session recording. Auth extensions cover LDAP, OIDC, header auth, TOTP.
Sharing via a share key is the built-in feature closest to "invite a viewer".
There is no control handoff within one share.

**Cost.** A Java servlet plus database for beebox's single-server use is
infrastructure that duplicates what beebox does (users, sessions, auth). Its
JavaScript client can be used alone with a custom backend (the
`guacamole-common-js` library), but the protocol stack is the heavy part. I did
not find iOS-specific issue threads; touch support is in the client library
(unverified on iOS 18/26). Clipboard and file transfer exist for RDP drive
redirection; for VNC, file transfer is limited (unverified).

**Agent side.** Same as noVNC: Chromium on an X server that guacd reaches by
VNC. Adds a hop (guacd re-encodes into its own protocol) and more latency
than direct streams (general property; unmeasured).

## Xpra

[Xpra-org/xpra](https://github.com/Xpra-org/xpra): GPL-2.0, 3,037 stars, 130
open issues, v6.5.5 on 2026-10-12. Commits since 2026-07-29: totaam about
1,500, joshiggins 9, kogeler 7. Bus factor: 1. HTML5 client
[xpra-html5](https://github.com/Xpra-org/xpra-html5): MPL-2.0, 342 stars, v20
on 2026-03-18, last push 2026-10-29.

**Different model.** Xpra forwards individual X11 windows ("seamless mode") or
a whole display, so a single Chromium window can appear in the browser as a
browser-tab-sized canvas. `xpra start --start-child=chromium` runs as the
invoking user, no Docker needed. `sharing=yes` lets several clients attach to
one session. Issue [#4883](https://github.com/Xpra-org/xpra/issues/4883)
(open) shows that shared sessions with different monitor layouts lock to one
coordinate space and the display shrinks to the smallest client. For one
Chromium window that matters less.

**Phone.** Touch support is an open request: [#1615](https://github.com/Xpra-org/xpra/issues/1615)
and [#3714](https://github.com/Xpra-org/xpra/issues/3714) (both open) concern
touch devices; the HTML5 client is described as a desktop-style client.
[#3422](https://github.com/Xpra-org/xpra/issues/3422) (closed) was an
HTML5 connection failure from macOS and iOS. I did not find a statement that
iOS Safari works for input. Treat as unverified and likely weak.

**Fit.** Good Unix citizenship and a single TCP/WebSocket port. Weaker on
phone, on handoff, and on project concentration (one maintainer). CDP: same
launch-flag approach.

## What this means for beebox

Constraint recap: one Linux server, one Unix user per box, phones and
iOS webview, an agent on CDP, and a person who takes over and hands back.

### Cross-cutting design points

1. **Keep CDP on loopback and Chromium under the box's Unix user.** The
   DevTools port is reachable by every account on the host. Use a Unix-domain
   socket proxy or `--remote-debugging-pipe` where possible (Playwright
   `launch` supports pipes, `connectOverCDP` needs a port; the trade-off is
   beebox's to resolve). A per-box random port plus a firewall rule keyed on
   uid is a second option. This is a security finding independent of the
   candidate.
2. **Handoff is cheaper to build in beebox than to find in a stack.** Only
   neko has host arbitration. Everywhere else the person's input and the
   agent's CDP actions both reach the page unarbitrated. Beebox can gate the
   agent (pause its tool calls) and gate the person (viewer token or an
   overlay that eats events) from its own state.
3. **Transport decides phone viability more than anything else.** WebRTC
   needs an extra reachable port per instance and often TURN. A WebSocket
   stream goes through the existing HTTPS reverse proxy that beebox already
   runs. Selkies 2.x and the VNC family give that. neko does not.
4. **Resource cost is unmeasured here.** All of these software-encode a
   1080p-class stream per active viewer plus a headful Chromium plus Xvfb.
   Expect hundreds of MB of RAM and a fraction of a core to one or more cores
   per active session; no figure in this note is measured. Run the encoder only
   while a person watches (Selkies and neko both stop or idle when no client is
   connected: unverified for both).

### Per-candidate lean

| Candidate | Lean | Reason |
|---|---|---|
| neko | **Adapt, as a reference and as a fallback path.** | Best arbitrated multi-user control, Apache-2.0, large community, a working community CDP recipe. Against it: WebRTC port and TURN requirements, Docker-centric packaging, one maintainer, and open iOS tap bugs introduced by the 3.2.0 client two weeks ago. Reuse its ideas (host model, API) in beebox's own handoff. |
| Selkies 2.x (native, not the linuxserver images) | **Adapt; the strongest candidate to prototype first.** | One TCP port through the existing proxy, MPL-2.0, runs unprivileged as a Unix user without Docker (pip, deb, AppImage, `selkies session`), token roles for viewer and controller, tested touch modes and Safari support, active fixes. Against it: 5-week-old rewrite, effectively one author, no CDP recipe (must be tested), no built-in handoff. |
| linuxserver chromium/webtop | **Later / reject as base.** | Docker-only packaging of Selkies. Useful for a quick CDP and phone experiment because the compose recipe in issue #71 exists. |
| KasmVNC | **Later.** | Good no-Docker story and a one-port transport, GPL-2.0, but weaker phone issues (open iOS pinch and Android pointer bugs), Chromium-only clipboard, iframe friction, no handoff. Revisit if Selkies stalls. |
| Kasm Workspaces CE | **Reject.** | Non-commercial licence, 5-session cap, duplicates box lifecycle, Docker platform. |
| noVNC + TigerVNC/Xvfb | **Later, as the baseline control.** | Simplest and least capable. Run it once to measure phone behaviour and bandwidth against Selkies. Pixel encodings are older. |
| Guacamole | **Reject.** | A Java gateway and database duplicating beebox's users and auth. Its JS client has no advantage over noVNC here. |
| Xpra | **Reject for now.** | Phone input is the weakest of the group, one maintainer, and sharing semantics aimed at multiple desktops. Its single-window model is attractive and deserves a short look later (unverified). |

### Biggest risk

The phone path. A pixel stream inside a webview on iOS has three separate
failure points: touch-to-pointer mapping and soft-keyboard focus (neko #719,
#566; KasmVNC #329), codec and autoplay behaviour in Safari (neko #626; Selkies
#469, fixed), and, for WebRTC stacks, ports and TURN. Selkies in WebSocket mode
removes the third. The first two need a real iPhone and the beebox iOS webview
to test, because the issue evidence above is third-party and version-specific.

### Suggested next step (not done here)

A one-day spike with Selkies `selkies session` run as an unprivileged user
with Chromium started with `--user-data-dir=<box profile>` and
`--remote-debugging-port=<port>`. Check: Playwright `connectOverCDP` on
`contexts()[0]`, tap and type from iPhone Safari and from the iOS webview,
viewer-to-controller token switch while connected, and RSS/CPU with 1 and 5
idle sessions. Compare against neko with the frankhommers CDP image.
