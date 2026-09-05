---
title: "Dormant boxes: sleep after no human activity, and encrypt what sleeps"
workstream: unknown
area: beebox
needs: [design, decision]
labels: [security, soft-launch, lifecycle]
priority: backlog
---

The interesting case for encryption at rest is **deep storage** — someone
forgets about a box. After some period with no *human* activity (a week? a
month?) the box goes to sleep. Waking it takes a deliberate human recovery
step, and **that step is also where the decryption key comes from.**

This is the shape that makes at-rest encryption actually mean something here.

## Why dormancy resolves the tension

A live box can't be meaningfully encrypted against its own host: the agent
exists to read the cards, search them, and act on them, so the running system
needs plaintext continuously. Any scheme where the server holds the key while
the box is live protects against a stolen disk and nothing else.

**A dormant box has nothing running.** No agent, no scheduler, no connectors.
That is the one state where the server genuinely does not need the key — so it
can be encrypted with something the machine doesn't hold, and the human supplies
it on wake. Same act, two purposes: recovery *is* the key ceremony.

## Opt-in, per box — and opt-in is where the questions get answered

**Decided: this is opt-in.** No box sleeps because a default said so. That
matters more than it sounds, because it turns most of the hard questions from
policy the system must guess into **choices made once, in a flow, by someone
who is paying attention**:

- the threshold for *this* box (a week, a month, longer)
- what the key is and where it goes — the opt-in is the natural moment to
  generate one and make the human take custody of it, with the "if you lose
  this, the box is gone" warning where they'll actually read it
- who holds it for a shared box
- how they want to be warned before sleep, and through what channel

Design the opt-in as the ceremony, not as a checkbox. It's the one moment when
the person is thinking about this box's dormancy on purpose, and every later
moment (the warning, the sleep, the wake) is easier if this one did its job.

One honest consequence: because it's opt-in, the storage benefit below only
materializes for boxes that opted in. It can't be counted on as a fleet-wide
answer to disk pressure.

## What exists today

- **A first tier already works.** The hub idle-stops a box's `bbx serve` child
  after inactivity (minutes), lazily restarting on request. So "boxes stop when
  unused" is an established pattern — this proposes a second, much longer tier
  with teeth.
- **Credentials are already hashed at rest** (`docs/security-report.md` §2:
  invite/reset capabilities and mobile device tokens, SHA-256, 0600, atomic +
  locked). Not what this is about.
- **Nothing covers box content** — cards, git history, transcripts, annexed
  media, `events.db`/`usage.db`, connector caches.
- **No dormancy/archive concept exists anywhere.**

## The prerequisite nobody has built

**There is no signal for "when did a human last touch this box."** A search for
one finds nothing. Everything here depends on it, and it has to be *human*
activity specifically:

- Agent runs, scheduler ticks, connector syncs, and wakeups must **not** count.
  A box with enabled schedules generates activity forever — key it off "activity"
  and no box ever sleeps.
- Plausible human signals: a chat message sent, a web session, a capture or
  upload, a mobile pairing use. Worth deciding explicitly rather than inferring
  from request logs, which the scheduler also touches.

Define this first. Everything else is downstream of it.

## What sleeping actually does — and its cost

Sleeping is not just encrypting. It stops the box *working*:

- **Schedules stop.** No chat review, no retrospectives, no map refreshes.
- **Connectors stop pulling.** Email, calendar, and RSS stop accumulating —
  which is a *feature* for a forgotten box (it stops growing unattended) but
  means a wake may face a large backlog.
- **Notifications stop**, so the box can't tell you it wants attention.

That last one makes the warning path load-bearing: a box must announce that it's
about to sleep, while it can still reach you. A forgotten box becoming an
*inaccessible* box with no warning is worse than a forgotten box.

## The hard part: key custody

This is the same problem as
[the backup story](../decisions/2026-08-07-server-backup-story.md), and it
should be decided with it:

- If the server discards the key at sleep, **losing it means losing the box.**
- Recovery has to be designed *before* the encryption, not after — including
  what happens when the human has the box but not the key.
- What about a box the boxholder shares with someone else? Whose key?

## A second benefit worth pricing in

Prod hit **100% of a 75 GB volume** on 2026-08-04. Dormant boxes are also
excellent candidates for compression and off-host archival — so this earns its
keep on storage pressure even before the security argument.

## Open questions

Answered at opt-in (see above), so they need a *flow*, not a policy: the
threshold, key generation and custody, who holds it for a shared box, and the
warning channel.

Genuinely open, and not the opt-in's job:

- Does dormancy apply to local boxes too, or only the deployed server?
- Does `git-annex` change the media picture (content-addressed blobs, and
  `numcopies: 1` today)?
- Is there content deserving stronger treatment even while live — connector
  credentials on disk, `~/.beebox-auth.json`, `.env` — where the
  agent-needs-plaintext argument doesn't apply?
- What does a *partial* wake look like, if anything: can the boxholder see that
  a box exists, and its metadata, without the key? A dormant box that's
  invisible is easy to forget twice.

## Related

- [server backup story](../decisions/2026-08-07-server-backup-story.md) —
  decide together; a dormant encrypted box is also the ideal backup unit.
- [Cloudflare Flexible SSL leaves edge-to-origin plaintext](../bugs/2026-08-07-cloudflare-flexible-ssl-origin-plaintext.md)
  — encryption *in transit*, live today, and a strictly larger exposure than a
  powered-down disk. Worth fixing first.
