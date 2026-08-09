---
title: "deferred lint rules"
workstream: unknown
area: callback-box
resolution: implemented
---

**Closed 2026-07-10** — the last open item, frontend `noUncheckedIndexedAccess`,
landed in `57f70f24` (~95 measured errors fixed: index loops restructured to
`for...of`/`.entries()`/`.toReversed()`, `.at()`-with-fallback at regex-match
and user-input boundaries, `invariant()` only where a message/user group is
non-empty by construction). Every item in this issue is now resolved —
adopted, decided never, or (this one) implemented.

Track F's first slice (`no-floating-promises`, `no-misused-promises`,
`switch-exhaustiveness-check`) and the cheap wins (type-aware `no-shadow`,
clerk `exactOptionalPropertyTypes`, the `bin`/root tsconfig raise to
`exactOptionalPropertyTypes: true` + `noUncheckedIndexedAccess`) landed
first. All of the measured candidates below have since been resolved —
adopted, deferred with reasons, or decided never — except the frontend
`noUncheckedIndexedAccess` raise, which is APPROVED and is the only
remaining work here.

## Adopted

- **`jsx-a11y` (recommended), minus `no-autofocus`.** Wired into the React
  profile in `personal-vibe-check/eslint.config.mjs`; `no-autofocus` stays
  off because it fights the deliberate chat-composer autofocus. ~14 genuine
  interactive/label/anchor bugs fixed across the frontend.
- **`@typescript-eslint/return-await`**, in `in-try-catch` mode (the rule's
  default), with `callback-box/src/webapp/routes/**` carved out in
  callback-box's own eslint config. This is a deliberate deviation from the
  rule's usual "always" recommendation: 30 of 36 measured sites were Fastify
  `return reply.send(...)` inside a try-block whose catch re-sends — forcing
  `await` there routes a rejected send into the catch block and causes a
  second send (`FST_ERR_REP_ALREADY_SENT`). Adopting the rule unmodified in
  routes would have introduced double-send regressions, so routes keep the
  pre-rule behavior and every other directory gets the full rule.
- **`@typescript-eslint/no-non-null-assertion`.** Burned down 2026-07-10:
  190 sites converted to real narrowing (optional chaining, explicit guards,
  `invariant()`/`assertNever` for genuinely-impossible states, or a typed
  assertion helper) across callback-box (backend + frontend), callback-clerk,
  and agent-doctest. Now `"error"` in the preset's type-aware block, zero
  outstanding findings.
- **`@typescript-eslint/no-unnecessary-condition`.** Burned down 2026-07-10:
  ~200 sites fixed the same way. 3 sites kept a justified single-line
  `eslint-disable-next-line` where the condition is genuinely defensive
  against something the type system can't see (a non-spec V8 API in
  `agent-doctest/src/check.ts`, and two frontend sites — `useSSRMachine.ts`,
  `router.tsx` — where a library's conditional type collapses to `undefined`
  for an unresolved generic even though every concrete call site carries a
  real value). Now `"error"` in the preset's type-aware block, zero
  outstanding findings beyond those three.

## Decided never

- **`@typescript-eslint/strict-boolean-expressions`** (1066/350/0/4 = 1420
  fallout). House style is hand-written `!== undefined`; mechanizing is a
  1400-site rewrite for no safety gain here. Not revisiting.
- **`@typescript-eslint/promise-function-async`** (34/42/3/0 = 79 fallout).
  Mechanical, no safety benefit beyond the already-landed
  `no-floating-promises`/`no-misused-promises`. Not revisiting.
- **frontend `exactOptionalPropertyTypes`** (88 fallout measured). Boxholder
  decision 2026-07-10: not a big enough deal on the frontend to justify the
  burn-down; okay never adopting. (It stays on for backend/bin/clerk, where
  it already lives.)
- **`return-await` `always` mode.** Boxholder decision 2026-07-10: the landed
  `in-try-catch` mode is right; going further is unnecessary churn and
  forfeits the real-but-small win of not awaiting a tail call.

## Still open (approved, needs its burn-down pass)

- **frontend `noUncheckedIndexedAccess`** (56 fallout measured). Boxholder
  APPROVED 2026-07-10 — do as its own dedicated pass. The case for it got
  stronger this round: the `no-non-null-assertion`
  burn-down hit ~15 frontend sites that needed `.at(-1)`-with-guard
  conversions specifically *because* the frontend tsconfig lacks
  `noUncheckedIndexedAccess` (the backend already has it, which is why the
  equivalent backend sites were plain type errors, not just lint findings,
  under the raised backend tsconfig). Raising it on the frontend would catch
  this whole class at the type-checker level instead of relying on the lint
  rule to flag the `!`. Do this one first if/when the frontend tsconfig gets
  raised, per the original recommendation.

Preset changes need explicit boxholder sign-off per the never-weaken-lint
rule; both adoptions above were sign-off'd (2026-07-10).
