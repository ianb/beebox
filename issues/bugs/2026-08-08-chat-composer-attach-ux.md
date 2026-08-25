---
title: "Chat composer attach UX: literal [file1] token, twin attach items, image-only placeholder"
workstream: integration-tests
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activity 1)
labels: [soft-launch, field-test-findings, ui-error, ui-sensibility]
priority: important
---

> **Partly resolved 2026-08-09.** Item 1's display half: the `[fileN]` token
> is load-bearing on send (it anchors the attachment inline, resolved through
> the hidden `<attachments>` block — `chat-assemble.ts`), but the *sent*
> message no longer shows it: `stripUserDisplayTags` strips exactly the
> tokens the block declares (user-typed lookalikes stay; doctested in
> `test/frontend/chat/message-parsing.doctest.md`). Item 3: placeholder is
> now "Type a message..." (both composer variants). Remaining, still open:
> the token is still visible **in the composer while typing** (a plain
> textarea can't render it as a chip — needs a rich composer or a different
> anchoring design), and item 2's two-affordance menu is working-as-designed
> but needs the labeling/merge decision ("attach to this message" vs
> "bulk-upload into the box"; the gate is `sessionId === null`).
>
> **Run-2 evidence (2026-08-09) — the bulk-upload panel needs its own item:**
> the operator's files landed in the *composer* while the open Upload-files
> panel kept saying "No files yet / 0 uploaded / 0 failed / 0 pending" —
> twice — discovered only by hitting Cancel batch and finding two chips
> behind the dialog. "Attach file…" gave no visible feedback at all when
> clicked. Partly harness mechanics (agent-browser hands files to the page
> rather than the OS picker, and later couldn't find any file input at all —
> "Element not found", which also failed the upload-photos check), but "the
> panel reported nothing received while the file went elsewhere" is real UX:
> the panel should reflect files however they arrive, or the two intake
> paths should not be simultaneously live on one page.
Three related composer problems, seen on a first-ever file attach in chat:

1. **The `[file1]` token leaks.** Choosing "+" → "Attach file…" inserts the
   literal text `[file1]` into the message box, cursor after it. A new user
   does not know whether to delete it, and it renders in the sent message
   afterwards, looking like a typo. If the token is load-bearing for the
   message format, hide it from the visible composer/sent rendering; if not,
   drop it.

2. **"Attach file…" vs "Upload files… (send a message first)".** The "+" menu
   shows both, the second greyed out. A user cannot tell what the difference
   is or why sending a message first would enable uploading. The operator
   picked the enabled one only because it was "the only door that was open."
   Either merge the two affordances or label them by what they do (e.g. attach
   to this message vs bulk-upload into the box).

3. **Placeholder says "Type or paste an image…"** while the composer's main
   use is typing text. It briefly convinced the operator the box only took
   pictures.

All three are on the first surface a new user touches (the empty-box chat), so
they punch above their weight for onboarding.

## Re-checked 2026-08-25

Item 2 is **resolved** and was not recorded here: the two menu entries were
merged into one "Add files…" routed in code (`5336b291`, `f8095747`,
`worktree-add-files-menu`), closing
[attach-vs-upload-menu-confusing](../closed/features/2026-08-03-attach-vs-upload-menu-confusing.md).
The labeling/merge decision this issue was waiting on has therefore been made.

What is left is narrower than the header suggests:

- Item 1's remaining half — the `[fileN]` token is still visible in the
  composer while typing. Unchanged; it needs a rich composer or a different
  anchoring design, not a label fix.
- The run-2 bulk-upload panel observation (the panel reporting "No files yet"
  while the files landed in the composer). The menu merge removes the *choice*
  between two intake paths but not the two paths themselves, so whether this
  still reproduces is unverified.
