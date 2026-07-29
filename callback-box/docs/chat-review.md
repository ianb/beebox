# Chat review

A nightly pass that reads chat sessions which have grown since it last looked,
and writes back to each session's husk card: a **title**, a one-sentence
**`contains`**, and a running **account** of what the conversation amounted to
(`contains-evidence`).

Design rationale and the measurements behind the thresholds:
[docs/plans/chat-review.md](plans/chat-review.md).

## Running it

```bash
cb chat review status            # how many sessions have enough new material
cb chat review run --dry-run     # which ones, and how much is new
cb chat review run               # do it
```

Boxes get a `chat-review` scheduled script (nightly, 04:00) installed by
`cb init`, shipping **disabled**. Turning it on is a per-box decision — the pass
writes generated prose onto git-tracked cards that get pushed off the machine.
Flip `enabled: true` in `config/schedules/chat-review.scheduled-script.card`.

## What qualifies

Discovery is husk-first: `store/chat/web/*.chat.card` *is* the corpus, so a
session with no husk is out of scope and a deleted husk is an editorial removal.
A session qualifies when it is:

- quiet for 30 minutes (don't summarize a conversation still happening),
- at least 2 real user turns, and
- its **unread span** renders to at least 6,000 characters.

That last number is deliberately untuned — its job is to keep a nightly model
call off trivial growth. Across a 775-transcript sample, any threshold between
4k and 8k selects essentially the same ~5% of sessions.

## Incremental by necessity

The pass sends the model only the **new span**, plus the account it wrote last
time, and asks it to extend that account.

This is not an optimization. `renderSessionCompact` elides the middle of any
transcript over 40,000 characters, and 73% of review-eligible sessions are
already past that — so re-summarizing from scratch would silently drop the middle
of the conversation, and would drop more of it every night.

The **span journal** (`.callback-box/chat-review/state.json`) records the uuid of
the last entry folded in plus a hash of everything before it. Identity rather
than position, because transcripts are SDK-owned and do get rewritten
(auto-compaction, `--resume` forks); a bare index would silently shift under a
rewrite that kept the entry count. When the boundary is gone or the prefix hash
no longer matches, the pass re-reads from the top and **keeps the existing
account** — it is now the only record of what the rewrite destroyed.

The first review of an already-long session reads it whole (elided if huge),
rather than replaying its history span by span. That bootstrap pass is lossy in
the middle for very long pre-existing sessions; every later span is a nightly
increment, far below the cap.

## Titles are written for a semi-public audience

Session lists surface where the conversation never does — a shared screen, a
screenshot, someone glancing over. And the exposure is asymmetric: the transcript
lives outside the box and is never pushed, while the title lands on a git-tracked
card and goes to the box's remote, where it stays in history even if edited
later.

So the reviewer is told to name the *subject and shape* of a conversation rather
than its contents, to name a category at most for anything private, and to never
include other people's names, amounts, diagnoses, addresses, or identifiers —
while still being distinctive enough to find the conversation again.

`title`, `contains` and the account are all run through the publication
[leak scan](../src/publish/leak-scan.ts) before they are written; a field
carrying an email address, credential shape, or home path is dropped and
reported. That catches mechanical leaks only. A title that accurately names a
private topic passes every regex there is — the prompt, the husk card view, and
your ability to edit are the real controls.

## Editing what it writes

**A title you set by hand wins permanently.** The pass hashes the title it
writes; if the husk's title no longer matches, it records the field as `manual`
and never touches it again. This is checked every pass, so an edit made before
the session was ever reviewed is honoured too.

`contains` and `contains-evidence` are machine-owned and rewritten each pass —
though a correction propagates forward rather than being reverted, since the
current account is what the model receives as input. `review-span` is
bookkeeping; leave it alone.

Both `contains` and `contains-evidence` render on the husk card page, so what
the pass wrote is visible without opening the file.

## `contains-evidence`

An optional **global** card field — available on every card type, like `contains`
itself — holding the accumulated detail a card's one-sentence `contains` was
derived from. Chat review is its first consumer; most cards never set it.

It is deliberately *not* embedded or searched. The semantic-search cutoff was
fitted against one-sentence `contains` text, and admitting a long accumulating
field would change both the corpus and the score distribution that validation
rests on. It is backing detail, not a retrieval surface.
