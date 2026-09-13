---
title: "A composer draft can splice itself into the middle of another message"
workstream: unattached
resolution: implemented
area: beebox
filed-by: agent
discovered-in: worktree-user-stories-refresh — a journey walkthrough landed in an old chat and read it
priority: normal
---

## Closed 2026-09-13 — the mechanism is guarded, not argued about

Boxholder: "I haven't seen this as much, I think it's been fixed with other
changes." Checking that read: the *route* probably did close — the send/clear
path around the composer was reworked since the sighting (`d1556e750` "close the
send-path holes an adversarial review found", `af42d07ec`, `1a74113ae`), none of
it naming this issue. But the *hole* had not been touched: `editor.setText()` was
the only programmatic text write and nothing anywhere reset the textarea caret
after it — no `setSelectionRange`, no `selectionStart =` in the input or hooks
directories. So the suspect was still structurally present and the question was
only whether anything could still reach it.

Rather than settle that by frequency, the mechanism is now guarded.
`useComposerCaret` (`src/frontend/src/components/chat/composer-caret.ts`) puts
the caret at the end of the text whenever the text changed for a reason other
than the person's own keystroke — a restored draft, a clear after send, token
normalization. A keystroke's own change is left alone, because the one typing is
the only one who knows where they want the caret. Both composer rows (desktop and
mobile) use it. The decision is a pure function, `caretAfterTextChange`, so it is
covered without a DOM (`test/frontend/composer-caret.doctest.md`).

One detail supports the reworked-route reading: the restore aborts unless the
composer is empty, and an empty composer cannot have a caret at offset 11. So the
splice needed an offset left stale by an *earlier* value — someone typed, the
value was replaced programmatically while focused, and the next text landed at the
old offset. That is a send/clear interaction, which is what got reworked.

Verified in a real browser (`/main/test1/chat`), not only in unit tests:

- Ordinary mid-text editing is unaffected: caret placed at offset 10 of
  `does the draft survive a reload?`, typed `XY`, and it landed at 10 with the
  caret advancing to 12 — the guard does not fight the typist.
- After a reload restored the draft, the caret sat at the end of the restored
  text (34 of 34) rather than at a stale offset.

This also covers the variant the issue asked about at the end — whether the same
path could DROP text as well as insert it. A stale selection can be a *range*,
in which case the next keystroke replaces what it spans; collapsing to the end
removes that too.

The "drafts are not per chat" half of the original report was always separate and
was not in question here. The degenerate 136-byte PNG noted under "Also in that
turn" is untouched by this and, if it still matters, wants its own issue.

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

**Kept open 2026-09-13.** Reviewed alongside the WebP issue when the boxholder
said to close the unreproducible ones. This one is a different shape and should
not go with it: the corrupted turn is real and still on disk — one `<typed>`
wrapper with a whole other message inside it — so a send did mangle a person's
text. What was disproved is the stated *mechanism*, not the event, and the note
above leaves a specific live suspect (a DOM caret surviving a programmatic value
replacement). Closing it would discard a genuine data-corruption sighting with a
named place to look. What it needs is a reproduction attempt at that suspect —
restore landing while the composer is focused — not a disposition.

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
