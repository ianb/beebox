---
title: "No way to submit an uploaded file in chat (mobile; file not attached to the message)"
filed-by: agent
discovered-in: main session — boxholder hit it on mobile
area: callback-box
resolution: implemented
---

Closed by commit 7ad11496 (worktree-chat-attachment-submit). Classified as
a **mobile-only affordance gap**, not a regression: the attach→send plumbing
worked everywhere, but the mobile button bar has no textarea or send button
(those live in typing mode), so the inserted `[fileN]` token and the send
affordance were invisible. Fixed at the surface level — a token-producing
insert now opens the typing row — plus two adjacent gaps found on the way:
voice sends (stop-and-send, keyword send) silently dropped pending
attachments, and assembly now notes a file whose placemarker token is
missing from the text at the end of the message.

On mobile (desktop untested), uploading a file in chat has **no way to actually
submit it** — the file doesn't appear to get attached to the message being sent.
You pick/upload a file but can't get it to go out with a message.

Unconfirmed whether this is **mobile-only** or a **general regression** in the
attach-and-send flow — needs a desktop check to disambiguate. If desktop works,
it's a mobile-specific input/submit gap (touch target, the send button not wired
to the pending attachment, virtual-keyboard interaction, or the file input not
producing a pending attachment on mobile). If desktop is also broken, it's a
regression in the attach→send path generally.

**Repro:** on mobile, open a chat, attach/upload a file, try to send it with a
message. Expected: the message sends with the file attached. Actual: no way to
submit the upload / the file isn't attached.

**Where to look:** the chat attachment flow —
`src/frontend/src/components/chat/ChatAttachments.tsx`,
`InteractiveChat-attachments.ts`, `InteractiveChat-selections.ts`, and the send
path in `InteractiveChat.tsx` (does a pending attachment reach the send call, and
is the submit affordance reachable/enabled on mobile?). Cross-check the upload
route / `/chat/send` handling of attachments.

**First step:** reproduce on desktop to classify mobile-only vs regression, then
trace whether a pending attachment is created on file pick and whether it's
included in the outgoing message payload.
