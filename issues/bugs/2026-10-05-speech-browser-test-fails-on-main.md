---
title: "The speech browser test fails 14 of 16 checks on main"
workstream: unattached
area: beebox
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-gemini-tts-38 — verifying streamed speech playback
---

`beebox/src/scripts/test-speech-browser.sh` drives the dev-only `/dev/speech`
harness through `bin/browse` and asserts on `window.__speechTestLog`. On
2026-10-05 it reports `2 passed, 14 failed` from the main checkout and from the
`gemini-tts-38` worktree alike, so the failures are not from that branch.

Failing phases: streaming starts before download completes, the menu's
stop/fast-forward/replay items, sticky failure states, and media-rejection
reporting. The two passes are "all three segments downloaded + cached" and
"head segment shows waiting before audio starts" — the steps that do not need
audio to play.

Likely cause (unverified): Chrome's autoplay policy. The script starts playback
with `element.click()` from `eval`, which gives the page no user activation.
In the same session, a MediaSource probe started from `eval` was rejected with
`NotAllowedError: play() failed because the user didn't interact with the
document first`, and the same probe started by `bin/browse click` played
normally. If that is the cause, starting the harness with a real `bin/browse
click` (or launching the browse Chrome with an autoplay-policy flag) would fix
the whole script.

Until it is fixed, this script cannot verify speech playback changes.
