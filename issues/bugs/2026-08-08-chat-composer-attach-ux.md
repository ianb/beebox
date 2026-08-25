---
title: "Chat composer attach UX: literal [file1] token, twin attach items, image-only placeholder"
workstream: integration-tests
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activity 1)
labels: [soft-launch, field-test-findings, ui-error, ui-sensibility]
priority: important
needs: [manual-testing]
---

> **⏳ Awaiting manual testing** — all three items are settled in code
> (`305c3a2a`); what is left is a look at the real composer. Only the developer
> clears this. See [Manual testing](#manual-testing).
>
> **Resolved 2026-08-25** (worktree-composer-intake).
>
> **Item 2** — the twin menu entries were merged into one "Add files…" in
> `5336b291` / `f8095747`; routing decides inline-vs-batch from the file set
> (`file-routing.ts`), so the user never sees the two paths. That also retires
> the run-2 observation about the bulk-upload panel reporting "No files yet"
> while files landed in the composer: the overlay can no longer be open and
> empty, because one selection act has exactly one destination and the overlay
> only ever opens already seeded.
>
> **Item 3** — placeholder is "Type a message…" in both composer variants.
>
> **Item 1** — the token is now `[image#1]` / `[file#2]` / `[selection#3]`, and
> it **stays inline and stays visible in the composer by design** (boxholder,
> 2026-08-25): the `#` makes it easier to pick out of a sentence and edit
> around, and anchoring the attachment where the user put it is worth the
> literal token. The sent message still hides it (`stripUserDisplayTags`). So
> the rich-composer / re-anchoring question this was holding open is **not**
> being pursued; the grammar's statement of record is
> `callback-box/src/shared/composer-tokens.ts`.

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

## Manual testing

In the chat composer:

1. **Attach a photo** (paste, drop, or Add files…). The composer should show
   `[image#1]` — with the `#` — where the caret was, and a thumbnail chip
   labelled `image#1`.
2. **Send it.** The sent bubble should show the photo and the prose, and **no**
   `[image#1]` anywhere in the text.
3. **Scroll back to an older message that had an attachment** (anything from
   before 2026-08-25). It should still render the same way — no bare `[image1]`
   appearing in an old bubble. This is the half that a reader narrowed to the
   new form would break, and it cannot be seen from the new messages alone.
4. **Open the "+" menu.** One file entry, "Add files…", with no greyed-out twin.
