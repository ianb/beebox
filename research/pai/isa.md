# ISA — the Ideal State Artifact

Sources:
- Spec: `$PAI/PAI/DOCUMENTATION/IsaFormat.md` (format spec v2.7, 402 lines)
- Doctrine framing: `$PAI/PAI/ALGORITHM/v6.3.0.md` §"ISA as System of Record"
- Real example: `$PAI/ISA.md` (the project ISA for PAI itself, 231 lines)
- Skill: `$PACKS/ISA/` (six workflows: Scaffold, Interview, CheckCompleteness, Reconcile, Seed, Append)

## What it is, plainly

One markdown file per task (or per project) that is simultaneously the spec, the test
plan, and the work log. The spec's own framing (`IsaFormat.md`):

> **The ISA is one primitive with five identities** (Algorithm v6.0.0+):
>
> 1. **Ideal state articulation** — the written hard-to-vary explanation of "done" (Deutsch sense)
> 2. **Test harness** — ISCs ARE the tests, with named probes; for complex projects the ISCs cover application logic, performance, security, RBAC, build, deploy
> 3. **Build verification** — passing the ISCs verifies what was built
> 4. **Done condition** — task complete when all ISCs pass
> 5. **System of record** — for the thing being articulated (the application, the library, the algorithm itself, etc.)

And the rule against artifact sprawl:

> **Don't invent parallel artifacts.** No `acceptance.yaml`, no `acceptance.ts`, no
> separate test specs. The ISA covers this surface.

The underlying insight is sound: the hardest part of delegating work to an agent is
defining "done," so force the agent to write "done" down as falsifiable claims
*before* working, and verify against that same list after. Everything else in the
spec is elaboration (much of it over-elaboration — see "Where it goes wrong" below).

## The structure

### Frontmatter (machine-read — the only validated structure in all of PAI)

```yaml
---
task: "8 word task description"           # What this work is
slug: YYYYMMDD-HHMMSS_kebab-task          # Unique ID, directory name
effort: standard                          # standard|extended|advanced|deep|comprehensive
effort_source: auto                       # auto|explicit
phase: observe                            # observe|think|plan|build|execute|verify|learn|complete
progress: 0/8                             # checked criteria / total criteria
mode: interactive                         # interactive|loop|optimize
started: 2026-02-24T02:00:00Z
updated: 2026-02-24T02:00:00Z
---
```

A PostToolUse hook (`ISASync.hook.ts`) reads this on every Write/Edit and syncs
`phase`/`progress` to a `work.json` and onward to the Pulse dashboard. Note the
design rationale the spec gives — "**8 fields, not 15**: Only fields consumed by the
sync pipeline. Dead fields waste tokens."

### Body — twelve sections, fixed order

| # | Section | Purpose (spec's own words) | Written at |
|---|---------|---------|------------|
| 1 | `## Problem` | What is broken or missing right now | OBSERVE |
| 2 | `## Vision` | Experiential intent — what euphoric surprise looks like | OBSERVE |
| 3 | `## Out of Scope` | Anti-vision — what is *not* included, declared in prose | OBSERVE |
| 4 | `## Principles` | Substrate-independent truths the work must respect | OBSERVE |
| 5 | `## Constraints` | Immovable architectural mandates | OBSERVE |
| 6 | `## Goal` | Hard-to-vary spine — 1–3 sentences naming verifiable done | OBSERVE |
| 7 | `## Criteria` | Atomic ISCs (one binary tool probe each), including derived `Anti:` | OBSERVE → EXECUTE |
| 8 | `## Test Strategy` | Per-ISC verification (`isc \| type \| check \| threshold \| tool`) | OBSERVE/PLAN |
| 9 | `## Features` | Work breakdown (`name \| satisfies \| depends_on \| parallelizable`) | PLAN |
| 10 | `## Decisions` | Timestamped log including dead ends; `refined:` prefix | any phase |
| 11 | `## Changelog` | Conjecture / refuted-by / learned / criterion-now entries | LEARN |
| 12 | `## Verification` | Evidence per ISC | VERIFY |

Sections are omitted when empty ("Empty sections never appear — Bitter Pill
discipline"). Lower effort tiers require fewer sections (E1 = Goal + Criteria only).

## The heart: ISCs (Ideal State Criteria)

The core formatting rule:

> - Each criterion: 8-12 words, describes an end state (not an action)
> - Binary testable: either true or false, no judgment required
> - **Atomic**: one verifiable thing per criterion — no compound statements

And the **granularity rule**, which is the best single idea in the spec:

> **Granularity rule:** Split until each criterion is one binary tool probe. A
> criterion is granular enough when a single tool call (`Read`, `Grep`, `Bash`,
> `curl`, screenshot, `SELECT`, principal-recognizes-on-encounter for experiential
> ISCs, etc.) returns yes/no on whether it's met. If you cannot name the probe, the
> criterion is not yet atomic — split it.

The spec's worked example of why this matters (quoted in full because it's the
clearest statement of the whole doctrine):

> **Worked example.** Same goal, two ISC framings:
>
> ```
> Goal: ship the H3 onboarding email with paid-tier confirmation.
>
> Fluff:        - [ ] ISC-N: Email is delivered to the user.
>               (Trivially passable — almost any send path satisfies it. You can't
>               name a test that would distinguish "delivered" from "delivered to spam.")
>
> Load-bearing: - [ ] ISC-N: Email arrives in primary inbox (not Promotions/Spam) within 60s.
>               (Names a specific test that would fail; removing it lets a "delivered
>               to spam" outcome pass; goal mutates from "user sees the confirmation"
>               to "Postmark logged a send.")
> ```

Mechanical rules that give the artifact durability:

- **The Splitting Test** — "Contains 'and'/'with'/'including' joining two verifiable
  things? → split. Can part A pass while part B fails independently? → split.
  Contains 'all'/'every'/'complete'? → enumerate what that means."
- **ID-stability** — "ISC IDs never re-number on edit. Splits become `ISC-N.M`
  (parent preserved); drops become tombstones (`- [ ] ISC-N: [DROPPED — see
  Decisions]`)." This is what lets other documents reference criteria safely while
  the spec evolves.
- **Anti-criteria** — `- [ ] ISC-N: Anti: what must NOT happen`, with a doctrinal
  minimum of ≥1 ("a goal with zero failure modes worth naming is under-specified").
- **Living document** — "The ISA is a living explanation. It tightens through
  pursuit. … Log structural Goal changes in `## Decisions` with a `refined:` prefix."
- **Check immediately** — "Check (`- [x]`) immediately when satisfied — don't batch
  at VERIFY," paired with the Algorithm's inline-verification mandate: "No ISC
  criterion may transition `[ ]` → `[x]` without verification evidence captured in
  the same tool call block that claims it, or the immediately-following block."

## Decisions and Changelog — the work-log half

`## Decisions` is a timestamped log with explicit dead-end entries:

> ```markdown
> - 2026-02-24 02:00: Chose X over Y because Z
> - 2026-02-24 02:15: Rejected approach A due to performance concern
> - 2026-02-24 02:30: ❌ DEAD END: Tried B — failed because C (don't retry)
> - 2026-02-24 03:00: refined: Goal sharpened — added "without breaking external API" after research surfaced consumer count
> ```

"Include dead ends — failed approaches prevent future sessions from re-exploring
them." (This is the persistence answer to a real agent problem: a fresh session
happily re-tries the approach the last session abandoned.)

`## Changelog` records when the *spec itself* was wrong, in a mandatory four-part
format ("the Append workflow … refuses partial entries"). A real entry from
`$PAI/ISA.md`:

> - 2026-04-28 | conjectured: Out of Scope and anti-criteria are the same concept at different granularities
>   refuted by: {{PRINCIPAL_NAME}} articulated the distinction directly — Out of Scope is declarative ("we are not building X"), anti-criteria are derived testable probes ("X endpoint returns 404")
>   learned: the three-guardrail taxonomy needs four surfaces — Principles bind thinking, Constraints bind solution space, Out of Scope binds vision, Anti-criteria bind test surface
>   criterion now: ISC-9 documents the four-surface taxonomy …

## A real example, abbreviated

`$PAI/ISA.md` is PAI's own project ISA. Representative criteria — note each names
its probe in the sibling `## Test Strategy` section:

> - [x] ISC-1: `~/.claude/PAI/ALGORITHM/LATEST` reads the current version (today: `6.2.0`).
> - [x] ISC-19: Pulse runs at `localhost:31337` and serves the Life Dashboard UI.
> - [x] ISC-27: Anti: regression — `~/.claude` repo never pushes to a public remote (constitutional rule in system prompt).
> - [ ] ISC-30: Antecedent: a new user can install PAI, name their DA, fill TELOS, and reach a working Life OS within an afternoon …

```yaml
- isc: ISC-19
  type: http-probe
  check: dashboard responds on localhost:31337
  threshold: HTTP 200 with HTML body
  tool: curl -i http://localhost:31337
```

And the matching `## Verification` entries: "ISC-1: `cat
~/.claude/PAI/ALGORITHM/LATEST` returned `6.2.0` on 2026-04-28T18:38:00Z."

ISC-30 also shows the system's honest answer for unverifiable-by-tool criteria: the
probe type `principal-recognizes-on-encounter` — i.e., "the human looks at it and
says yes." Naming that explicitly (rather than pretending everything is
tool-checkable) is a good touch.

## Where it goes wrong

- **Count floors.** "at E2+, the granularity rule's natural N must meet the tier
  floor — E2 ≥16, E3 ≥32, E4 ≥128, E5 ≥256 … At **E4/E5** the floor is HARD on the
  count" (`IsaFormat.md`). Requiring ≥128 criteria regardless of the task guarantees
  padded, decomposition-for-its-own-sake checklists — the exact "fluff ISC" failure
  the worked example warns against. The spec's own history shows thrash: v4.1 had
  floors, v5.0 removed them as over-prompting, v5.2 reintroduced them higher.
- **Doctrine coupling.** The ISA is entangled with the Algorithm's ceremony (phase
  fields, capability floors, mandatory skill invocations for appends). The artifact
  is good; the process wrapped around it is mostly enforcement scar tissue.
- **No validation.** For all the talk of fixed sections and required formats, nothing
  checks an ISA except the model and one frontmatter-reading hook.

## What cb should take

cb already has the *execution* half (procedures, procedure-runs, jobs, structured
output). What it lacks is the *specification* half: a procedure run has steps
(actions) but no machine-checkable statement of the end state.

Sketch — a criteria block on `procedure-run` (or a procedure-level template for it):

- At run start the agent writes 3–15 criteria, each a claim about the **end state**
  (not an action), each naming a probe a tool can answer yes/no. At least one `Anti:`
  criterion. cb's schema layer can actually validate this, which PAI cannot.
- Criteria get stable IDs; edits during the run append, split (`N.M`), or tombstone —
  never renumber.
- Each criterion is checked with one line of evidence (command + output excerpt),
  inline as the run proceeds, not batched at the end.
- The run closes with (a) unmet criteria explicitly surfaced — possibly as a
  question card rather than silently passing, and (b) a short "where the spec was
  wrong" note when the criteria themselves changed mid-run. The full
  conjecture/refutation format is overkill; one freeform sentence with the
  `refined:` discipline (log *why* the spec changed, not just the diff — git
  already has the diff) captures the value.
- Dead ends recorded in the run ("tried X, failed because Y, don't retry") are
  exactly the kind of thing the next run over the same material should see; this
  fits cb's existing pattern of runs living in `procedure/runs/`.

Where the granularity rule earns its keep in cb specifically: scheduled and
triage-driven procedures run unattended, so "the agent believed it finished" is
currently the main completion signal. Probe-named criteria turn that into "these
commands returned these outputs," which is auditable from the run card alone — same
spirit as cb's git-trailer provenance, applied to task completion.

Explicitly skip: effort tiers, count floors, the twelve-section body (Problem /
Vision / Principles etc. are plan-document sections — cb has `docs/plans/` and the
cb-plan skill for that altitude), and the phase state machine (the reactor already
is one, in code).
