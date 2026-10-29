---
title: "bin/browse --args launch flags do not reach Chromium, so media permission cannot be faked"
workstream: unattached
area: browse
labels: [browse, testing]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261028-234100
---

`bin/browse open <path> --args "--use-fake-device-for-media-stream,--use-fake-ui-for-media-stream"`
after `bin/browse close` leaves `getUserMedia` failing in the page. The
session that hit it concluded that the wrapper starts the daemon (to set the
browse-key cookie) before the hoisted `AGENT_BROWSER_ARGS` apply
(`browse/src/launch-options.ts`); setting `AGENT_BROWSER_ARGS` in the
environment did not help either. `commands.md` in the browse skill says launch
options work on a closed browser.

Microphone and camera paths therefore cannot be checked end to end. Sessions
replace `navigator.mediaDevices.getUserMedia` in the page with an
`AudioContext` oscillator stream via `bin/browse eval`.

Coding feedback: mic-idle-close/20261028T151759Z-review-adjudicated.md. The
previous retrospectives' watch list recorded the same failure twice
(`browse-media-permission`, last 2026-10-23).

Wanted: launch options reach the browser process on the first `open` after a
close, with a test that reads them back (`chrome://version` command line or a
`getUserMedia` call under the fake-device flags).
