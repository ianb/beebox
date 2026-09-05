# Engineering Principles

The durable design principles this codebase is built and reviewed against.
They sit above the mechanical rules: [`code-style.md`](../code-style.md) says
*how* to write a line (quotes, params, `as`), the principles say *why the
shape of the code is what it is*. When a design decision, a review finding, or
a plan needs a reason, it traces to one of these.

Twelve principles, in rough dependency order — the earlier ones are about the
types and boundaries everything else leans on.

## 1. Types are structure

Prefer types that make illegal states unrepresentable: discriminated unions
over flat interfaces with correlated optional fields; literal unions
(`"warn" | "review" | "abort"`) over a bare `string` discriminator; branded
types where a `string` carries an identity that could be cross-wired (a
box-relative path, a card ID, a ref). A type that can represent a state the
program should never be in is a bug the compiler can't help you find. The
payoff compounds because the maintainer is usually an agent (principle 12) —
a shape the compiler rejects is a shape the next session can't get wrong.

## 2. Exhaustiveness is enforced, not hoped for

Every dispatch over a closed set — a `switch`, an if-chain, a lookup object —
must fail to compile when a member is added. The idioms are `assertNever(x)`
in the `default`/final `else` of a backend `.ts` switch
([`src/lib/invariant.ts`](../src/lib/invariant.ts)),
a `Record<Union, Handler>` with `satisfies`, and the
`@typescript-eslint/switch-exhaustiveness-check` lint rule (live in the
preset, configured so a bare `default:` does *not* count as exhaustive).
(Frontend `.tsx` bans `default:` cases outright, so a `.tsx` switch reaches
exhaustiveness by listing every case with no default.) A
`void`-returning switch with no terminator silently ignores a new union member
— which is exactly the drift this principle exists to catch.

## 3. Validate at boundaries and during parsing

Disk reads, LLM output, HTTP bodies, third-party API responses, config files,
and env vars each get validated into typed data exactly once, at the boundary,
with loud, localized failure. `JSON.parse(...) as X` is the anti-pattern — it
parses without validating, so a wrong-but-parseable shape flows on untyped.
`schema.safeParse(...)` with an explicit failure path is the pattern. Config
is untrusted content too: a hand-editable file is an input boundary like any
other. The strong boundaries already in the tree —
[`src/lib/env.ts`](../src/lib/env.ts), `core/agent-json.ts`,
`hub/hub-config.ts` — are the standard the weak ones get raised to.

## 4. Resilient AND never silent — and never resilient to the impossible

Degradation is allowed for failures that can genuinely happen; invisible
degradation is not; and *seemingly-impossible* states get hard failure, not
resilience — don't limp past a broken invariant. Every catch block either
rethrows, returns a typed failure, or logs — and "logs" means at a level
someone will actually see, carrying enough context (box, card, operation) to
debug from the log line alone. Dev and test fail hard where prod may degrade:
invariant checks are strict in dev and tests (except in a test that exercises
the degradation path itself). See the logging-level policy and the
resilient-not-silent rule in [`code-style.md`](../code-style.md), and the
`invariant` / `checkInvariant` split in
[`src/lib/invariant.ts`](../src/lib/invariant.ts) — `invariant` always throws,
`checkInvariant` is the deliberate prod-degradation counterpart.

## 5. Failure paths visible in signatures where callers branch

When callers genuinely dispatch on *why* something failed, return a
discriminated Result (`{ ok: true, value } | { ok: false, error }`) instead of
throwing — the failure is part of the contract and belongs in the signature.
When callers can't act on the failure, exceptions (typed error classes,
`cause` chaining) are correct: a broken invariant throws, an infrastructure
failure throws. One Result shape convention, not two —
[`src/lib/result.ts`](../src/lib/result.ts) is it, and its module comment is
the authority on the Result-vs-throw boundary.

## 6. Right-sized defensiveness

No handling for states the types prove impossible — assert or crash loudly
instead of inventing a fallback value. Defense concentrates at real boundaries
(principle 3); interior code trusts its types. A `?? default` on a value that
can't be nullish converts a bug into silent wrong behavior — which violates
principle 4. Before adding a check, ask what produced the value: same-repo
typed code → an assertion or nothing; disk, network, or another process → keep
the check. This calibrates against the known AI failure mode of over-guarding
already-typed values; the full policy is the defensiveness rules in
[`code-style.md`](../code-style.md).

## 7. Hierarchy is a discoverability contract

You should be able to predict where something lives, and conclude from its
absence that it doesn't exist. Two things break the contract: a directory
whose name promises content it doesn't hold (a decoy `audio/` with the audio
code elsewhere), and a cluster that encodes its directory in filename prefixes
(`chat-session-*.ts` × 15 in a flat directory). A name is a promise; keep it.

## 8. One way to do each thing

Competing idioms are drift generators — two Result field names, three duration
parsers with three different failure behaviors, four hand-synced copies of a
tool-name dispatch. Consolidate over blast-radius fear: caller churn, import
churn, and differing defaults are migration work, not reasons to keep the
duplication. Duplication is only kept when copies genuinely co-evolve
independently — and then the divergence is documented *at the site*
(`bin/box-entry.ts`'s reasoned cross-package copy is the model). Process
handles duplication; fear of the diff does not.

## 9. Formal structure for essential complexity

Where hard code can't be made simple, make it explicit rather than implicit:
state machines (xstate where async actor coordination is the real problem — its
home is the frontend; a plain discriminated-union + transition function
otherwise, as in `bin/router.ts`'s `EntryState`), documented lock tables,
invariant assertions, protocol docs. Hard work maintaining structure is good
when the difficulty is essential — the fix for a genuinely complex mechanism is
to name its structure, not to paper over it.

## 10. Testability is architectural, and deeper than usual taste

Seams — clock injection, fs/agent injection points, a pure decision core
extracted from an IO shell — are built into production code deliberately, even
where conventional style would call it over-engineering. But a test-only
affordance must not widen the production surface: gate it behind an explicit
process flag (the `BBX_TIME` / stubs pattern) so a seam is inert unless
deliberately enabled. A `resetForTest()` that isn't a no-op in prod is surface
area we don't ship. The testing philosophy and tiers are in
[`docs/testing.md`](testing.md).

## 11. Enforcement beats convention, and the preset is ours

A rule that matters gets a lint rule or a type, not a paragraph.
`@ianbicking/personal-vibe-check` effectively belongs to this project —
extending it with a new rule is normal work, not a special event. A written
rule that's widely violated is either a dead letter (delete it) or a debt list
(schedule it) — never ambient guilt. Suppression is sometimes right, but it's
infrequent, signaled, **line-level only** (never file- or rule-level), and
carries a concrete justification; when a legitimate exception *recurs*, encode
it into the rule itself rather than accumulating disables. Where lint genuinely
can't express a rule, a /finish review checklist item is the fallback
enforcement tier. Never weaken a rule to make code pass — fix the code or raise
it with the boxholder.

## 12. The maintainer is usually an agent

Structures that catch mistakes at compile time pay double here: an agent can't
hold tribal knowledge between sessions, so anything enforced only by memory of
past conversations will eventually be violated. This is why principles 1, 2,
and 11 lean so hard on types and lint rather than documentation — a shape the
compiler rejects survives a compaction; a paragraph an agent has to remember
does not. When choosing between "document it" and "make it unrepresentable,"
prefer unrepresentable.

## 13. A control shows the state the system is in, never the one it intends

An affordance may display only what is actually true. Where intent and state
differ, the control shows the intent as *pending* — never as achieved, and
never as nothing. Both failures are the same bug seen from opposite sides: a
record button wearing its listening face while the recognizer is still starting
told the boxholder the button was broken
(`issues/bugs/2026-08-20-ios-record-button-silently-waits-for-speech.md`),
and a capture that succeeded while the UI said nothing told them it had failed
(`issues/bugs/2026-08-20-capture-success-is-invisible.md`). This is the UI face
of principle 4: an unreported state is invisible degradation, and a state
reported as its own opposite is worse. When a fix removes the wait, the
affordance still needs the pending face — the wait it removed is rarely the only
one.

## Where the mechanical rules live

These principles set direction; the checkable rules that implement them live
in [`code-style.md`](../code-style.md) (logging levels, the exhaustiveness
idiom, the defensiveness policy, the `as`/cast conventions, the suppression
policy). Agent-facing conventions that a box agent must recall — `assertNever`,
the Result convention, `withCardLock`, `resolveContainedRef`, `fenceForPrompt`,
the logging policy — are also verified by knowledge audits
([`docs/knowledge-audits.md`](knowledge-audits.md)).
