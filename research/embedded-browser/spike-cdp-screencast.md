# Spike: CDP screencast viewer for a shared Chromium

Run 2026-10-29. Throwaway spike. Code stays in the scratchpad, not in the repo.

## Question

Can one Chromium session be shared by a person (watching and driving through a
web page) and an agent (Playwright `connectOverCDP`) at the same time, using
only CDP? The person's side is `Page.startScreencast` frames over a WebSocket
and `Input.*` events back. No X server, VNC or WebRTC. This is the lightweight
option for a server where each box runs as its own Unix user.

## Setup

- Host: macOS arm64 (Apple silicon), Node 24, `tsx`, `ws`, `playwright-core`.
  No Docker, so no Linux run. Everything below ran on the Mac.
- Browsers, all Chrome 149.0.7827.55 (Playwright chromium-1228):
  - `headless=new`: Chrome for Testing with `--headless=new`.
  - `headful`: the same binary with a real window.
  - `shell`: `chrome-headless-shell` from the same Playwright download.
- Flags: `--remote-debugging-port=0`, `--user-data-dir=<spike>/profile-<mode>`,
  `--window-size=1280,900`, `--no-first-run`, `--no-default-browser-check`,
  `--password-store=basic`, `--use-mock-keychain`. The server reads the port
  from `DevToolsActivePort`.
- Server (`server.ts`, about 250 lines): raw CDP over one browser-level
  WebSocket, flattened sessions. It attaches to one page target, starts the
  screencast (JPEG, quality 70, `maxWidth` 1280, `maxHeight` 1000) when the
  first viewer connects, and stops it when the last one leaves. Each frame goes
  to viewers as `[u32 json length][json metadata][jpeg bytes]`. The server
  acks a frame when the WebSocket send completes, which gives backpressure.
- Viewer (`public/viewer.html`): a canvas, URL bar, tab strip, "Take control /
  Give back" button and "Fit viewport" button. Mouse, wheel, touch and
  keyboard events go back as JSON. Coordinates scale from canvas CSS pixels to
  page CSS pixels using `deviceWidth`/`deviceHeight` from the frame metadata.
- Control lock: `GET /state` returns `holder: agent|human`. The viewer's input
  is refused (and logged) unless the human holds the lock. The agent client
  polls `/state` before each step and waits while the human holds it.
- Agent (`agent.ts`): `chromium.connectOverCDP(wsUrl)`, uses
  `contexts()[0].pages()[0]`.
- "Person": `bin/browse` drove the viewer page. Screenshots of the viewer
  canvas come from `canvas.toDataURL()` through `bin/browse eval`, because
  `bin/browse screenshot` hung while the macOS screen was locked (see below).

## What worked

- Frames render. Click, wheel, typed text, Enter, Backspace and Ctrl/Cmd+A
  reach the right element. Clicks land within one pixel after scaling.
- Typed text: ASCII goes as `keyDown` with `text`. Accented letters, emoji
  and CJK arrive through `Input.insertText` (`input` and `compositionend`
  events on a hidden textarea). Paste arrives through the `paste` event and
  `insertText`. The composition and paste events were synthetic in the test.
  A real IME or phone keyboard was not tried.
- Touch: `Input.dispatchTouchEvent` from viewer touch events. A tap fired the
  page's `touchstart`, `touchend` and a click. A 300 px drag scrolled the page.
  The events were synthetic `TouchEvent`s dispatched on the canvas, because
  `bin/browse` has no touch command.
- Phone-sized viewer: with "Fit viewport"
  (`Emulation.setDeviceMetricsOverride`, mobile true) the page lays out at the
  viewer's 390 px width. Without it, a 1280 px page shrinks to 30% on a phone.
  A page with no `<meta name=viewport>` lays out at 980 px and zooms out.
- Agent coexistence. After `connectOverCDP`, frames kept flowing in all three
  modes. `goto`, `ariaSnapshot` (12-68 KB of text), link click, `fill` on the
  Wikipedia search box and `press Enter` all worked while the screencast ran.
  `page.viewportSize()` is `null` after attach, and Playwright did not change
  the window size or device scale factor.
- Dialogs: `Page.javascriptDialogOpening` goes to the viewer, which shows its
  own overlay and answers with `Page.handleJavaScriptDialog`. Alert, confirm
  and prompt (with text) worked.
- Popups: a `target=_blank` link fires `Target.targetCreated` with `openerId`.
  The server attaches to the new target, restarts the screencast on it and
  updates the tab strip. Tabs the agent opens (no `openerId`) stay in the
  strip without a switch.
- File chooser: `Page.setInterceptFileChooserDialog` gives
  `Page.fileChooserOpened` with a `backendNodeId`. The viewer showed a file
  input, uploaded the bytes to the server, and the server called
  `DOM.setFileInputFiles` with the server-side path. The page saw the file.
- Download: `Browser.setDownloadBehavior` (`allowAndName`, events on) gave
  `downloadWillBegin` and `downloadProgress` (completed, 20 bytes). The file
  landed in the download directory, named by GUID.
- Lock: while the human held it, the agent client waited. Viewer input without
  the lock was refused and logged.

## Numbers

Viewport 1280x757 (`headless=new`, `headful`) or 1280x900 (`shell`). JPEG
quality 70 unless stated. Localhost. The frame rate is whatever Chrome emits,
with no throttle in the server.

| Measure | headless=new | headful | shell |
| --- | --- | --- | --- |
| Idle, static page (fps) | 0 | 0 | 0 |
| Idle, Wikipedia article (fps) | 0 | 0 | 0 |
| JS-animated 40 px box (fps / KB per frame) | 96 / 21.6 | 96 / 21.5 | 92 / 22.8 |
| Wheel scroll, Wikipedia, 60 px per 16 ms (fps) | 85 | 80 | 87 |
| Scroll frame size (KB, mean) | 110 | 107 | 131 |
| Scroll bandwidth (MB/s) | 9.4 | 8.5 | 11.4 |
| Click to next frame, median / p95 (ms) | 10 / 15 | 8 / 30 | 9 / 17 |
| Key to next frame, median / p95 (ms) | 12 / 16 | 9 / 20 | 11 / 22 |
| Chromium RSS, 1 tab (MB, process tree) | 668 | 695 | 350 |
| Chromium RSS, 3 tabs (MB) | 892 | 957 | 564 |
| Process count, 1 / 3 tabs | 9 / 11 | 9 / 11 | 4 / 6 |

Notes on the table:

- Latency is from sending the click or key to receiving the next frame, so it
  includes the server hop, Chrome's paint and JPEG encode, but not browser
  decode and canvas draw in the viewer. A frame only appears after a visual
  change, so the first frame after the input is the response.
- RSS sums `ps` RSS over the Chromium process tree. It counts shared pages more
  than once, so it overstates. A first `headless=new` run measured 1044 MB and
  1327 MB, so the figure varies by 50% with page state.
- Idle is 0 fps. A focused text field has a blinking caret that produces a
  frame about every 500 ms. That was not measured.

Frame size against quality and `maxWidth`, wheel scroll on a Wikipedia article
(`shell`, 87 fps in every row):

| Quality / maxWidth | KB per frame | MB/s at 87 fps | MB/s at 30 fps |
| --- | --- | --- | --- |
| 70 / 1280 | 131 | 11.2 | 3.8 |
| 50 / 1280 | 102 | 8.9 | 3.0 |
| 40 / 960 | 54 | 4.7 | 1.6 |
| 30 / 800 | 34 | 3.0 | 1.0 |

Scrolling a dense text page is the worst case seen. Chrome emits 80-95 frames
per second whenever the page changes, so a product needs its own frame cap
(`everyNthFrame`, or drop frames in the server).

## What broke or differed

- **macOS screen lock stops rendering.** While the session was locked,
  `headless=new` and `headful` produced no frames and `requestAnimationFrame`
  never fired. Playwright's `click` hangs on the actionability check, and
  `bin/browse screenshot` hung. `chrome-headless-shell` kept working. I first
  read the click timeouts as a Playwright problem. They were this. After the
  unlock, every agent step worked in all three modes. This affects a Mac dev
  box. It does not apply to a Linux server, which I could not test.
  `--disable-backgrounding-occluded-windows` and
  `--disable-features=MacWebContentsOcclusion,CalculateNativeWinOcclusion` did
  not fix it.
- **`<select>` popups do not work through the viewer.** Clicking a select sends
  `mousePressed`, and Chrome opens a popup. In `shell` it has no widget. In
  `headful` it is a native window that the screencast does not capture. In
  both, `ArrowDown` and `Enter` sent afterwards did not change the value.
  Typing a letter on a focused, closed select does change it. A product needs
  its own select handling: detect the click on a `<select>` and show a list in
  the viewer, then set the value with `Runtime.evaluate` and fire `change`.
- **Viewport emulation is shared and last-writer-wins.** The viewer's "Fit
  viewport" and Playwright's `page.setViewportSize` both use
  `Emulation.setDeviceMetricsOverride`. Playwright's override replaces the
  human's. A human clear removes the agent's. Playwright re-applies its own
  size on reload and `goto`, so after one agent navigation the human's phone
  fit was gone. `mobile: true` did not enable touch points
  (`navigator.maxTouchPoints` stayed 0).
- **Dialogs race with Playwright.** With no `page.on('dialog')` handler,
  Playwright dismisses a dialog at once. The viewer received the open and
  close events in the same millisecond, and `confirm` returned false. With a
  slow Playwright handler, the human answered first and the handler's
  `dialog.accept()` threw "No dialog is showing". The agent needs a handler
  that tolerates that error and defers to the human.
- **Frame rate is uncapped.** See the table.
- **Headful retina:** `devicePixelRatio` is 2 and the viewport is 1280x757, so
  frames are 2x unless `maxWidth` caps them. The spike capped at 1280.
- **No clipboard out.** Paste into the page works through `insertText`. Copy
  from the page to the viewer's clipboard was not built. It needs
  `Runtime.evaluate` on `getSelection()` and a user-gesture write in the
  viewer.
- Popups from `window.open` with a size feature were not tested separately.
  The `target=_blank` path worked.
- Window-level problems of `headful` that a screencast cannot show: the native
  select popup, the native file dialog (intercepted), the download bubble, the
  permission prompt and print dialogs.

## What a product would still need

- Frame cap, adaptive quality and a smaller `maxWidth` for phones. A client
  ack-based throttle, not only the server's send callback.
- Select popup replacement. Date, color and autofill popups likely need the
  same treatment. Not tested.
- A viewport policy. Either the human's viewer never emulates (the phone sees a
  scaled desktop page), or the agent and human share a fixed size, or the
  human gets a separate tab or context. The shared default context makes
  "human-sized viewport" and "agent-sized viewport" the same setting.
- Dialog ownership: one component answers dialogs, with the human first and
  the agent as fallback after a timeout.
- A real lock in front of the agent. The spike's lock is a flag the agent
  client checks. Playwright talks to Chrome directly, so a product needs the
  agent to go through a CDP proxy that drops `Input.*` and navigation while the
  human holds the lock. Chrome accepts both clients' input at once otherwise.
- Tab policy: which tab the screencast follows (opener popups: follow; agent
  tabs: show in the strip), tab close, and screencast only on the visible tab.
  Background-tab rendering was not tested.
- Keyboard: IME composition on real devices, Alt/Option compose keys, key
  repeat, shortcuts (Ctrl/Cmd+C/X/V/Z), and the mobile soft keyboard (key
  codes are 229). Focus detection to raise the soft keyboard only when a text
  field is focused.
- Clipboard copy, drag and drop between the page and the viewer, file download
  hand-off to the person (the spike stores files by GUID on the server).
- Audio and video playback. A screencast has no audio. Video frames work as
  JPEG at a low frame rate.
- Authentication and per-box isolation: the DevTools port and the viewer
  WebSocket sit behind the box's own auth. One Chromium per Unix user, with a
  Unix socket or `--remote-debugging-pipe` instead of a TCP port.
- Reconnect and resume after a viewer drop, including a keyframe on connect.
  `startScreencast` sends a new frame only on change, so a fresh viewer sees
  nothing until the page changes. The spike restarts the screencast when the
  first viewer joins. A second viewer would likely wait for a change (not tested).
- Linux: run the same checks on `headless=new` and `chrome-headless-shell`
  there. The Mac numbers do not carry over for RSS or frame rate.

## Verdict

A CDP screencast viewer is enough for a first beebox shared browser, if the
product accepts four limits: no audio, no native popups (select and similar
need replacements), a shared viewport, and the frame-rate and bandwidth work
above. Agent attach works without disturbing the screencast. Latency on
localhost is about 10 ms. An idle page costs nothing.

Input fidelity for a person on a laptop or phone is good for clicks, scroll,
typing, touch, dialogs, uploads, downloads and popups. The costs are product
work on the web side, not a new infrastructure layer. It needs no X server, no
window manager, no TURN or UDP port, and one process tree per box (350-700 MB
for one tab).

A pixel-streaming stack (neko, Selkies, KasmVNC) is needed only if one of these
becomes a requirement: audio or smooth video, native popups and OS dialogs the
person must use, or text-entry methods the CDP input path cannot carry (a full
IME on a desktop browser, extensions with their own windows). Those stacks also
add a window manager, an X server and a WebRTC or VNC transport per box. See
`streaming-stacks.md` for those. The spike did not measure over a real network.
Bandwidth at 30 fps was 1-4 MB/s for scrolling a text page. That is 8-30 Mbit/s,
and it needs the frame cap before a phone on a mobile connection can use it.

## Spike files

Directory: the research session's scratchpad, `cdp-spike/` (not kept in git; lost on reboot).

- `server.ts`, `cdp.ts`: launcher, CDP client, bridge, control lock, `/info`,
  `/state`, `/log`, `/upload`.
- `public/viewer.html`, `public/test.html`: viewer and the test page.
- `agent.ts`: the Playwright agent run. `emul.ts`, `dlg.ts`: viewport and
  dialog coexistence checks. `exp*.ts`, `probe*.ts`, `sel.ts`, `anim.ts`:
  one-off probes. `bench.ts`, `scroll.ts`: numbers.
- `restart.sh`, `shot.sh`, `rects.ts`, `nav.ts`, `touch.js`: helpers.
- `bench-*.txt`, `agent-*.txt`: raw outputs.
- Screenshots of the viewer canvas: `viewer-desktop-typing.png`,
  `viewer-phone-fit.png`, `viewer-phone-touch.png`, `viewer-select-shell.png`,
  `viewer-desktop-1.png`, `viewer-desktop-3.png`.
