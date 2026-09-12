---
name: bbx-issue-actions
description: Use to triage or resolve issue next-action tags (discuss, reconfirm, duplicate, invalid, fixed, manually-confirmed, verify-without-me), including released manual-testing gates. Use bbx-pick-issues to choose new work.
---

# Working `next-action:` tags

`next-action:` says what must happen next before an issue leaves the queue. `discuss`
routes an issue to the developer; `manually-confirmed` records a completed human
check; the other values are **provisional agent tasks** where
someone suspects an outcome and is asking the next agent to check it.

**The developer writes these tags — effectively all of them.** The field is how they hand
an idea back: they read the queue, form a suspicion about an item, and leave it
here for whoever picks it up next. So working this queue is answering them, not
processing a backlog, and every tag carries the context of the moment they had the
whole queue in view. Your output goes back to them in the same channel — the note
you leave on an issue is what they read next time.

The whole discipline for the provisional values is in one line of
`issues/CLAUDE.md`:

> A matching tag is not permission to close blindly.

Read every provisional value with the question mark the UI shows — **"fixed?"**,
**"reconfirm?"**. Nothing there is asserted. It is what the developer thinks is *likely*
and wants confirmed properly. `discuss` is different: do not investigate toward
implementation or make the decision yourself. Surface the issue to the developer and
record the disposition that comes out of the discussion.

For the provisional values, your job is to **produce evidence**, then act on
what the evidence says — which is often the opposite of what the tag guesses.
For `discuss`, your job is only to frame and surface the discussion.

Second rule, equally load-bearing:

> Remove the field after acting on it or disproving it.

A stale `next-action:` re-invites the same work forever. Every issue you touch
leaves with the field gone.

## Finding the work

`bin/issues` (see `bin/CLAUDE.md`) replaces the ad-hoc grep loops this section
used to carry. Everything tagged, with the tag and title:

```bash
bin/issues list --next-action discuss --next-action reconfirm --next-action duplicate \
  --next-action invalid --next-action fixed --next-action manually-confirmed \
  --next-action verify-without-me
```

One value only, and the same as JSON for scripting:

```bash
bin/issues list --next-action reconfirm
bin/issues list --next-action fixed --json
```

Cross-reference with priority, since a tagged `important` issue is worth doing
first: add `--priority important`. To see whether a `fixed?`/`duplicate?` guess
holds, `bin/issues similar <path> --all` lists the closed siblings that may
already own the work, and `bin/issues show <path>` prints the frontmatter and
body head.

## What each value asks of you

**`discuss` — bring this to the developer before doing the work.** Summarize the decision
or design tension and the smallest useful set of options. Do not treat this as
permission to implement, and do not silently convert it into research. After
the discussion, remove the field and record the resulting disposition or next
step in the issue.

**`reconfirm` — two questions, in order.** The most common tag, and it is
`fixed` and `invalid` stacked:

1. **Was it explicitly fixed?** Do the `fixed` search below — git history first.
2. **If not obviously fixed, is it still an issue at all?** It may be **moot**:
   the surrounding code changed, the feature moved, the situation that produced
   it no longer exists.

Three outcomes: fixed → close `implemented` naming the commit; moot → close
`wontfix` saying what made it moot; still live → remove the field and record what
you checked, so the next pass starts further along. A flake tagged `reconfirm`
needs a real run, not a reading.

**`duplicate` — does another issue own this work?** Compare *scope*, not titles.
Two issues about the same symptom with different root causes are not duplicates.

**Search `closed/` too.** A duplicate of an already-closed issue means this one
closes as well — the work is done, the item just outlived it.

When it is a duplicate: **merge the details into one issue first**, then close
this one `superseded` with a reference to the survivor. Do the merge before the
move; a duplicate often carries the better reproduction, the sharper `file:line`
pointers, or a second sighting that matters as evidence. Losing that is the real
cost of a careless dedup.

**Ask the developer** when merging looks lossy, or when the merged result would be an
oversized issue covering too much. Two focused issues can beat one sprawling
one, and that is their call rather than yours.

**`invalid` — is this moot?** Mostly the developer asking whether the issue still applies:
it describes a situation, a file, or a behavior that no longer exists. Check
whether the thing it is about is still there at all before assessing the claim.

Two ways an issue can be invalid, and they get different closing notes:

- **Moot** — it was true and the world moved. Say what changed.
- **Never held** — filed on a misread. Say what was actually true, so the same
  misread doesn't get filed again.

Both close `wontfix`. And issues do get filed correctly and *then* misjudged as
invalid, so confirm before closing — the tag is a question.

**`fixed` — is the reported behavior already resolved?** Usually this means:
*the work probably happened, there is evidence in git, and the issue just got
lost.* So **search history first** — the fix commonly landed under a different
description, inside a larger change, or in a workstream that never closed the
item. Commits that named the issue carry an `Issue:` trailer (root
`CLAUDE.md`), so query that first; the `-S` guess is the fallback for
commits that predate the convention or forgot the trailer:

```bash
pnpm commit-provenance --issue <issue basename, no dir, no .md>
git log --oneline -S'<a distinctive symbol or string from the issue>' -- <path>
git log --oneline --since='<issue date>' -- <the file the issue names>
```

Then confirm the behavior rather than trusting a commit that reads like the fix.
Close with `resolution: implemented` naming the resolving commit.

**`manually-confirmed` — the developer confirmed the fix.** This value is an
assertion, not a question and not a request to repeat the manual test. Read the
issue once to make sure the confirmation covers the whole item, then close it
as `implemented`. When it carries `needs: [manual-testing]`, this tag is the
developer's explicit permission to clear that gate as part of closing it.

## Verification bar

Each provisional tag is a hypothesis from someone with less context than you
now have. Match the evidence to the claim:

- **Behavioral claims need a run.** Reproduce, or drive the app (`browse` skill,
  `bin/browse`). Reading the diff is not verification.
- **Flakes need repetition.** One green run does not clear a flake — see the
  tracked-flake protocol in `.claude/agents/finish.md`.
- **Anything needing a real device, a phone, live credentials, or a human eye is
  not yours to confirm.** That is what `needs: [manual-testing]` exists for, and
  **only the developer clears it.**

**`needs: [manual-testing]` plus `fixed` or `reconfirm` → check in with the developer.**
Don't resolve those alone and don't silently skip them. The two tags together
mean the code side is believed done while the confirming evidence is the kind
only they can produce, so the useful move is to bring them the specific question:
what you verified, what remains unverifiable from here, and the smallest thing
they could do to settle it. Narrowing a written multi-step protocol down to one
action is often the whole contribution.

**`verify-without-me` is their answer when that gate will never close.** It means:
they can't reproduce the failure on demand, or the test isn't worth their time — so
stop waiting and settle the issue on evidence reachable without them.

Do the deepest audit you can, then dispose of it:

- **Close it** when code, tests, and a simulator carry the claim, naming what
  stays unverified and why that's acceptable.
- **Keep it open, drop `manual-testing`** when they don't, recording exactly
  what ships unchecked. "Unverified, and here is the residual risk" is a real
  outcome and beats an item parked forever.

Two things to get right, both learned from the audit that produced this value:

- **It is not an instruction to close.** An audit can find work that was never
  *built* — that is a live issue needing implementation, not a missing test.
  Leave it open for the work and say so plainly.
- **Separate "impossible without a device" from "nobody ran it."** Real camera
  hardware and an iCloud-backed asset are the first; a landscape screenshot pass
  a simulator could drive is the second, and the second is often fixable right
  here. Collapsing them lets buildable work hide behind a device excuse.

Name concrete residual failure modes, not a disclaimer — "the camera
acquisition call has no automated coverage, so a crash there reaches users
first" is useful; "not fully tested" is not.

When you cannot settle it, that is a legitimate outcome. Remove the field, write
what you checked and what would settle it, and move on. An issue that has been
investigated twice with no note is worse than one nobody touched.

## Closing mechanics

Follow `issues/CLAUDE.md`. In short: `git mv` to `closed/<category>/`, add
`resolution:`, add a closing note at the top of the body naming the resolving
commit or reason, then:

```bash
pnpm --dir beebox doc-check --fix
```

which repairs inbound links by basename. Commit the move and the link repairs
together.

## Fixing in place

Some of these are small enough to just fix — that is the point of surfacing them
as agent tasks. This never applies to `discuss`, regardless of blast radius.
For the provisional values, judge by blast radius, not by category:

- **Fix inline** when it is contained and verifiable here (a lint fix, a wrong
  string, a one-file bug with a test).
- **Spin up a worktree session** (`launch-worktree-session` skill) when it
  touches a deployed path, spans surfaces, needs a device, or wants a plan.

Working from the main checkout: a commit touching `beebox/` **deploys**.
Know that before you commit, not after.

## Reporting back

Group by outcome, not by issue order — closed, still live, could not settle,
escalated. For each closed one, name the evidence. For each still-live one, say
what you checked, so the next pass starts further along than you did.
