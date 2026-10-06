---
title: "Chat audio unlock reports an unsupported-source warning in Chromium"
workstream: chat-scroll-fixes
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-scroll-fixes — real chat send verification
---

Implemented by `e458ace17` and landed on main in `16eae8850`. The dev router
admits only direct earcon media filenames as public static assets. Chromium
playback was verified; physical-speaker output, iPhone Safari behavior,
deployment completion, and shared-router activation remain unverified.

In browser automation at phone width, opening a new chat, selecting keyboard
entry, and sending `/fakestream 3 300 12` produced this client diagnostic:

`[audio] operation=unlock play() rejected NotSupportedError: Failed to load because no supported source was found.`

The send and scroll checks completed. Audio playback was not tested, so the
user-visible impact remains unknown. The scroll fix changes no audio code.
Investigate whether unlock is playing an invalid source or reporting an
expected unsupported automation environment as an actionable warning.

## Resolution and verification (2026-10-05)

The original phone-width chat send reproduced the exact warning. Its media
request targeted `/<worktree>/earcons/silence.mp3` and returned HTTP 401.
The file is valid MP3 audio. The router treated `earcons` as a box slug
because its public frontend asset classifier omitted the directory.

The fix admits GET requests only for direct lowercase, digit, or hyphen
earcon filenames ending in `.mp3` or `.wav`. Nested API/auth routes, encoded
separators, directory roots, and write requests retain the box credential
gate. This matters because `earcons` can also be a configured box slug,
and Vite proxies per-box API/auth routes before static lookup. Playback
diagnostics and rejection behavior are unchanged.

An isolated TCP router used the real revised auth gate and dispatcher,
with a fake lifecycle that proxied to this worktree's existing Vite server.
The shared router was not restarted. In a real Chromium browser at 390×844,
opening a fresh chat, choosing keyboard entry, and sending
`/fakestream 3 300 12` produced no audio warning. The real unlock audio
element emitted `loadedmetadata`, `playing`, and `ended`, with duration and
final current time both 1 second and no media error. The normal
`recordingStart.play()` earcon also completed with those events and no error.

Uncredentialed browser fetches returned 200 `audio/mpeg` for the silence
and recording-start media. Nested earcon API/auth paths and a real box API
path returned 401. The focused classifier and auth regression suite passed
31 tests, including hypothetical box-slug collisions and encoded paths.
Scoped ESLint checks passed.

This verifies Chromium decoding and playback events, not physical-speaker
output or iPhone Safari gesture behavior. No iOS runtime code changed.
The existing security report already describes shared earcons as public
frontend assets containing no box data; this bounded exception requires no
change to that assertion.

The broader pre-existing static-prefix classification mismatch is tracked
in [the separate router issue](2026-10-05-router-static-asset-prefix-admits-box-routes.md).
