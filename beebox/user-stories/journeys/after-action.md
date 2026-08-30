# After-action: turning a walk into findings

A walk produces one person's account of an evening. That account is evidence, not
findings. This is the documented pass that turns it into findings — and it is the
step where most of the value, and nearly all of the risk, lives.

The risk is specific and it has happened every time so far: **a walker attributes to
the product something the harness did.** On 2026-08-24, three of the seven bugs a
walk reported were ours — a 401 from driving with a key that is not the box owner,
"systemic" unreachability that was a missing scroll instruction, and a data leak
between boxes that was stale transcript files. Each was written up in good faith and
each read as a serious product defect. Filing them unexamined would have put three
false bugs in the queue and sent someone chasing them.

So the rule this whole pass exists to enforce:

> **Nothing from a walk becomes a finding until it has been separately verified.**
> The walker's job is to notice. Yours is to find out what actually happened.

## The procedure

### 1. Collect before reading

```
pnpm exec tsx beebox/user-stories/journeys/collect.ts <run-id>
```

Do this first, before the notes colour your reading. It reads the box's own commits
and the screenshot timestamps — an account of the evening that the walker did not
write and cannot have shaded. Where it and the notes disagree, that disagreement is
usually the most interesting thing in the run.

**Timing comes from here, never from the notes.** A walker has no sense of duration
and will say "about twenty minutes" about six.

### 2. Read the notes end to end, without deciding anything

Read the whole thing before judging any of it. The walker's confusions arrive in
order and often resolve themselves three entries later; a claim that looks damning in
isolation is frequently answered on the next screen.

**Harvest from the whole document, not from the complaints.** A walk's failures are
easy to find and are not the only findings in it. The 2026-08-24 report missed
"no way to see all my containers and their counts on one screen" — the walker's
single biggest wish — because it sat under *what I wish I had* rather than under
what went wrong. Read the closing sections with the same attention as the log:

- **what I wish I had** — the feature the product does not have, named by someone
  who wanted it, which is worth more than the same idea proposed internally.
- **what I still do not understand** — vocabulary and model failures, stated as
  questions rather than as complaints.
- **would I keep using this** — where the walker weighs everything at once, and
  the only place you learn which failure was the one that nearly ended the run.
- **what I wanted and could not find** — scattered mid-log, not only at the end.

**Give every claim its own line, and never merge one into a neighbour.** The same
report folded "thrown to a Sign in page mid-session" into the capture 401 because
both looked like auth. They were different mechanisms with different dispositions
— one harness, one a filed product issue — and the merged row hid the second for
a day. Two claims that share a smell are still two claims. Split first; discover
they are one bug later, on evidence, and say so then (findings 5 and 6 of that
same report turned out to be one bug, and that is a finding, not a shortcut).

### 3. Classify every claim before believing any of it

Take each thing the walk reports and put it in one of four buckets. Assume nothing;
go and look.

| Bucket | What it means | How you tell |
|---|---|---|
| **product** | the app really does this | reproduce it, or read the code path and name it |
| **harness** | our tooling did it | the run's own setup, `bin/browse` semantics, prepare's provisioning |
| **environment** | this box is not configured | a health warning from `prepare.ts` — no Deepgram key is not a product finding |
| **unverified** | could not settle it | say so; do not file it as though you did |

The harness bucket is the one that gets skipped, because a harness fault presents as
a product fault and the notes read as a first-hand account. Work through these before
believing any negative result:

- **Was the walk authenticated for what it tried?** The browse key is not the box
  owner. Owner-gated surfaces answer 401 and render controls disabled with no
  explanation. `prepare.ts` reports `captureBlind` when no browse login is saved, and
  `before.json` records it.
- **Did the tool actually do what it said?** A `✗ … refused: <reason>` line is about
  the control's state, not the app's response. `✓ Done` means delivered, not
  effective.
- **Could the walker reach it at all?** An `offscreen` refusal that was never scrolled
  past is a walker limitation.
- **Was the box actually fresh?** Content from a previous run reads exactly like the
  product leaking someone else's data.
- **Do the numbers come from this run?** Timing that aggregates several runs will look
  like the product being slow.

### 4. Investigate what survives

For everything still in the **product** bucket, go find the mechanism. A finding
worth filing names a file and a line, or reproduces. "The app seems to lose images"
is where the work starts, not where it ends — that one turned out to be a session-log
size guard, which changed the fix entirely.

Three habits that repeatedly paid:

- **Read one instance, then check a second.** A count in prose looked like a missing
  schema field until the second record showed the field populated. The finding
  survived; it just became a different, smaller, truer one.
- **Suspect your own diagnosis before the system's behaviour.** If a mechanism you
  have asserted does not reproduce, say so and re-open it.
- **Reproduce before patching, in the cheapest thing that can hold the bug.** The
  duplicate-message bug was settled in seconds by calling one pure function with
  the two shapes it had to reconcile — no browser, no box, no agent. A failing
  check written before the fix is also the regression test afterwards, and it is
  what stops a plausible story being shipped as a diagnosis.

**Check that your check ran.** Twice on 2026-08-24 a verification reported a
difference that was really an artifact of the tool: a raw comparison that was
measuring quote style, then a formatter that could not parse the file at all and
passed it through unchanged. Both looked like findings. Before believing a
verification, confirm it is measuring what you think — run it against a case whose
answer you already know.

### 5. File, and correct what you got wrong

File real findings as issues in the normal way (`issues/CLAUDE.md`). Where a walk's
verbatim words carry something a summary cannot — a user's own vocabulary, their
reaction at the moment it happened — quote them; that is what a walk is for.

If a finding you already filed turns out to be wrong, **fix that issue and say in it
that it was wrong and why.** A queue that quietly loses its mistakes teaches nobody.

### 6. Write the report

One file, `<journey>/reports/<date>.md` — `B-inventory/reports/2026-08-24.md` —
tracked in git. It is the durable record: `work/` is
gitignored, so once a run is pruned the report is what is left of it.

## What the report contains

- **Run** — id, journey, date, box path, and the harness commit it ran against.
- **What the walk achieved** — from `collect.ts`, not from the notes. What landed in
  the box. If the notes claim something the commits do not show, that goes here.
- **Timing** — agent-derived, with the wall clock named as instrument overhead.
- **Findings** — every claim, its bucket, the evidence, and where it went (issue link,
  or why it went nowhere). Include the ones that dissolved; a claim that turned out to
  be harness is a fact about our tooling and belongs in the record.
- **Harness defects** — what this run taught about the instrument, and whether it is
  fixed. Journeys have so far found more about themselves than about the product, and
  that only stops being true if each round's lessons are actually landed.
- **Not verified** — plainly. Anything the run could not reach (an auth-blind walk
  cannot speak about capture), and anything you could not settle.

## Before you call the report done

One pass back over the notes with the finished table beside them, asking only:
**is every claim in there?** Not "is the report good" — that question is too easy
to answer yes to. Walk the notes section by section and tick each claim off against
a row.

Two rows is the right answer more often than one. If you find yourself writing
"and also" inside a row, that is a second finding.

## Then prune

`prepare.ts` prunes a superseded run when the next walk is provisioned: the box and
the screenshots go, the notes stay. It refuses to prune a walk that was never
collected. The report is what makes that safe — write it before the next run, because
afterwards the raw material is thinner.
