---
title: "Chat audio unlock reports an unsupported-source warning in Chromium"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-scroll-fixes — real chat send verification
---

In browser automation at phone width, opening a new chat, selecting keyboard
entry, and sending `/fakestream 3 300 12` produced this client diagnostic:

`[audio] operation=unlock play() rejected NotSupportedError: Failed to load because no supported source was found.`

The send and scroll checks completed. Audio playback was not tested, so the
user-visible impact remains unknown. The scroll fix changes no audio code.
Investigate whether unlock is playing an invalid source or reporting an
expected unsupported automation environment as an actionable warning.
