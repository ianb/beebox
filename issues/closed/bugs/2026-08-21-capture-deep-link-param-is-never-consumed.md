---
title: "The /capture deep link leaves ?capture=1 in the URL, so capture mode comes back after you close it"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — following the /capture deep link into chat
resolution: implemented
---

`/<box>/capture` redirects to the chat with `?capture=1`
(`beebox/src/frontend/src/pages/capture/CapturePage.tsx:15`). `ChatPage`
reads the param on every render
(`beebox/src/frontend/src/pages/ChatPage.tsx:132`) and passes it as
`openCaptureOnMount`; `InteractiveChat` seeds its `captureMode` state from it
(`components/chat/InteractiveChat.tsx:184`).

The param is never removed. "Exit capture" only flips local state
(`InteractiveChat.tsx:336`, `onExitCapture={() => setCaptureMode(false)}`), and
both of `ChatPage`'s URL rewrites carry the existing search through unchanged
(`ChatPage.tsx:262-266`, `:271-278`, `search: toSearch({ ...search, session: … })`).

So after the person closes capture, the URL still says the chat is a capture
deep link. Capture mode opens again on the next reload, and on any session
switch — `InteractiveChat` is keyed by session, so switching conversations
remounts it and the state initializer reads the stale param again. The overlay
also creates a capture session each time it mounts.

The code says the opposite of what it does: `CapturePage`'s comment reads
"which ChatPage consumes once", and `InteractiveChat.tsx:183` reads "Seeded from
the `?capture=1` deep link, consumed once".

Observed while checking the chat pages: the capture surface (headings "Capture",
"Start camera", "Exit capture") kept reappearing on the chat page, and the
address bar kept the capture param across navigations.

A second, smaller detail from the same URL: the redirect writes the param
JSON-quoted, so the address bar reads `?capture=%221%22`. That is the router's
round-trip encoding for a string that would otherwise parse as a number, and the
app reads it correctly.
