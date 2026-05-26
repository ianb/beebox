# /investigate — methodical root-cause debugging

Probably the most broadly transferable skill in gstack. Clean 5-phase debugging methodology, with a couple of really good circuit breakers. Compatible with the form-as-prompt preference because the final output is a filled-in DEBUG REPORT.

## The Iron Law

> **NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**
>
> Fixing symptoms creates whack-a-mole debugging. Every fix that doesn't address root cause makes the next bug harder to find.

Strong claim, well-justified. The reason matters — it's not just "be thorough," it's that symptom-fixes *compound negatively* by making future bugs harder to locate. Worth quoting if we ever want a callback debugging principle.

## The 5 phases

### Phase 1: Investigation (before any hypothesis)

Five concrete steps:
1. **Collect symptoms** — errors, traces, repro steps. If user didn't give enough context, ask ONE question at a time.
2. **Read the code** — trace from symptom back, Grep + Read.
3. **Check recent changes** — `git log --oneline -20 -- <affected-files>`. "A regression means the root cause is in the diff."
4. **Reproduce deterministically** — if you can't repro, gather more evidence before proceeding.
5. **Check investigation history** — "Recurring bugs in the same area are an architectural smell, not a coincidence."

Output: `"Root cause hypothesis: ..."` — a specific, testable claim about what's wrong AND why.

### Phase 2: Pattern Analysis

A compact diagnostic table — worth keeping just for reference:

| Pattern | Signature | Where to look |
|---|---|---|
| Race condition | Intermittent, timing-dependent | Concurrent access to shared state |
| Nil/null propagation | NoMethodError, TypeError | Missing guards on optional values |
| State corruption | Inconsistent data, partial updates | Transactions, callbacks, hooks |
| Integration failure | Timeout, unexpected response | External API calls, service boundaries |
| Configuration drift | Works locally, fails in staging/prod | Env vars, feature flags, DB state |
| Stale cache | Shows old data, fixes on cache clear | Redis, CDN, browser cache, Turbo |

Also check `TODOS.md` for related issues and `git log` for prior fixes in the same files (architectural smell).

### Phase 3: Hypothesis Testing

Three rules:

1. **Confirm before fixing.** Add a temporary log/assertion at the suspected root cause. Run the repro. Does evidence match? If not, don't write the fix yet.

2. **Wrong hypothesis = gather more evidence, don't guess.** Return to Phase 1.

3. **The 3-strike rule.** If 3 hypotheses fail, STOP. AskUserQuestion:
   - A) Continue investigating — I have a new hypothesis: [describe]
   - B) Escalate for human review — needs someone who knows the system
   - C) Add logging and wait — instrument the area and catch it next time

   ★ This is the gem. **Explicit circuit breaker for hypothesis failure.** Most AI debugging spirals because the agent keeps generating new hypotheses indefinitely without recognizing that "the model of the problem might be wrong, not just the specific hypothesis."

**Red flags** during hypothesis testing — also worth keeping:
- "Quick fix for now" — *there is no "for now."* Fix it right or escalate.
- Proposing a fix before tracing data flow — you're guessing.
- Each fix reveals a new problem elsewhere — **wrong layer, not wrong code.**

### Phase 4: Implementation

1. Fix the root cause, not the symptom. Smallest change that eliminates the actual problem.
2. Minimal diff. "Resist the urge to refactor adjacent code."
3. **Write a regression test that fails without the fix AND passes with the fix.** ★ Excellent rule — proves the test is meaningful, not just a smoke test. Compatible with the form-as-prompt verification ethic.
4. Run full test suite. Paste output. No regressions.
5. **>5 files = blast radius alert.** AskUserQuestion:
   - A) Proceed — the root cause genuinely spans these files
   - B) Split — fix critical path now, defer the rest
   - C) Rethink — maybe there's a more targeted approach

### Phase 5: Verification & Report

Fresh reproduce + paste test output. Then a structured **DEBUG REPORT**:

```
DEBUG REPORT
════════════════════════════════════════
Symptom:         [what the user observed]
Root cause:      [what was actually wrong]
Fix:             [what was changed, with file:line references]
Evidence:        [test output, reproduction attempt showing fix works]
Regression test: [file:line of the new test]
Related:         [TODOS.md items, prior bugs in same area, architectural notes]
Status:          DONE | DONE_WITH_CONCERNS | BLOCKED
════════════════════════════════════════
```

This is a form-as-prompt instance. Every field has clear semantics, the filled-in report is a portable artifact.

## Other smaller details worth keeping

**Sanitize before WebSearch.** When searching for an unknown error online: strip hostnames, IPs, file paths, SQL, customer data first. Search the error *category*, not the raw message. If too specific to sanitize safely, skip the search. Privacy/security hygiene baked into the workflow.

**"Absence of a matching prior learning is itself useful information."** Nice framing. When checking learnings for the hypothesis you just named, no match isn't a null result — it tells you this is a novel-shape bug rather than a recurrence.

**Scope Lock** (uses `/freeze`) — after forming the hypothesis, restrict Edit/Write to the narrowest directory containing the affected files. Prevents scope creep during the fix. We rejected `/freeze` so this specific integration doesn't apply, but the principle ("debug session has a scope; once you've located the bug, don't wander") is worth borrowing in spirit.

## Ideas worth absorbing

In order of value:

1. ★ **Iron Law** — root cause before fix, with the *reason* (whack-a-mole compounds).
2. ★ **3-strike rule** — explicit circuit breaker. After N failed hypotheses, stop and reconsider whether the *model of the problem* is wrong, not just the current hypothesis.
3. ★ **Regression test must fail without the fix AND pass with it** — proves the test is meaningful, not vacuous.
4. **5-phase structure** — Investigation → Pattern Analysis → Hypothesis Testing → Implementation → Verification. Linear, with explicit gates between phases.
5. **DEBUG REPORT format** — structured output as a filled-in form (compatible with form-as-prompt).
6. **Pattern Analysis table** — handy cheat-sheet for common bug categories.
7. **Red flags** — "no 'for now,'" "wrong layer not wrong code," "tracing before fixing."
8. **Sanitize before WebSearch** — privacy hygiene for error-message lookups.
9. **>5 files = blast radius alert** — fix size warrants a stop-and-reconsider gate.

## Ian's take

- **Iron Law: yes.** Keep.
- **3-strike rule: soft positive.** Hasn't been a noticed problem in practice, but plausibly useful as a circuit breaker. Worth knowing it's there; not urgent to enforce.
- **Regression test discipline: yes — and addresses an observed pattern.** AI tends to fix-then-write-test, which "doesn't go terribly but" the test-first-fail-then-pass ordering would be a real improvement. The discipline targets a real failure mode that's already shown up in callback work.
- **DEBUG REPORT format: yes.** Like it — it's a form-as-prompt instance.
- **Pattern Analysis table: yes, and worth extending.** The generic patterns (race / null / state corruption / integration / config drift / stale cache) are useful as-is. callback-box almost certainly has its own recurring bug patterns that belong in an equivalent table — could become a real callback-specific artifact rather than just adopting gstack's generic list.
- **Red flags: yes.** Keep — *"no 'for now'"*, *"proposing a fix before tracing data flow = guessing"*, *"wrong layer not wrong code"*.
- **Sanitize before WebSearch: uncertain.** Not sure it's a real problem in callback work. Don't pre-emptively add the rule (per the no-premature-tuning principle); revisit if a real privacy leak via error-message search ever surfaces.
- **Blast radius alert (>5 files): yes — sounds important.** Bug fixes shouldn't quietly grow into refactors. Worth keeping the gate.

## Ian's principle: resilience first when the bug has blast radius

When a bug causes downstream damage — UI freeze, data loss, lost in-progress message, anything where the failure mode of the bug spilled into damage the user cares about — the bug is evidence of **two** failures:

1. The bug itself (the wrong logic)
2. The resilience gap that let the bug turn into damage (no autosave, no retry, no recovery, no graceful degradation)

**Fix the resilience gap first, then fix the bug.** Use the bug as the discovery moment for the fragility it exposed. Otherwise the next bug in the same category will have the same blast radius.

This complements the Iron Law (root cause before fix) and the blast-radius alert (>5 files), but addresses something different: **the cost of the bug**, not the cause of it. A small bug with a large blast radius is two problems, not one.

This is callback-specific in its motivation — losing an in-progress message or freezing the UI mid-task has real cost for users — and should be in any callback debugging guide.

## Possible next-step artifact

A callback-specific debugging guide (in CLAUDE.md or a `docs/debugging.md`) with:
1. The Iron Law, quoted with its reason
2. The fail-without-fix-then-pass regression test rule
3. The DEBUG REPORT format as a template
4. A Pattern Analysis table that starts with the generic patterns and adds callback-box-specific recurring patterns as they're identified

The Pattern Analysis table is the part that gains the most from being callback-specific — it'd grow over time as new recurring bug shapes get categorized.
