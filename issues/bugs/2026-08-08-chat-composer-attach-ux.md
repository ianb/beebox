---
title: "Chat composer attach UX: literal [file1] token, twin attach items, image-only placeholder"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activity 1)
labels: [soft-launch, field-test-findings, ui-error, ui-sensibility]
---

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
