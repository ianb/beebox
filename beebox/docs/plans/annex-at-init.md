---
title: "Fresh boxes are annex-shaped, and asset writers refuse the manifest scheme"
status: partial
workstream: full-embrace-annex
issues:
  - ../../../issues/closed/bugs/2026-09-04-scan-import-gitignore-blocks-attach-staging.md
  - ../../../issues/closed/bugs/2026-09-14-card-submission-asset-bytes-silently-unstaged.md
  - ../../../issues/closed/code-quality/2026-08-18-retire-remaining-asset-manifest-writers.md
---
# Fresh boxes are annex-shaped, and asset writers refuse the manifest scheme

> **Boxholder decision, 2026-09-14 — read this before the body.** *"I want every
> box currently and forever in the future to use annex. So we should just be
> making it right, always, and not worry about cases where it isn't right."* And:
> *"We might need to spin up a full-embrace-annex workstream, but you could file
> issues and just behave as though it's implemented already in this
> workstream."*
>
> This changes the plan's shape and its owner. **Owner:** a full-embrace-annex
> workstream, not `scan-ingest` — hence `workstream: unattached` above; the
> session that picks this up attaches it. Tracking issue:
> `issues/features/2026-09-14-every-box-uses-git-annex.md`.
>
> **What the decision deletes from the body below:**
> - Track 2's *graceful* refusals. Under annex-always a manifest-scheme box is a
>   broken invariant, not a supported state, so the asset writers get
>   `invariant()` (per `code-style.md`: *"A seemingly-impossible state (a broken
>   invariant) gets a hard failure, not a fallback"*), not a polite message
>   naming `bbx attachments to-annex`. Cheaper than four hand-written refusals
>   and more honest.
> - The dual-scheme branch in `writeBoxGitignore` (`src/core/box/index.ts:245-283`)
>   and the `annexed` probe that feeds it (`:136`). One block, unconditional.
> - *NOT in scope*'s first two entries. Deleting the manifest scheme and
>   converting existing boxes are now **in** scope — this plan absorbs
>   `issues/code-quality/2026-08-18-retire-remaining-asset-manifest-writers.md`
>   rather than being its prerequisite.
> - The fixture-default flip's dual-spelling transition (*Agent-flow* GAP).
>   `makeTmpBox` becomes annex-always with no `annex` option, and the
>   fabricate-vs-real-binary question in *Failure modes* gets decided rather
>   than hedged: if git-annex is mandatory everywhere, the fixture can require
>   the binary and the fidelity gap closes.
>
> **What the decision adds:** a conversion for existing manifest-scheme boxes,
> and an ordering constraint — `to-annex` reads manifests to verify a
> conversion, so the scheme cannot be deleted until every box is converted.
> That makes this two changes, not one.
>
> The budget below is therefore stale and must be re-set by the owning
> workstream before implementation. The body is kept because its citations,
> failure modes, and the reasoning behind each seam are all still accurate —
> only the accommodation half is dropped.
>
> **Re-set by `full-embrace-annex`, 2026-09-14 — three corrections from
> reading the code and converting the fleet.** See *Budget, re-set* below.
>
> 1. **The init reordering in Track 1 step 2 does not work as written.** It
>    proposes moving `initRepo` above `writeBoxGitignore` inside `initBox`
>    (`src/core/box/index.ts:216-221`). That branch never runs for `bbx init`:
>    `scaffoldBoxRoot` calls `initBox` with `skipGit: true`
>    (`src/core/box/package.ts:284`) and git init happens afterwards in
>    `announceAndInitGit` (`src/cli/commands/init.ts:32-47`). The reorder would
>    have changed nothing and the probe would still have read false. The annex
>    step belongs in `announceAndInitGit`, and re-writes the `.gitignore` that
>    the probe got wrong. **Implemented.**
> 2. **`to-annex` cannot convert a zero-asset box at all.** Its conversion
>    commit has nothing to commit, so `git commit` exits 1. The plan declined
>    to call `convertBoxToAnnex` from init because its verification steps are
>    trivial on an empty box; the real reason is stronger. Filed as
>    `issues/bugs/2026-09-14-to-annex-fails-on-zero-asset-box.md`.
> 3. **The fleet is already converted, so the conversion track is spent.**
>    Every production box and every local box is annex-shaped, verified with
>    `git check-ignore` against real assets rather than the `.git/annex/`
>    probe. The last manifest-scheme box (`about`) was converted this session.
>
> **Boxholder, 2026-09-14, on re-init and the endpoint:** *"re-init on any
> manifest-box scheme, the manifest stuff should die completely by the end of
> this project."* That settles the plan's open refuse-vs-convert question by
> dissolving it. There is no manifest scheme left to re-init onto, so no
> branch is built to preserve one: `writeBoxGitignore` becomes unconditional,
> the `annexed` probe goes, `GITIGNORE_BLOCK` goes, and the manifest modules
> go. A box that somehow arrives manifest-shaped meets an `invariant()`, which
> is what a broken invariant is for.
>
> **A fourth correction, from the boxholder:** an earlier version of this note
> claimed ~850 fixtures must stay manifest-shaped because a box with no `.git`
> cannot be annexed. A box with no `.git` is not a thing. `--skip-git` has no
> caller in `bin/`, `deploy/`, or anywhere else, and `deploy/add-box.sh:311`
> deliberately does not pass it (*"no --skip-git here, that commit is what..."*).
> A no-git `makeTmpBox` is a fixture speed optimization, not a modelled box
> state, and only six no-git fixtures touch the asset seam at all. So
> `makeTmpBox` CAN be annex-always exactly as the decision assumed; the cost is
> suite time, not feasibility.

`bbx init` always produces a manifest-scheme box, and four asset writers cannot
write to one. So a brand-new box cannot take a scan, a photo import, a Gmail
attachment, or a card submission — the first of those fails loudly with a
`git add` error and the images stranded on disk, and the last loses the bytes
with no error at all. This plan makes `git annex init` part of creating a box,
and makes the writers that cannot honour the manifest scheme say so instead of
failing at `git add`.

**Issues addressed:**
`issues/bugs/2026-09-04-scan-import-gitignore-blocks-attach-staging.md` (the
filed bug, reconfirmed 2026-09-13);
`issues/bugs/2026-09-14-card-submission-asset-bytes-silently-unstaged.md` (same
seam, silent shape, filed while researching this);
`issues/code-quality/2026-08-18-retire-remaining-asset-manifest-writers.md`
— not resolved by this plan, but this plan is the box-side prerequisite its own
closing note names: *"The honest sequence is: settle capture, or make new boxes
annex-shaped at creation, and only then delete."* Grepped the queue for
`annex`, `manifest`, `gitignore`, and `scan-import`; those three are the
related set.

## Smallest fix and budget

**Smallest fix (~25 lines source, ~40 test).** Option C alone: gate
`runPhotoMode`/`scan-import` and `pdf-extract` on `isAnnexBox` before they write
anything, mirroring `src/core/scan/promote.ts:238-247` verbatim. That converts a
`git add` error plus stranded images into a stated refusal naming
`bbx attachments to-annex`. It does not make a fresh box able to scan — the
refusal is what every fresh box would hit — so it fixes the *shape* of the
failure, not the failure.

**This plan's budget, re-set 2026-09-14.** One subproject (`beebox/`). The
pre-decision budget was two tracks at ~180 source / ~200 test; the decision
added a conversion and a deletion, and removed the accommodation half.

| | source | tests |
|---|---|---|
| Creation annexes + binary preflight | ~110 | ~90 |
| Gitignore collapse + `--skip-git` removal | ~40 | ~50 |
| Asset writers take `invariant()` | ~50 | ~120 |
| Delete the manifest scheme + `to-annex` | ~80 churn, **~−1400 deleted** | **~−450** |
| Fixture flip + declaration sweep | ~60 | measured by the spike |
| **Total added** | **~340** | **~260 + fallout** |

Roughly 2× the pre-decision number, and net *negative* source once the scheme
deletion lands. The honest figure carries one unknown, deliberately: the
fixture flip's fallout is measured rather than estimated (see below), because
the population is far larger than the plan's "~50 mechanical deletions"
assumed.

**The fixture population, counted.** 1290 `makeTmpBox(` call sites; 438 pass
`git: true`; only 44 declare `annex: true`. Real `git annex init` measures at
~0.33s, so annexing every git box adds ~145s of serial suite time and
annexing all 1290 would add ~7 minutes.

That cost is the only real question, because feasibility is not one: a no-git
tmp box is a fixture speed optimization rather than a modelled box state, and
only six of the no-git fixtures touch the asset seam. The deletion surface it
buys is large — `asset-manifest.ts` (141), `asset-manifest-scan.ts` (290), and
the manifest halves of `attachments-gitignore.ts`, `attachments.ts`,
`to-annex.ts`, `write-cards.ts`, and `prepare.ts`.

Docs and the fixture-declaration sweep are reported separately, not counted
against the budget: `docs/assets.md`, `docs/box-layout.md`, install docs, and
the removal of ~50 now-redundant `annex: true` fixture declarations across nine
doctest files (mechanical deletions, no logic).

This is ~7× the smallest fix, which the circuit breaker says goes to the
boxholder as a choice rather than being written past. **It was put to them on
2026-09-14 as options C, D, A, and plan-only; they chose "D+C: annex-by-default",
the option whose description named the binary preflight and the hard-dependency
cost.** That is the authorization for the budget above. Recorded here because
the breaker measures against this number, not against the ask.

## Stated preferences this plan trades against

**Principle 4 — resilient AND never silent** (`docs/engineering-principles.md:49`):
*"Degradation is allowed for failures that can genuinely happen; invisible
degradation is not."* This is the principle the whole plan serves. The card
submission path is invisible degradation in its purest form — bytes written,
nothing staged, exit 0 — and the scan path degrades to a state the user cannot
act on. The same principle is the argument against Option B (force-staging):
it would commit raw asset bytes into history silently whenever the blob is
under the 1 MB threshold that `findStagedUnlistedBinaries` checks.

**Principle 8 — one way to do each thing** (`:95`): *"Competing idioms are drift
generators… Consolidate over blast-radius fear."* Two asset-tracking schemes is
the competing idiom, and `docs/implemented-plans/asset-manifests.md` opens with
**"Status: SUPERSEDED by git-annex"**. This plan's trade is deliberate: it
removes the manifest scheme from the *creation* path and from four writers, but
does **not** delete the scheme, because unconverted boxes still read their
manifests and `to-annex` still needs them. So it reduces the number of branches
over the ignore-block seam rather than eliminating them.

**The trade against principle 6 — right-sized defensiveness** (`:75`): making
`git annex init` part of box creation turns a soft dependency into a hard one.
`src/core/install-validation-hooks.ts:226-235` exits 1 on every commit once
`.git/annex/` exists and the binary is absent, with the comment *"Once annexed,
a missing binary is fatal — committing without the clean filter puts asset bytes
straight into history."* That is correct behaviour and must not be weakened; the
plan's answer is a preflight that refuses before the box exists (Track 1,
chunk 1), not a softer hook.

**Against `bbx-plan`'s "no features beyond the task":** this plan changes box
creation, which the filed bug did not ask about. The justification is in *Could
this be simpler?* — Option C alone is a dead end on exactly the box most likely
to scan.

## What already exists

**Reuse — the annex-shape probe.** `isAnnexBox` (`src/core/annex/is-annex-box.ts:127-131`)
reads two independent facts: `.git/annex/` at the repo root
(`isAnnexInitialized`, `:104-118`) and a box `.gitignore` that no longer hides
assets (`gitignoreIgnoresAssets`, `src/core/commands/attachments-gitignore.ts`).
This is the correct probe and the plan adds no new one.

**Reuse — the refusal pattern.** `src/core/scan/promote.ts:230-247` is the
gate Track 2 mirrors, including its reasoning for re-probing every pass rather
than caching. Verbatim at `:238-241`:

```
  if (!(await isAnnexBox(boxRoot))) {
    console.error(
      `[scan] Box ${boxRoot} is not annex-converted; skipping the promote pass. ` +
        "Quarantined files stay put until it is converted (`bbx attachments to-annex`).",
```

The routes refuse the same condition with a retryable 503
(`src/webapp/routes/scan-upload.ts:249-263`, documented at
`docs/scan-upload-contract.md:71-78`). Track 2 is making the CLI agree with two
layers that already refuse — not inventing a policy.

**Reuse — the gitignore writer's branch.** `writeBoxGitignore`
(`src/core/box/index.ts:245-283`) already selects `UNIGNORE_BLOCK` or
`GITIGNORE_BLOCK` from an `{ annexed }` flag, and `scaffoldBoxRoot` already
probes for it (`:136`). Track 1 does not add a branch; it changes what the probe
finds on a fresh init.

**Reuse — the conversion.** `convertBoxToAnnex` (`src/core/annex/to-annex.ts:293`)
does the full migration. On a brand-new empty box every one of its verification
steps is trivial (zero assets, zero manifests), so Track 1 does **not** call it
— a fresh box needs `git annex init` plus the un-ignore block, which is the
tail of what `to-annex` does, and reusing the whole migration would drag a
clean-tree requirement and a disk preflight onto a directory that has neither
assets nor a commit yet. This is the one rebuild, and that is its reason.

**Rebuild — the binary preflight.** `runAnnexDoctor`'s check 1
(`src/core/annex/doctor.ts:268-280`) returns `failed` when the binary is absent,
and `bbx init` currently only `console.warn`s that and continues
(`src/cli/commands/init.ts:202-209`). Track 1 needs a *refusal before any
scaffolding*, which is a different call site and a different severity, not a
reuse of the doctor's report-only contract.

**Searched and found nothing:** no function anywhere takes an asset path and
stages it the way the box tracks assets. `SessionBuilder.writeChildCard`
(`src/core/capture/write-cards.ts:58-82`) is the closest — it writes bytes,
writes a manifest, and stages manifest-and-card-but-never-bytes — but it is
hardcoded to the manifest scheme and capture-shaped. That absence is why four
writers each got this wrong independently, and it is the finding that makes
Track 2 a set of gates rather than a shared helper.

**The manifest scheme has no claim hook any more.** The installed pre-commit
hook (`src/core/install-validation-hooks.ts:210-260`) runs only
`git annex pre-commit` (gated on `.git/annex/`) and `bbx validate --pre-commit`.
`scanBoxAttachments` — the claim/verify walk — runs only from
`to-annex.ts:307`, `commands/attachments.ts:169` (`verify`), and `:206`
(`migrate`). So `docs/implemented-plans/asset-manifests.md`'s design
("writers… trust the hook to claim them") is no longer true, and Option A would
write a record that nothing verifies at commit time.

## Prior art (external)

One external premise matters: whether `git annex init` on an empty repository is
safe to make unconditional. `to-annex.ts:367` already calls it on real boxes and
`docs/assets.md` documents the resulting shape, so the premise is established
*inside* this repo and does not need an external search. The one external fact
worth stating is that git-annex must be installed to be initialized and there is
no pure-git fallback — which is exactly why the preflight is chunk 1 rather than
a later refinement.

No external search was run on git-annex packaging per platform. That is a
deliberate gap and it is the *Open design question* below: what the preflight
tells a user on a platform where the install line we print is wrong.

## Tracks / scope

### Track 1 — `bbx init` produces an annex box

**What.** Creating a box runs `git annex init` and writes the un-ignore block,
so `isAnnexBox` is true from the box's first commit. `bbx init` refuses up front
if the git-annex binary is absent.

**Why this needs to change.** `runInit` never annexes
(`src/cli/commands/init.ts:79-88`), and the doctor is explicitly forbidden from
doing it (`src/core/annex/doctor.ts:290-300`: *"that is a perfectly correct
state — not a defect to repair"*). So every box starts on a scheme that four
writers cannot write to. Note also the ordering that makes this invisible:
`scaffoldBoxRoot` probes for annex at `src/core/box/index.ts:136` but does not
`initRepo` until `:216-221` — on a fresh init there is no `.git` yet when the
probe runs, so `annexed` is necessarily `false` and the manifest block is the
only outcome a fresh box can get.

**Direction.**

1. A preflight in `runInit`, before `detectBoxTarget` has any effect on disk:

   ```ts
   /** Refuses before anything is created: a box is annex-shaped from its first
    * commit, and the pre-commit hook exits 1 on every commit if the binary is
    * missing (install-validation-hooks.ts:226-235). Failing here is the one
    * moment the user can act on it. */
   export async function requireGitAnnex(annex: GitAnnexService): Promise<void>
   ```

   Throws a `BbxError` naming the install line. Reuses `annex.version()`
   (`src/services/git-annex.ts`), the same probe the doctor's check 1 uses.

2. `scaffoldBoxRoot` gains an explicit annex step on the fresh path. The repo
   must exist before `git annex init`, so the `initRepo` call at `:216-221`
   moves **above** the `writeBoxGitignore` call at `:202`, with `git annex init`
   between them, and the `annexed` probe at `:136` then reads true. The probe
   stays — it is what keeps a re-init from de-annexing a converted box, the
   regression its own comment at `:126-135` records.

3. `runAnnexDoctor` check 2 (`doctor.ts:290-300`) keeps reporting a
   manifest-scheme box as `ok` and still must not convert it — an existing
   unconverted box remains valid. Its message changes from *"Migrate with
   `bbx attachments to-annex`"* to say this is a pre-2026-09 box, so the text
   does not read as advice for a box that should never have been in that state.
   Its stale LFS reasoning (*"Every unmigrated box uses LFS"*) is wrong today —
   LFS is retired per `src/core/box/index.ts:186-196` — and gets corrected.

**Vocabulary lock-ins.** None new. "Annex-shaped" and "manifest scheme" are the
existing terms (`is-annex-box.ts`, `docs/assets.md`) and this plan does not add
a third.

**First implementation chunk.** `requireGitAnnex` plus its call in `runInit`,
with a doctest asserting init refuses and creates nothing when the probe reports
no binary. No open questions: the probe, the error type, and the message are all
named above.

### Track 2 — asset writers refuse the manifest scheme

**What.** The four writers that cannot honour the manifest scheme gate on
`isAnnexBox` before writing, mirroring `promote.ts:238-247`.

**Why this needs to change.** Track 1 fixes new boxes; it does nothing for a box
created before it ships. The determining factor in how each writer fails today
is pathspec shape, documented at `src/lib/git.ts:249-253`: naming an ignored
*file* makes `git add` exit non-zero, naming a *directory* silently skips its
ignored contents.

| Writer | Today |
|---|---|
| scan-import photo flow (`src/core/commands/scan-import-cards.ts:101,107,176,206` → `scan-import.ts:313`) | throws at `git add`, images already on disk and ignored |
| scan-import PDF (`src/core/commands/scan-import-pdf.ts:120-156`) | same |
| Gmail attachments (`src/connectors/gmail-threads.ts:135-142` → `connectors/gmail.ts:175-186`) | same |
| card submissions (`src/core/cards/accept-submission.ts:195-199`, which stages `[cardRel, batchDirRel]` — the batch *directory*) | **silent** — directory pathspec, bytes lost, exit 0 |

**Direction.** A gate per entry point, each placed before any bytes are written.
For scan-import that means before `src/core/commands/scan-import.ts:210-218`
creates `.scan-archive` and copies the originals in — today the working copy is
created and then removed before staging, so a gate placed later would still
leave the user's images half-processed. The message follows `promote.ts`'s:
what is refused, why, and `bbx attachments to-annex`.

`pdf-reanalyze.ts` gets the same gate: it stages removed `page-NNN.avif` names
(`:151`) and has the same failure.

**Vocabulary lock-ins.** None. Each gate is a local refusal; no shared helper is
introduced, because the four call sites differ in what they must clean up and a
premature helper would have to take a cleanup callback. If a fifth appears, that
is the moment to extract one.

**First implementation chunk.** The two scan-import gates and their doctests —
the filed bug's own reproduction, run on a `makeTmpBox({ git: true })` box.

## Could this be simpler?

**The simplest version is Track 2 alone (option C, ~25 lines).** It is smaller,
it needs no change to box creation, it imposes no new install dependency, and it
fixes what the bug report describes: an unactionable failure with stranded
bytes.

**It fails on the box most likely to scan.** `bbx init` always produces a
manifest box, so Track 2 alone means a fresh box refuses every scan, and the
remedy it names — `bbx attachments to-annex` — needs the git-annex binary the
user may not have and which nothing tells them to install. That is a refusal
with no path out of it, which fails principle 4's *"Degradation is allowed for
failures that can genuinely happen"* test in the other direction: the
degradation would be permanent and universal rather than a real failure being
reported.

**What the second track buys, and what it does not.** Track 1 is what makes
Track 2's refusal unreachable for a box a boxholder just created. It is not
bought for elegance: `issues/code-quality/2026-08-18-retire-remaining-asset-manifest-writers.md`
independently reached the same conclusion, and the manifest scheme is marked
superseded. What this plan still does **not** do is delete the manifest scheme —
that stays, because unconverted boxes read it.

**A simpler Track 1 was considered and rejected:** call `convertBoxToAnnex` from
`bbx init`. Rejected because it requires a clean tree (`to-annex.ts:303`) and
runs a disk preflight (`:337`) against a box that has no assets and no commit
yet. Two steps of it are what a fresh box needs.

## Subplans

None. Neither track needs its own design step: Track 1's shape is fixed by the
existing probe and gitignore writer, and Track 2 mirrors a shipped gate.

## Failure modes

> **Critical gap:** card submissions
> (`src/core/cards/accept-submission.ts:195-199`) lose asset bytes *today*
> with no test, no handling, and no output. That is the pre-existing gap this
> plan closes; it is listed here because until Track 2 lands it is live.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| git-annex absent when `bbx init` runs | no — Track 1 chunk 1 adds it | no — plan adds `requireGitAnnex` | clear (refuses, names install) |
| git-annex absent *after* a box is annexed (uninstalled later, or a second machine clones the box) | no | yes — `install-validation-hooks.ts:226-235` exits 1 with the install line | clear, but at *every commit*, not just asset commits |
| `git annex init` fails midway on a fresh init (disk, permissions) | no — Track 1 adds one | partial — `scaffoldBoxRoot`'s marker cleanup at `src/core/box/index.ts:120-124` is fresh-init-retry-safe, but does not un-annex | unclear: box exists, `.git/annex/` may exist, gitignore state depends on where it threw |
| a re-init on a converted box de-annexes it | yes — the regression the probe comment records (`index.ts:126-135`) | yes — the repo-level probe at `:136` | clear (this plan keeps the probe) |
| asset write on a pre-existing manifest box after Track 2 | no — Track 2 adds them | no — plan adds gates | clear (refusal names `to-annex`) |
| the ignore block is spelled a way `isAssetIgnoreRule` does not match | yes — added by `c47fd2be1` | yes, since `c47fd2be1` | **silent when it fails** — three checks over this seam all failed open at once |
| doctest fixtures claim annex shape without it | n/a | no — `test/helpers/annex-box.ts:22` fabricates `.git/annex/` | silent: fixtures prove the ignore block does not block, not that bytes annex |

The last row is the one this plan must not make worse. `makeBoxAnnexShaped`
fabricates `.git/annex/objects/` deliberately and says so
(`test/helpers/annex-box.ts:1-15`). Flipping `makeTmpBox`'s default to
annex-shaped (Track 1's fixture change) would mean *every* box doctest runs on a
fabricated annex that real `bbx init` no longer produces — widening exactly the
fidelity gap that let this bug hide, since the original `makeTmpBox` "never ran
the real init" is what the filed issue names as the reason it went unnoticed.
Handling: the fixture default flips, **and** Track 1 adds one doctest that runs
the real `bbx init` with the real binary, skip-if-absent, in the style of
`test/core/annex/to-annex.doctest.md:24,40`. Without that one real-binary test
the plan would ship a fixture claiming a shape nothing verifies.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — n/a: no new vocabulary, no new fields.
- **Stale ref** — ADDRESSED: `promote.ts:230-237` already documents why the
  annex probe is re-read per pass rather than cached ("a box can be de-annexed
  while the server runs"), and Track 2's gates follow it.
- **Two agents touching the same card** — n/a: the gates are read-only probes
  before any write; they add no lock and take no lock.
- **Hand-edit drift** — ADDRESSED, and it is the reason `isAnnexBox` reads two
  facts rather than one: a hand-edited `.gitignore` that re-ignores assets makes
  the box read as manifest-scheme, and after Track 2 the writers refuse rather
  than lose bytes. Previously that state lost bytes silently on the submission
  path.
- **Fabricated free-form value** — n/a: no free-form value is introduced.
- **Validation error UX** — ADDRESSED: each refusal names the box, the
  condition, and `bbx attachments to-annex`, matching `promote.ts:239-241`. The
  message an *agent* sees on a box it cannot convert itself is the reason the
  text must name the command rather than say "not supported".
- **Partial migration / transition state** — ADDRESSED for boxes (a
  manifest-scheme box stays valid and its writers refuse) and **GAP for
  fixtures**: between Track 1's fixture-default flip and the removal of the ~50
  `annex: true` declarations, both spellings mean the same thing. Mechanically
  harmless, briefly confusing; the sweep is in *Implementation order* rather
  than left open.

## NOT in scope

- **Deleting the manifest scheme** — `asset-manifest.ts`, `attachments migrate`,
  and `to-annex`'s manifest reads all stay. Unconverted boxes still hold
  manifests, and `to-annex` reads them to verify a conversion. That deletion is
  `issues/code-quality/2026-08-18-retire-remaining-asset-manifest-writers.md`'s
  job, and this plan is its prerequisite, not its execution.
- **Converting existing manifest boxes** — no migration ships here. Every
  production box is already annex-shaped (per that issue's 2026-09-06 note), so
  there is no fleet to convert; local scratch and fixture boxes are the
  population, and Track 2's refusal is the correct treatment for them.
- **Making `bbx init` install git-annex** — considered and rejected: a box tool
  that installs system packages is a much larger blast radius than a refusal
  that names the command.
- **A shared "write an asset the way this box tracks assets" helper** — the
  absence is a real finding (*What already exists*), but four call sites that
  each refuse need no helper, and building one now would fix the shape of a
  problem this plan removes.
- **`findStagedUnlistedBinaries`'s message on a non-annex box** — it says "run
  `bbx doctor annex`", which is wrong advice for a box with no annex
  (`src/core/annex/staged-unlisted.ts:169-178`). Reachable only via option B,
  which this plan does not take. Left alone; worth a separate issue if it is
  ever reachable another way.
- **git-annex in deploy/provisioning docs** — Track 1 makes the binary
  mandatory, and grepping every `.md`/`.sh`/`Dockerfile` finds git-annex only in
  tests, `bin/lib/worktree-create.sh:354,367`, and a failure-mode table in
  `docs/assets.md`. The install-docs addition ships with this plan (reported
  separately from the budget); a full provisioning review does not.

## Open design questions

**What does the preflight tell a user whose platform we guessed wrong?** The
doctor prints *"apt install git-annex / brew install git-annex"*
(`doctor.ts:275-277`) and the pre-commit hook prints the same pair
(`install-validation-hooks.ts:231-233`). My lean is to reuse that exact string
rather than invent a third spelling — principle 8 — and to accept that it is
wrong on other platforms, since it is already the message two shipped surfaces
print. Raising it because Track 1 makes it the first thing a new user sees,
which is a different weight than a doctor note.

**Should `bbx init --skip-git` skip the annex step too?** RESOLVED by
deleting the flag (boxholder, 2026-09-14: *"should we remove --skip-git? Seems
icky, not something we should support"*). The question assumed a box with no
repo is a state worth supporting; it is not one anything produces. The flag had
no caller in `bin/`, `deploy/`, or the codebase, and `deploy/add-box.sh:311`
deliberately avoided it. `initBox`'s internal `skipGit` parameter stays — it is
real plumbing for callers that initialize git themselves immediately after.

## Knowledge audits

One new agent-facing fact: an agent on a manifest-scheme box now gets a refusal
naming `bbx attachments to-annex` where it previously got a `git add` error.
That is a message, not a concept — no new tag, card shape, or convention — so
the `knows_directly` entry to add is whether a box agent, told a scan import
refused, knows the box needs converting rather than retrying. Filter id
`annex-refusal-actionable`, to be added to
`beebox/src/dev/knowledge-audits.yaml` and **run** against a scratch box (not
`test1`, and with an absolute `--box` path) before this plan ships; a never-run
audit is unverified in both directions.

## What will hold this after it ships

**The decision is the risky part, and it is already a pure function.**
`isAnnexBox(boxRoot)` is two file reads and no I/O beyond them, so every gate
Track 2 adds is reachable from the doctest tier with a `makeTmpBox` fixture —
no heavier tier, and no new tier.

- **`test/core/commands/scan-import-photo-flow.doctest.md`** — the manifest-path
  regression test the filed issue lacks. It is the only doctest driving
  `runPhotoMode` end to end and already owns every helper it needs
  (`seedPages`/`importPhotos` at `:25-40`, `sessionDir`/`sessionFiles` at
  `:42-50`). The fixture line is `makeTmpBox({ git: true })` — omitting `annex`
  *is* the manifest scheme. Asserts the refusal and that no bytes were written.
- **`test/core/commands/pdf-extract.doctest.md`** — same for the PDF path.
- **`test/core/cards/accept-submission`** — the silent case. This one must
  assert on the filesystem (bytes neither committed nor manifest-listed), not on
  a return value, because the bug is that the return value is success.
- **A real-binary init doctest**, skip-if-absent, in the style of
  `test/core/annex/to-annex.doctest.md:24,40-52`. Named here because without it
  the fixture-default flip leaves the annex shape asserted only by a fabrication
  (see *Failure modes*).
- **`test/core/annex/doctor.doctest.md`** — its check-2 assertions carry the
  prose this plan corrects.

**Mock trap:** none added. Every test above uses a real temp box and the real
functions; the one fabrication (`makeBoxAnnexShaped`) predates this plan and is
the thing the real-binary test exists to cover.

**Stale prose found while planning**, worth fixing with the doc sweep:
`test/core/bulk-upload/prepare.doctest.md:58-62` claims its tier "runs on a
plain git box" while `:65` declares `annex: true`.

## Implementation order

Re-ordered 2026-09-14 against the code. The one substantive change from the
original sequence: the writer `invariant()`s move to AFTER the gitignore
collapse. An invariant is a claim that a state is unreachable, and while two
schemes still exist the state is reachable by design — so asserting it first
would be asserting something untrue.

1. **`requireGitAnnex` + `bbx init` refuses without the binary** — the
   dependency has to be enforced before anything starts relying on it. **Done**
   (`21b137dd2`).
2. **Box creation annexes** — `git annex init` in `announceAndInitGit` (NOT a
   reorder inside `initBox`; see the correction at the top), plus the
   real-binary init doctest. **Done** (`21b137dd2`).
3. **Spike: flip the fixture default, run the suite, count the fallout.**
   **Done.** Baseline 10487/10487 green. Annex-always produced 3 genuine
   assertion failures and 20 teardown errors, the latter all one cause: annex
   marks objects read-only, so `rm` fails with `EACCES`. Suite time 259s ->
   439s. The fallout was far smaller than either the plan's "~50 mechanical
   deletions" or this session's own "~850 fixtures" estimate — the cost is
   wall-clock time, not code.
4. **Gitignore branch collapses.** `writeBoxGitignore` writes
   `UNIGNORE_BLOCK` unconditionally; the `annexed` probe and `GITIGNORE_BLOCK`
   are deleted. This is the step that carries the real risk — see below.
5. **Remove `--skip-git`.** It has no caller, and it is the only thing that
   could still produce a box the annex step skips.
6. **Asset writers take `invariant()`.**
7. **Delete the manifest scheme, `bbx attachments to-annex` included**
   (boxholder, 2026-09-14: *"yes, to-annex should go too!"*). The issue's
   ordering constraint — `to-annex` reads manifests to verify a conversion, so
   the scheme cannot be deleted until every box is converted — is already
   satisfied: the fleet was converted and verified first.

   **`to-annex` is not a standalone deletion.** Three shipped surfaces name it
   as the remedy for a manifest-scheme box, and each stops being true the
   moment the command is gone:

   - `src/core/annex/doctor.ts:300` — *"Migrate with `bbx attachments
     to-annex`."*
   - `src/core/scan/promote.ts:241` — the quarantine-skip message.
   - `src/webapp/routes/scan-upload.ts:258` — a retryable `503` whose meaning
     is written into `docs/scan-upload-contract.md:69-76`, a **wire contract
     shared with the standalone scan-uploader** and versioned by
     `SCAN_CONTRACT_VERSION` (currently 1).

   So the deletion must land together with step 6's `invariant()`s, which
   replace "convert it with X" with a hard failure that names no remedy
   because none is needed. The scan-upload 503 is the one that reaches outside
   this repo: its documented condition (*"a box that has not been converted to
   git-annex"*) becomes unreachable, and whether removing a documented 503
   condition needs a `SCAN_CONTRACT_VERSION` bump is a question for the
   scan-uploader's bump rules rather than an assumption to make here.
8. **Doctor check 2 prose + the retired-LFS correction.**

**The riskiest step is 4, not the init change.** `writeBoxGitignore` runs on
EVERY init, including a re-init of an existing box (`deploy/add-box.sh` runs
it twice to provision one box). An unconditional `UNIGNORE_BLOCK` on a box
that is still manifest-scheme un-ignores its asset bytes without moving them
into the annex, and the next autocommit puts raw bytes into git history —
silently, exit 0. That is the `c47fd2be1` failure class pointed the other way.

The fleet being converted is what makes this safe to do rather than something
to guard against, and it is why the conversion came first this session. The
residual case is a box arriving from outside the fleet. That meets the
`invariant()` from step 6 — a hard failure, not a fallback — which is the
whole point of deleting the scheme rather than accommodating it.
9. **Docs: DONE.** `docs/assets.md` rewritten; historical docs that describe
   the manifest scheme carry a per-document warning naming what is misleading
   in each; `developer-install.md` lists git-annex as a prerequisite.
   `docs/box-layout.md` needed nothing — its "manifest" mentions are the
   session, publish, and search manifests, not the asset scheme.

   The install sweep turned up a real gap: neither
   `deploy/hetzner/setup-server.sh` nor the Docker image installed git-annex,
   which is now a hard dependency. Production had it only from a hand-run
   `apt install` during the 2026-08 conversion, so a server rebuild would have
   produced a machine unable to commit to any box. Both fixed.
10. **Knowledge audit** `annex-refusal-actionable`, authored and run.

## Rollout shape

**Tests first, per `docs/testing.md`.** Each chunk above names its doctest
before its source change; chunks 4 and 5 start from the filed issues'
reproductions, which both already exist in prose and neither of which has a
test today.

**Done-when:** the two manifest-path doctests fail before chunks 4–5 and pass
after; the real-binary init doctest passes with git-annex present and skips
without it; `pnpm test` in `beebox/` is green after chunk 6's sweep; the
knowledge audit is run with its status recorded.

**Migration approach: none, deliberately.** No on-disk data shape changes. New
boxes get the new shape at creation; existing boxes keep theirs and their asset
writers refuse. There is no gradual state to be caught mid-rollout because no
existing box is rewritten — which is what makes this plan shippable in one piece
rather than as a migration with a midpoint.

**Cross-model review** before this is declared done, per root guidance: it is
well past a small-scope bug fix, and the reviewer must be the other model family.
