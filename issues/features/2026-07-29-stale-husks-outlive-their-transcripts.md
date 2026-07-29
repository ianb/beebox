---
title: "Husks outlive their transcripts, and nothing handles the resulting husk graveyard"
area: callback-box
filed-by: agent
discovered-in: worktree-compacting — eval'ing chat review against real boxes
---

Chat husks are permanent git-tracked cards. Their transcripts are not: Claude
Code prunes `~/.claude/projects/**/*.jsonl` on a retention timer
(`cleanupPeriodDays`, default 30; raised to 60 on this machine 2026-07-29). So
every husk eventually becomes a pointer to nothing, and most already are.

Measured 2026-07-28 across `ai-class`, `ia-review`, `personal`, `box-family`,
`birch` — a sharp cliff, no exceptions either side of it:

| husk age | transcript |
|---|---|
| ≤ 27 days | alive |
| ≥ 28 days | **dead** |

Machine-wide, the oldest surviving transcript of 1,989 was exactly 30 days old —
a retention sweep, not attrition. (Prod confirmed the same on 2026-07-29: no
`~/.claude/settings.json` at all, oldest top-level transcript exactly 30 days
old. Retention has since been raised to 60 days on both, and
`deploy/setup-server.sh` now provisions it.)

This isn't a migration artifact to clean up once. It is the **steady state**, and
nothing in the system acknowledges it.

## "Transcript gone" is ambiguous — two different causes

**Correction to the original measurement.** The "24 of 27 husks dead" figure was
scoped to one laptop, and conflated two unrelated situations:

1. **Expired** — the transcript existed here and was pruned by retention.
2. **Ran elsewhere** — the session happened on another machine and its transcript
   was never here at all. Transcripts don't sync; `~/.claude/projects/**` is
   per-machine, while husks travel with the box through git.

The estate husk was my example of (1) and is actually (2): session `05975df0` has
no transcript on the laptop and a live 1.2 MB one on prod, because that
conversation happened on the server. So an unknown share of those 24 are alive
somewhere else.

Whatever handles stale husks has to tell these apart, because the right response
differs: an expired transcript is gone forever and the husk is all that remains,
while a ran-elsewhere transcript is fine and the husk is merely un-reviewable
*here*. Marking the second as expired would be a lie, and archiving it would hide
a live conversation.

See also [the journal is machine-local](../bugs/2026-07-29-chat-review-journal-is-machine-local.md),
which is the same sync asymmetry biting chat review's correctness rather than its
coverage.

## What's wrong today

A dead husk is not inert — it is actively misleading:

- It still renders as a chat card, still appears in the card tree, still carries
  a `session` field pointing at a session that cannot be resumed.
- Its title is whatever truncated first message `ensureChatHusk` captured at
  creation — e.g. `"eh, delete this"`, `"Alright, so I'm going to be doing a
  longish review here of different chat"`. That is now the *entire* durable
  record of the conversation.
- `loadAllSessions` (`callback-box/src/webapp/trpc/routers/chat.ts`) silently
  skips it, so it's invisible in the picker but present everywhere else — the
  worst of both.
- [Chat review](../../callback-box/docs/chat-review.md) skips it too (correctly —
  there is nothing to read), so it will never be titled or summarized. Its
  content is unrecoverable.

## Why it matters more now

Chat review's whole value proposition is that `contains-evidence` becomes the
surviving record of a conversation once the transcript expires. That only works
for sessions reviewed **inside the retention window**. A session not reviewed
within 60 days is never reviewable — there is no backfill, ever.

So the nightly cadence is load-bearing in a way the design treated as merely
convenient, and the husks that predate chat review are permanently stuck with a
truncated-first-message title and no account.

## Open questions

- **What should a dead husk look like?** Options, none obviously right:
  - Mark it — a `transcript: expired` field or similar — so the card view can say
    "this conversation's transcript has expired; what follows is all that
    remains" instead of offering a dead "Open chat" link.
  - Archive it — `cb mv` to `store/archive/` on detection, keeping it findable
    without cluttering the live chat directory.
  - Delete husks that have neither a transcript nor an account — they carry no
    information at all beyond a session id and a truncated sentence. (Deleting a
    husk that *does* have an account would be destroying the only record.)
- **Who detects it?** Chat review already walks every husk and knows which
  transcripts are missing (`DiscoveryResult.missingTranscripts`). It is the
  natural place, but "the summarizer also archives cards" may be a scope smell.
  A separate `cb chat husks gc`, or a housekeeping step, may be cleaner.
- **Should the husk record the expiry date?** Knowing *when* a transcript went
  away is more useful than knowing it's gone — it bounds what the account covers.
- **Does the `Open chat →` link need to change?** Today it points at a session
  the SDK cannot resume. At minimum that should not look like a live link.

## Related

- [Renamed husks duplicate on backfill](../bugs/2026-07-28-renamed-husk-duplicates-on-backfill.md)
  — the other husk-lifecycle gap found in the same pass.
- `callback-box/docs/chat-review.md` currently explains missing transcripts as
  ordinary stale refs, which undersells this; it should name the retention window
  and the deadline it implies.
