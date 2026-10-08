---
title: "Criteria for removing tests that have never failed and guard nothing a model gets wrong"
workstream: test-cleanup
area: beebox
labels: [tests, code-quality]
filed-by: agent
discovered-by: Ian
discovered-in: skills-review — "I trust the agents to generally write correct logic" (2026-10-08)
---

About 440 of 795 doctest files have never failed in 855 hourly full-suite
runs since 2026-08-25, and the suite grows at 0.53 test lines per src
line. The boxholder's position: agents generally write correct logic, so a
test that only re-proves straight-line logic is not earning its place.
Never having failed is context, not a criterion by itself: a test on code
that changed since it was written did its job quietly.

Proposed criteria, each on its own enough to remove an example (not a
whole file unless every example matches):

1. **Restates the code.** The assertion is the literal the code returns
   with no branch between input and output; deleting the code would be the
   only way to fail it.
2. **Second proof of one claim.** Another example in the same file proves
   the same branch with a different literal.
3. **Straight-line code, never changed, never failed.** The covered
   function has no branch, loop, parser, money, or security concern; the
   file has not changed since the test was written; the test never failed.
4. **Tests the framework.** Asserts that zod, Fastify, tRPC, or the
   doctest runner behaves as documented rather than that our code does.
5. **Mirrors a type.** The assertion is already enforced by the type
   checker (a required field exists, a union member is accepted).

Keep regardless of the above: anything on a trust or privacy boundary,
migrations, routes that accept external input, the Laws, and any test that
has failed on its own (see the flake issue, which runs first).

Procedure: a sweep in the knip-sweep shape (`schedules/`), reporting
candidates by criterion with a deletion branch judged on what it removes;
the first pass is read by the boxholder before it lands, later passes land
through cross-model review like the retrospective. Run after the flake
issue so the keep list is stable. Numbers go in the digest so the ratio is
visible going down.

## Agreed criteria (2026-10-08)

A sample of 64 never-failed files (454 examples) found C3 and C5 remove
almost nothing, so they are dropped. The sweep applies, per assertion: C1
restates the code; C2 second proof of one claim, within a file or across
files (the copy outside the code's home goes); C4 tests the framework. The
keep list above stands, plus cross-system contracts (mobile and scan wire
contracts, `beebox/*` package exports) and the files that have failed on
their own. The sample put this at about 5k of 145k test lines.

## Round 2 (2026-10-08, boxholder-approved)

Done: tests of in-memory fakes removed; repeated setup consolidated in the
37 largest files; static markup and prose checks removed except
branch-dependent, `bbx-` id/aria, security and incident-named ones; model
ids unpinned (wildcards inside the value, e.g. `claude-opus-«*»`); every
box migration retired to a shared tombstone with its migrator code and
tests deleted. Not done from the list below: zod shape probes,
exact-text and JSON-snapshot assertions, source-regex tests, the shared
auth-gate table, and the weak tests to fix or drop.

## Further trims to consider

Ideas outside the agreed criteria, collected during the sweep for a later
decision. Each needs its own yes; most are a rewrite, not a deletion.

Removals (a new criterion):

- **Tests of in-memory fakes.** `test/services/google-calendar`,
  `google-gmail-fake`, `telegram`, `scan-vision` and much of
  `claude-chat.doctest.md` assert a fake echoing its own state. Keep only
  fakes with real branches (gmail label filtering, `expireHistory`).
- **Static markup and prompt text.** `includes("<class or phrase>") => true`
  walls on fixed JSX, Tailwind classes, agent-guide prose and prompt text
  (`BrowseLandmarkHeader`, `Quote`, `TodoItem`, `agent-guide/guide/reaching`).
  They break on restyle or rewording and prove no branch. Prompt text that is
  a behavior contract (field-test boundaries) needs a call per phrase.
- **Constant and registry tables pinned row by row.** One row per branch
  would carry the claim: `drive-mime-label`, `mimetype`, `model-policy`
  model ids (break on every rotation), `system-card-renderers`,
  `speech-keywords` (24 phrases, about 100 lines).
- **Migration doctests after the migration has run on every box**, tied to a
  retire policy (`retire-process-pages`, `captures`, `v2-refs-to-v3`), and the
  per-migration "re-run is a no-op" and "dry run writes nothing" pairs if the
  runner can enforce them once.
- **zod shape probes** per optional field in schema doctests (`question`,
  `pdf`, `place`, `schemas.doctest.md`): one positive and one negative per
  schema.
- **Exact-text assertions:** error-message literals after the status already
  pins the branch, commit-message wording (`google-calendar` x8), whole
  rendered templates (`retro/discovery`), full JSON status payloads asserted
  five times (`chat.bootstrap`), full directory listings with every
  `.gitkeep` (`move/command`).
- **Source-regex tests** that parse a `.ts` file (`box-admission.exemptions`):
  replace with a lint rule.

Consolidation (no claim lost, volume down):

- **Repeated setup per example.** The largest volume: `procedure/engine`
  (about 300 lines), `google-calendar` connector (about 200), `maps/precheck`
  (about 100), `voice-staging-queue/queue`, `pending-sends`, tRPC `caller()`
  and event-bus stubs in nearly every router doctest. A shared helper or one
  table-driven block per claim.
- **One-case-per-block tables** with a server or tmp box each:
  `send-routes.validation` (nine servers for 400s), `box-shape` (seven throw
  blocks), `figure`, `session.self-note`.
- **Auth gates repeated per router** (owner-only FORBIDDEN in several
  routers; bogus-token 401 in three hub files): one shared gate table.
  Security call.

Weak tests to fix or drop (they pass if the behavior is a no-op):

- `compiler.doctest.md` "fresh compile after invalidation" (`output ===
  output3` holds if invalidation does nothing).
- `google-drive` "Pull creates card" and `docs` Degraded assert what setup
  pre-seeded.
- `engine.agent` "Agent then shell" never checks order.
- `registry` pin release and `id-file` cleanup end in a literal, proving only
  no throw.

Gap found: `core/chat/review/state.doctest.md` had a give-up-per-span test
that computed its own condition; it is removed and the `failedSpanId` rule
now has no test.
