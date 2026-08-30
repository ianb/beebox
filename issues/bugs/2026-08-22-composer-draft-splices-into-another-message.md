---
title: "A composer draft can splice itself into the middle of another message"
workstream: unattached
area: beebox
filed-by: agent
discovered-in: worktree-user-stories-refresh — a journey walkthrough landed in an old chat and read it
---

A stored user turn in `test1` contains this text:

```
 draft survIn 2 minutes, remind me to stretch. Just set the reminder, nothing else.ives?</typed>
```

Two messages, one inside the other. Someone was typing `…does the draft survives?`
and the text `In 2 minutes, remind me to stretch. Just set the reminder, nothing
else.` was inserted between `surv` and `ives?` — at a caret position, mid-word.

**It is stored that way, not rendered that way.** The splice is in the transcript
on disk (`d860a9f2-…jsonl`, the session behind
`store/courses/Acids_Bases.attach`), so it was written, not assembled at display
time.

> **The stated mechanism is wrong — checked against the code 2026-08-25**
> (worktree-composer-intake). Draft restoration does not insert at the caret. It
> calls `editor.setText(p.text)` — a whole replace — and only into an already
> empty store, with a commit-time recheck that *aborts* the restore if the user
> typed during the file-existence round trip
> (`hooks/useEmissionPersistence.ts`). Nor does anything else in the composer
> insert arbitrary text at a caret: `insertTokensAtCursor`
> (`InteractiveChat-attachments.ts`) is the only caret-aware writer and it only
> ever writes a `[image#N]`-shaped token; every voice path *appends*
> (`setInput((existing) => existing + " " + text)`).
>
> **The record was read, and it is a genuine user turn.** Line 4 of the
> transcript, not the `last-prompt` bookkeeping copy on line 12 that repeats the
> same string. The whole thing is inside one `<typed>` wrapper — one opening
> tag, one closing tag, the guest message between `surv` and `ives?` — so the
> splice was in the composer's own text at send time, not produced by assembly
> or by display. The composer text was approximately
> `[selection1] [image1] draft survives?`, into which
> `In 2 minutes, remind me to stretch…` was inserted at offset 11 of the visible
> prose. The assistant's reply on line 11 answers the *stretch* request, so the
> guest message is the one the user meant to send and the host is the stale
> draft wrapped around it.
>
> **The surviving suspect** is the textarea's DOM caret outliving a programmatic
> replacement of the store text: React writes the restored value into the
> element, the browser leaves the selection at its old character offset, and the
> next thing typed lands there. That fits an insertion mid-word at a fixed point
> with no caret-aware code involved. It is a suspicion, not a finding — there is
> still no reproduction, and reproducing it needs the restore to land while the
> composer is focused.
>
> The drafts-are-not-per-chat half stands as originally written and is
> unaffected by the above.

Both messages read like deliberate manual testing — one is literally a test of
whether a draft survives — so this was probably produced while exercising draft
persistence, which is where it would show up.

Worth knowing before trusting a fix: whether the insertion point is the DOM
caret or an index into a stale value, and whether the same path can drop text as
well as insert it.

## Also in that turn

The same message carries an image block whose base64 payload is 136 bytes — a
degenerate PNG. It renders as an attachment you can click and zoom into and then
see nothing. A first-time user hit exactly that and recorded it as "a thing I
didn't attach, that I can't see". Possibly the same root cause, possibly its own;
noted here rather than split off until someone knows which.
