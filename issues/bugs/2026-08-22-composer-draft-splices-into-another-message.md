---
title: "A composer draft can splice itself into the middle of another message"
workstream: unattached
area: callback-box
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

The likely mechanism is draft restoration inserting at the caret rather than
replacing, combined with drafts not being scoped per chat. That second half was
observed independently during the same catalog run and dismissed as not-a-defect
("the composer draft is not scoped per chat — it follows you into a new
session"). This is the same behaviour with teeth: it does not merely follow you,
it can land inside a message you are part-way through writing, and the result is
committed to history.

Both messages read like deliberate manual testing — one is literally a test of
whether a draft survives — so this was probably produced while exercising draft
persistence, which is where it would show up.

Worth knowing before trusting the fix: whether the insertion point is the caret
or an index into a stale value, and whether the same path can drop text as well
as insert it.

## Also in that turn

The same message carries an image block whose base64 payload is 136 bytes — a
degenerate PNG. It renders as an attachment you can click and zoom into and then
see nothing. A first-time user hit exactly that and recorded it as "a thing I
didn't attach, that I can't see". Possibly the same root cause, possibly its own;
noted here rather than split off until someone knows which.
