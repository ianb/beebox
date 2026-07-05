# /plan-eng-review — engineering plan review

A 1787-line skill that does a structured eng review of a plan document. Dense, but several pieces are genuinely good — especially the ones that align with your form-as-prompt preference and the "explain-why-then-reason" framing.

This is the skill where Garry's engineering opinions are most exposed, and the structure of the review is calibrated to those opinions. Some of it transfers wholesale; the calibration itself is the most interesting transferable pattern.

## The crown jewel: stated preferences as the review spine

The skill literally embeds the reviewer's engineering preferences and instructs the AI to map every recommendation to one of them:

> **My engineering preferences:**
> - DRY is important—flag repetition aggressively.
> - Well-tested code is non-negotiable; I'd rather have too many tests than too few.
> - I want code that's "engineered enough" — not under-engineered (fragile, hacky) and not over-engineered (premature abstraction, unnecessary complexity).
> - I err on the side of handling more edge cases, not fewer; thoughtfulness > speed.
> - Bias toward explicit over clever.
> - Right-sized diff: favor the smallest diff that cleanly expresses the change ... but don't compress a necessary rewrite into a minimal patch.

And then in the question rules:

> **Map the reasoning to my engineering preferences above.** One sentence connecting your recommendation to a specific preference (DRY, explicit > clever, minimal diff, etc.).

★ This is exactly your "explain why, then ask AI to reason about it" pattern made operational. The "why" lives in the stated preferences section. Every recommendation must trace back to one. The review's voice is *yours*, not "generic best practice."

**Worth borrowing.** A callback equivalent would write out your engineering preferences and have any code-review skill (or just CLAUDE.md instructions) require the same trace-to-preference for recommendations.

## Cognitive Patterns — How Great Eng Managers Think

15 named patterns drawn from real eng-management literature. Not a checklist — explicitly framed as *instincts to apply throughout* the review. Standouts likely useful in callback:

- **Boring by default** — *"Every company gets about three innovation tokens. Everything else should be proven technology."* (McKinley, Choose Boring Technology)
- **Systems over heroes** — *"Design for tired humans at 3am, not your best engineer on their best day."*
- **Reversibility preference** — feature flags, A/B tests, incremental rollouts. Make the cost of being wrong low.
- **Essential vs accidental complexity** — *"Is this solving a real problem or one we created?"* (Brooks)
- **Two-week smell test** — *"If a competent engineer can't ship a small feature in two weeks, you have an onboarding problem disguised as architecture."*
- **Make the change easy, then make the easy change** — refactor first, behavior second. *"Never structural + behavioral changes simultaneously."* (Beck)
- **Own your code in production** — *"There are only engineers who write code and own it in production."* (Majors)

These are quotable. A subset of these could go in CLAUDE.md or a callback engineering-principles doc.

## Step 0: Scope Challenge (mandatory first step)

Before any review-section work, answer six questions:

1. **What existing code already solves each sub-problem?** Reuse > rebuild.
2. **What's the minimum set of changes that achieves the stated goal?**
3. **Complexity check** — if the plan touches **>8 files or adds >2 new classes/services**, that's a smell. **STOP, AskUserQuestion**, propose a minimal version.
4. **Search check** — for each architectural pattern: is there a framework built-in? Best practice? Known footguns?
5. **TODOS cross-reference** — are any deferred items blocking? Bundleable? Does this plan create new TODOs?
6. **Completeness check** — is this the complete version or a shortcut? With AI-assisted coding, "the cost of completeness is 10-100x cheaper than with a human team." Boil the lake.
7. **Distribution check** — if introducing a new artifact (binary, package, container), is the build/publish pipeline in the plan?

★ The **8-files-or-2-new-classes hard stop** is a concrete heuristic in the same family as `/investigate`'s >5-files blast-radius alert. Once you cross the threshold, the conversation pauses and the user is asked whether the scope is really necessary.

## Section structure: one issue = one AskUserQuestion

Four sections (Architecture → Code Quality → Tests → Performance), each emits findings as **individual** AskUserQuestion calls. Never batched.

> **One issue = one AskUserQuestion call.** Never combine multiple issues into one question.

For each issue:
- Concrete problem with file:line refs
- 2-3 options including "do nothing" where reasonable
- Per option: **effort (human: ~X / CC: ~Y), risk, maintenance burden**
- One sentence mapping the recommendation to a specific stated preference
- Issue NUMBER + option LETTER labels (e.g., "3A", "3B")
- "Coverage vs kind" distinction — only include `Completeness: N/10` when options differ in coverage; for kind-differentiated options, explicitly note "no completeness score, options differ in kind"

The dual-effort scale (`human: ~2 days / CC: ~15 min`) is a nice touch — makes AI compression visible at decision time. With CC, the "complete version" is often only marginally more expensive than the shortcut, so the shortcut should be recommended less often.

## The test review (this is the best section)

★ The crown jewel of the skill. Three steps that produce one artifact:

### Step 1 — trace every codepath

For each new feature, follow the data through every branch: where input comes from, what transforms it, where it goes, what can go wrong at each step.

### Step 2 — map user flows and interaction edge cases

This is the part that gets missed in normal test design. Explicit list of real-world interactions to cover:

- **Double-click / rapid resubmit**
- **Navigate away mid-operation** (back button, close tab, click another link)
- **Submit with stale data** (page sat open 30 min, session expired)
- **Slow connection** (API takes 10s — what does the user see?)
- **Concurrent actions** (two tabs, same form)
- **Empty/zero/boundary** (zero results, 10000 results, single character, max length)

Plus error states from the user's POV: clear error or silent failure? Can they recover? What happens with no network / 500 from API / invalid server data?

**This entire list is portable.** A callback-relevant version (long-running tasks, in-progress messages) could extend it: *"closing the app mid-task,"* *"network drops mid-message,"* *"two browser tabs talking to the same box,"* etc.

### Step 3 — output the ASCII coverage diagram

```
CODE PATHS                                            USER FLOWS
[+] src/services/billing.ts                           [+] Payment checkout
  ├── processPayment()                                  ├── [★★★ TESTED] Complete purchase — checkout.e2e.ts:15
  │   ├── [★★★ TESTED] happy + declined + timeout      ├── [GAP] [→E2E] Double-click submit
  │   ├── [GAP]         Network timeout                 └── [GAP]        Navigate away mid-payment
  │   └── [GAP]         Invalid currency
  └── refundPayment()                                 [+] Error states
      ├── [★★  TESTED] Full refund — :89                ├── [★★  TESTED] Card declined message
      └── [★   TESTED] Partial (non-throw only) — :101  └── [GAP]        Network timeout UX

LLM integration: [GAP] [→EVAL] Prompt template change — needs eval test

COVERAGE: 5/13 paths tested (38%)  |  Code paths: 3/5 (60%)  |  User flows: 2/8 (25%)
QUALITY: ★★★:2 ★★:2 ★:1  |  GAPS: 8 (2 E2E, 1 eval)
```

Quality rubric:
- **★★★** behavior + edge cases + error paths
- **★★** happy path only
- **★** smoke test / trivial assertion

Plus dispatch tags: `[→E2E]` for integration-test-worthy, `[→EVAL]` for LLM-quality-worthy.

★ This is form-as-prompt for tests. Visual, scannable, every gap is named. Coverage split between code-paths and user-flows is brilliant — two different things, both real.

### Iron regression rule

> **When the coverage audit identifies a REGRESSION — code that previously worked but the diff broke — a regression test is added to the plan as a critical requirement. No AskUserQuestion. No skipping.**

Same pattern as `/investigate`'s "fail-without-fix → pass-with-fix" rule but for plan-time test gap detection.

## Required outputs (every plan review must produce these)

Form-as-prompt for the entire review. Each is a named section:

| Section | What goes in it |
|---|---|
| **NOT in scope** | Work that was considered and explicitly deferred, with one-line rationale per item. |
| **What already exists** | Existing code/flows that partially solve sub-problems; whether the plan reuses or rebuilds them. |
| **TODOS.md updates** | Each TODO as an individual AskUserQuestion with What/Why/Pros/Cons/Context/Depends-on. |
| **Diagrams** | ASCII for any non-trivial data flow, state machine, or pipeline. Identify files for inline diagram comments. |
| **Failure modes** | For each new codepath: one realistic production failure + (test coverage? error handling? clear-or-silent?). Silent failure with no test AND no handling = **critical gap**. |
| **Worktree parallelization** | Dependency table + parallel lanes + conflict flags. |
| **Implementation Tasks** | Flat list of build-actionable tasks, each derived from a specific finding, with effort estimates and verify command. |

### The TODOS format (worth quoting)

> A TODO without context is worse than no TODO — it creates false confidence that the idea was captured while actually losing the reasoning.

Each TODO requires:
- **What** — one-line description
- **Why** — concrete problem it solves
- **Pros** — what you gain
- **Cons** — cost / complexity / risk
- **Context** — enough that someone picking this up in 3 months understands
- **Depends on / blocked by** — prerequisites

★ This is a quotable principle for callback. Replace cargo-cult bullet lists with structured TODOs that include the reasoning.

### Failure modes section ties to the resilience principle

> For each new codepath: list one realistic way it could fail in production (timeout, nil reference, race condition, stale data, etc.) and whether:
> 1. A test covers that failure
> 2. Error handling exists for it
> 3. The user would see a clear error or a silent failure
>
> If any failure mode has no test AND no error handling AND would be silent, flag it as a **critical gap**.

★ This is exactly the proactive version of your *resilience-before-bug-fix* principle. Don't wait for the bug to expose the gap — at plan time, enumerate the failure modes per codepath and check each for test + handling + visibility.

## Anti-shortcut rules (fighting a known AI failure mode)

> **Anti-skip rule:** Never condense, abbreviate, or skip any review section.

> **Anti-shortcut clause:** *The plan file is the OUTPUT of the interactive review, not a substitute for it.* Writing every finding into one plan write and calling ExitPlanMode without firing AskUserQuestion is the precise failure mode of the May 2026 transcript bug — the model explored, found issues, and dumped them into a deliverable rather than walking the user through them. If you have ANY non-trivial finding, the path from finding to ExitPlanMode goes THROUGH AskUserQuestion.

This is named after an actual incident where the model batched everything into the artifact and skipped the conversation. The rule fights a real, documented failure mode.

**Pattern worth absorbing**: name the specific failure mode the rule prevents, with reference if possible. Makes the rule durable instead of cargo-cult.

## Outside Voice (Codex integration)

Same pattern as `/codex challenge` — independent plan review by Codex, presented verbatim, with cross-model tension flagged when Codex disagrees with the main review. Already covered in `notes/codex.md` and `notes/autoplan.md`. User decides — never auto-applied.

## Ian's take

- ★ **Stated preferences as the review spine: yes, and a real artifact to develop.** Would want to write out callback's engineering preferences in my own words rather than borrowing gstack's list. Concrete future task: draft a callback `engineering-principles.md` (or a section of CLAUDE.md) capturing my actual preferences, then have any review-style work trace recommendations to them.
- ★ **Critical-gap concept (no test AND no handling AND silent) is real.** Aligns with resilience-before-bug-fix as the proactive form. Worth keeping.
- ★ **Principles I'd want to define include resilience AND transparency.** Resilience was already captured ([[feedback-resilience-before-bug-fix]]). Transparency is new and callback-relevant — given LLM-driven behavior, transparency probably means visible reasoning, traceable decisions, inspectable state, no surprising autonomous actions. Worth developing as its own principle.
- **TODOs format: worth reconsidering.** I don't currently maintain a TODOS.md, but I don't use external trackers either and I like keeping things on file. A file-based work-queue with the What/Why/Pros/Cons/Context format would actually fit my preferences — it's a separate topic from this review, but a sensible follow-on. See [[feedback-files-over-external-trackers]].
- **8-files-or-2-classes scope-challenge gate: NO.** Doesn't match how I work. I let the AI do giant things all the time and I'm having fun with that. The size-as-smell heuristic gates work that I actively want to happen. See [[feedback-large-scope-is-fine]].
- **Cognitive Patterns: feels like superstition.** They're sourced from real eng-management literature, but presented monolithically without justification within the skill. Reads as cargo-culted wisdom rather than guidance I'd actually invoke. Don't adopt; don't pre-load.
- **User-flow interaction edge cases: confirmed great.** This is the part of the test review that lands cleanly without the diagram around it. Adapt with callback-specific extensions.
- **ASCII coverage diagram: didn't grok.** Visual idea is appealing but the mechanic isn't clicking. Probably overkill for current callback work. The user-flow checklist works standalone.
- **Anti-shortcut rule pattern: maybe interesting.** Naming the specific failure mode a rule prevents (with reference) is a good meta-pattern in principle. Compatible with how the existing feedback memories already work.
- **Diagram maintenance discipline: skeptical.** Not convinced the AI actually understands diagrams well enough to maintain them reliably. Stale-diagrams-worse-than-no-diagrams is right as a principle, but the maintenance-by-AI implementation is doubtful. Park.
- **Dual effort scale (`human: ~X / CC: ~Y`): lukewarm.** Curious to see it in practice but doesn't obviously help. Park unless it shows up usefully somewhere.

## Concrete follow-on artifacts

In rough priority:

1. **`engineering-principles.md`** (or CLAUDE.md section) — write out my own engineering preferences in my voice. Should include resilience and transparency among other principles I haven't articulated yet. Reusable as the "why" for any review skill or AI guidance.
2. **Failure-modes table format** — when a plan or design surfaces a new codepath, run through (realistic failure × test × handling × visible-or-silent). Critical gap = no test AND no handling AND silent. Could be a section template in any callback design doc.
3. **User-flow edge-cases checklist** — adapt gstack's list (double-click, navigate-away, stale data, slow connection, concurrent tabs) with callback-specific additions (mid-task close, network drop mid-message, two tabs on same box, etc.). Reference doc for test design.

## Ideas to absorb (ranked)

★★★ **High value, low cost — adopt these:**

1. **Stated preferences as the review spine.** Write out callback's engineering preferences, make any review skill (or CLAUDE.md instruction) require each recommendation to trace to a specific preference. This operationalizes "explain why, then let AI reason."
2. **Failure modes section** — for each new codepath, enumerate one realistic prod failure + (test? handling? visible-or-silent?). Critical gap = no test AND no handling AND silent. Compatible with resilience-before-bug-fix as the proactive form.
3. **TODOS format** with What/Why/Pros/Cons/Context/Depends-on. Quote the principle: *"A TODO without context is worse than no TODO."*
4. **8-files-or-2-new-classes scope-challenge gate.** Concrete threshold that triggers a STOP. Same family as `/investigate`'s blast-radius alert.
5. **User-flow interaction edge cases checklist** (double-click, navigate-away, stale data, slow connection, concurrent actions, boundary values, error states). Portable test-design reference; callback-specific extensions natural.

★★ **Worth borrowing in lighter form:**

6. **ASCII coverage diagram** with ★★★/★★/★ quality rubric and `[→E2E]`/`[→EVAL]`/`[GAP]` markers. Even a simpler version (no separate code/flow split) would be useful.
7. **Anti-shortcut rule pattern** — name the specific failure mode a rule prevents, with reference. Makes rules durable.
8. **Cognitive Patterns subset** — Boring by default, Systems over heroes, Reversibility, Essential vs accidental complexity, Two-week smell test, Make-the-change-easy-then-make-the-easy-change. Quotable principles.
9. **Diagram maintenance is part of the change** — if you touch code with a nearby ASCII diagram, update the diagram in the same commit. *"Stale diagrams are worse than no diagrams."*
10. **Dual effort scale on options** (human: ~X / CC: ~Y) — makes AI compression visible at decision time, encourages choosing the complete version when the gap is small.

★ **Lighter / situational:**

11. **One-issue-per-AskUserQuestion** — slower but each decision gets full reasoning. Worth it for high-stakes reviews; overkill for casual ones.
12. **NOT in scope / What already exists** as explicit named sections in any plan review output.
13. Required-outputs-as-form approach generally — review output as a filled-in template rather than free-form prose. Aligns with form-as-prompt.

**Reject:**

- Numeric confidence levels (already rejected).
