# Chat review

A nightly pass that reads chat sessions which have grown since it last looked,
and writes back to each session's husk card: a **title**, a one-sentence
**`contains`**, and a running **account** of what the conversation amounted to
(`contains-evidence`).

Design rationale and the measurements behind the thresholds:
[docs/implemented-plans/chat-review.md](implemented-plans/chat-review.md).

## Running it

```bash
cb chat review status            # how many sessions have enough new material
cb chat review run --dry-run     # which ones, and how much is new
cb chat review run               # do it
```

Boxes get a `chat-review` scheduled script (nightly at 04:00, `lockGroup: retro`)
installed by `cb init` at
`config/schedules/chat-review.scheduled-script.card`, shipping **disabled**.

To turn it on for a box, set `enabled: true` on that card. `enabled` is a
box-owned field, so the setting survives template updates rather than being
re-flipped by the next sync.

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

Discovery keeps nothing it parsed: a qualified session is scalars (id, paths,
span size, bootstrap reason), and the transcript window is re-read inside the
per-session review step, after the `--max-sessions` cap. Holding every qualified
session's parsed transcript at once is the allocation pattern that OOM'd
`cb serve`. The quiet-for-30-minutes check is therefore re-run at review time
too, against the file as it stands then.

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
rather than replaying its history span by span. So for a session that was already
long when the feature arrived, the account starts out missing the middle — a
deliberate trade, since recovering it would cost a dozen-plus model calls per
session for history that predates the feature. Every later span is a nightly
increment far below the cap, so this affects backfill quality only, not ongoing
accuracy.

## Titles hold back; everything else doesn't

The one editorial constraint applies to the **title**, and it is narrower than it
sounds.

Titles appear in lists, and lists get read in contexts the conversation never
anticipated — a shared screen, someone reading over your shoulder, a screenshot.
So the test the reviewer is given is **not** "is this private?" but **"would the
boxholder wince if someone nearby read this?"**

That distinction matters, because the obvious reading — strip names, strip
figures, strip places — is wrong. Those are exactly what makes a title findable
again, and removing them costs real value while protecting nothing anyone cared
about. `Road trip to Keene, July 8-11` and `Indigo's custodial account paperwork`
are good titles.

What the reviewer is told to avoid is the wince: health problems, money trouble,
conflict with a named person, anything intimate, anything that reflects badly on
someone or reveals a judgement about them. When a conversation genuinely is about
one of those, it names the *shape* rather than the *sting* — enough to find it
again, not enough to embarrass anyone reading it cold. Most conversations need
none of this and just get a clear specific title.

**`contains` and `contains-evidence` get no such treatment.** They are the durable
record of a conversation whose transcript expires on a retention timer, so they
should be as explicit and specific as they need to be — names, amounts, decisions,
the actual property, the actual question. Anything left out is lost once the
transcript goes.

Separately from any of that, a title is a human-readable label rather than a data
dump — no email addresses, URLs, ids or long numbers. Not because those are
sensitive, but because they read as noise in a list and crowd out the words that
help you recognise the conversation. That's a titling-quality rule, and it lives
in the prompt alongside the length and case guidance.

The leak scan rejects exactly one thing, in any field: a **credential** shape.
That is secret hygiene, not editorial judgement — an API key in a git-tracked card
is a problem regardless of who reads it. Emails, addresses and names are not
rejected. Nothing mechanical can detect a title that embarrasses, so that
judgement lives in the prompt rather than half in a filter catching the wrong
things — and your ability to retitle a husk by hand is the real backstop.

## Editing what it writes

**A title you set by hand wins permanently.** The pass hashes the title it
writes; if the husk's title no longer matches, it records the field as `manual`
and never touches it again. This is re-derived every pass, from the card as it
is at write time, so an edit made *during* a run is honoured too.

An edit made before the session was ever reviewed is also honoured — with one
discriminator worth knowing. At first review there is no hash yet, and the husk
may already carry the first-message snippet that `ensureChatHusk` wrote at
session start. That snippet is reproducible, so it is recognized and replaced;
any *other* title on the card is treated as yours and left alone.

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
