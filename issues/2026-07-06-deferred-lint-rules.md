# Deferred lint rules + tsconfig raises (architectural review Track F)

Track F's first slice (`no-floating-promises`, `no-misused-promises`,
`switch-exhaustiveness-check`) and the cheap wins (type-aware `no-shadow`,
clerk `exactOptionalPropertyTypes`, the `bin`/root tsconfig raise to
`exactOptionalPropertyTypes: true` + `noUncheckedIndexedAccess`) all landed.
The remaining candidates were each measured in isolation (dry-run fallout
counts below) and DEFERRED for a boxholder decision — recorded here because
the full measurement record was in gitignored `scratch/`.

Fallout format: backend / frontend / clerk / agent-doctest.

| Rule / flag | Fallout | Recommendation |
|---|---|---|
| `jsx-a11y` (recommended) | –/16/–/– | **Adopt, minus `no-autofocus`** (it fights the deliberate composer autofocus). ~14 genuine interactive/label/anchor bugs. Best-value defer; do as a dedicated frontend a11y pass. Needs the plugin dep + preset wiring. |
| `@typescript-eslint/return-await` | 35/1/0/0 | **Only with `webapp/routes/**` excluded.** 30 of 36 sites are Fastify `return reply.send()` inside try-blocks whose catch re-sends — forcing `await` routes a rejected send into the catch → second send → `FST_ERR_REP_ALREADY_SENT`. Adopting globally *introduces* double-send regressions. Viable as `always` mode in non-route code only. |
| `@typescript-eslint/no-non-null-assertion` | 169/24/2/4 = 199 | Real value (the unguarded twin of the `as` ban), but 199 sites, many legit (post-`invariant`, map-after-`has`). Adopt only as a scheduled burn-down, converting legitimate `!` to `invariant()` where it fits — not one pass. |
| `@typescript-eslint/no-unnecessary-condition` | 99/98/1/1 = 199 | Many hits are the rule fighting deliberate boundary `?? default` (code-style defensiveness rule 1 permits those). Needs per-site triage; burn-down only. |
| `@typescript-eslint/strict-boolean-expressions` | 1066/350/0/4 = 1420 | **Recommend never.** House style is hand-written `!== undefined`; mechanizing is a 1400-site rewrite for no safety gain here. |
| `@typescript-eslint/promise-function-async` | 34/42/3/0 = 79 | Recommend never — mechanical, no safety over the already-landed floating/misused-promise rules. |
| frontend `exactOptionalPropertyTypes` | 88 | Defer (large). |
| frontend `noUncheckedIndexedAccess` | 56 | Defer; if the frontend tsconfig is raised, do this one first as its own pass. |

Preset changes need explicit boxholder sign-off per the never-weaken-lint
rule. None of these are regressions — they're "next, not now."
