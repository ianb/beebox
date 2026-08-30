---
title: "Doctest TSX resolution flake recurred after the loader fix"
workstream: load-older-label
area: beebox
filed-by: agent
discovered-in: worktree-load-older-label — full finish-suite verification
resolution: wontfix
---

> **2026-08-25 — this is very probably the mechanism, and it is now fixed.**
> Not reopened; recorded here because a future sighting should read this first.
> `issues/closed/bugs/2026-08-25-fresh-checkout-tap-default-plugins.md` shows
> that tap runs with its DEFAULT plugin set — `@tapjs/typescript` included,
> which `.taprc` disables — on the first run after any `pnpm install`, because
> the built Test class in `node_modules/@tapjs/test/test-built/` is the shipped
> default until `tap build` runs, and tap's own rebuild lands one run late. The
> typescript loader sits ahead of tsx and cannot resolve an extensionless
> directory import, which produces exactly this signature.
>
> It fits the three facts that made this look like a load flake: only some
> frontend files fail (only the ones that reach `src/frontend/src/lib/trpc`);
> the identical files pass on the very next run (the failing run performed the
> rebuild); and it fires after a worktree is created or dependencies are
> reinstalled, which correlates with heavy sessions rather than being caused by
> them. It also explains why no campaign could force it in a warm worktree —
> the built set was already correct there.
>
> The fix is `beebox`'s `postinstall: tap build`. If this signature
> appears again, check `tap versions` (the BUILT set) before assuming load;
> `tap plugin list` prints the configured set and will look right either way.

**Closed 2026-08-18 — real, but not actionable.** Boxholder's call: an
unreproducible flake shouldn't sit open indefinitely.

Closed `wontfix` rather than `invalid` deliberately — the premise held. This
fired, with a recorded signature (`1..0 # no tests found` from a failed
extensionless-directory import). It is being closed because two campaigns
could not reproduce it, not because it never happened.

The evidence is in the note below: 40 stress invocations at load 18–74 with
51–57 live agent processes — above this issue's own recorded trigger — plus two
full suites at 7315/7315, zero occurrences. And nothing has been fixed:
`agent-doctest/src/doctest-loader.ts` is byte-identical to when the flake last
fired, `tsx` still pinned `^4.23.1`.

**This record stays searchable on purpose.** `/finish`'s tracked-flake protocol
(`.claude/agents/finish.md`) greps `issues/` for a flake matching the failing
test and signature, and `issues/closed/` is inside that path — so a future
finish that hits this still finds the history rather than treating it as a new
regression. A sighting is what reopens it; re-file with the run's output rather
than reviving this one blind.

Same disposition as the sibling
[flaky mobile SPA fallback doctest](2026-07-10-flaky-mobile-spa-fallback-doctest.md),
closed `wontfix` after a comparable no-repro campaign.

> **Checked 2026-08-18 — could not reproduce, and the reason matters.** Tagged
> `reconfirm`; removed. `test/frontend/trpc-directory-resolution.test.ts` passed
> 10/10 consecutive runs plus 3/3 concurrent with itself, and a full-suite pass
> produced zero `1..0 # no tests found` occurrences across every frontend
> doctest. No commit has touched the doctest/tsx loader since the test was
> added.
>
> **Correction — the contention regime *was* reached.** A first pass concluded
> the machine had been too quiet for the result to mean anything. A fuller run
> then exceeded this issue's own recorded trigger conditions (load ~18, ~37
> concurrent agent processes) and still saw nothing:
>
> | batch | load avg | result |
> |---|---|---|
> | quiet baseline | ~3–6 | 10/10 pass |
> | organic agent load | 18.3–27.8 | 10/10 pass |
> | concurrent with full suite | 62–74 | 9/10 pass, 1 unrelated harness crash |
> | tail | 28–40 | 10/10 pass |
>
> 40 stress invocations, ~468 child imports resolved, with 51–57 live
> Claude/Codex processes measured. Plus two complete `pnpm test` runs, both
> 7315/7315, 79/79 frontend doctest files, **zero** `1..0 # no tests found`.
> (The single non-pass was `ENOTEMPTY` on `.tap/processinfo` — two concurrent
> `tap` invocations sharing one `.tap` dir, an artifact of how the load was
> induced, carrying none of this bug's signature.)
>
> `agent-doctest/src/doctest-loader.ts` has **zero commits since 2026-08-05** —
> byte-identical to when the flake last fired — and `tsx` is still pinned
> `^4.23.1`. So there is no candidate fix to credit, and non-reproduction of a
> rare startup race is not evidence of one.
>
> **What this changes for the next person:** stop mounting dedicated attempts.
> Two have now failed to force it under conditions that should have worked. The
> useful move is opportunistic — re-check this test during future genuinely
> loaded full-suite runs, and treat a sighting as the event that reopens
> investigation.

The full parallel `beebox` suite still intermittently resolves an
extensionless frontend import to a missing module. This recurred after the fix
documented in
[the earlier loader issue](2026-08-05-doctest-loader-tsx-resolution-under-parallel-load.md).

One run failed 12 frontend doctest files. Each child ended with
`1..0 # no tests found`. The underlying error tried to load
`src/frontend/src/lib/trpc` without resolving its `index.ts` module. The branch
did not change the doctest loader, the failed tests, or the imported module.

All 12 failed files passed together in isolation with one job: 78/78
assertions. The one permitted full-suite rerun then passed 6,169/6,169
assertions. This matches the prior parallel-load signature, but it shows that
the earlier TSX upgrade and loader guard did not eliminate every form of the
resolution flake.

Investigate the remaining extensionless-directory import path under parallel
TAP child startup. Add a stress regression that imports the frontend tRPC
directory entrypoint from multiple child processes.

## Reproduction under machine contention (2026-08-08)

A profiling run independently reproduced the same signature in 13 frontend
doctest children: each ended with `1..0 # no tests found`, and all 13 passed at
`jobs=1` immediately afterward. The machine's load average was approximately
18 with about 37 Claude or Codex processes live. The earlier occurrence was
also a parallel full-suite run, but its machine load was not recorded. The new
measurement makes heavy contention the strongest current trigger hypothesis,
not yet a conclusion from every occurrence.

`test/frontend/trpc-directory-resolution.test.ts` now starts 12 Node children
concurrently. Each child registers the same tsx and doctest loaders used by TAP,
imports `view-bindings.ts` through its real extensionless `./trpc` edge, checks
an expected export, and emits a success marker required by the parent. This is a
targeted stress regression for the unresolved import shape. Record repeated
runs under both quiet and loaded conditions before treating a pass as evidence
that the underlying flake is fixed.

The first run plus 10 immediate repetitions passed all 132 child imports. Those
repetitions ran at load average roughly 3 with 13.85 of 15.36 GB swap used and
11 Claude or Codex processes live. The regression therefore covers the actual
import edge but does not reproduce the failure deterministically under this
moderate CPU load; substantially heavier contention remains to be tested.
