---
title: "CLAUDE.md / docs backlog (from CLAUDE-MD-REVIEW, 2026-04)"
workstream: unknown
---

2026-07-04 · backlog, carried forward from a retired audit doc.

Still-open items from the 2026-04-28 CLAUDE.md self-audit
(`CLAUDE-MD-REVIEW.md`, since deleted — most of its scope was completed and
folded into `code-style.md`, `frontend.md`, `docs/maintenance.md`, and
`docs/knowledge-audits.md` over several passes). What's left:

- **Design and build a logger, then document "adding logging."** No central
  logger module today — `console.log`/`console.error` scattered with no
  levels, structured fields, or convention for where logs go outside agent
  traces and `client-debug.log`. Code work has to land before the doc can.
  (Overlaps [logging consolidation](../code-quality/2026-07-04-logging-consolidation.md) —
  same underlying task, one home.)
- **Write `docs/reliability.md`.** Nothing documents idempotence expectations
  for connectors/activities on crash-mid-cycle re-run, retry/backoff for
  external APIs, recoverable-vs-fatal error classification, stuck
  `processing` card-status recovery, or the reactor's lock-file semantics.
- **Write `docs/testing-practice.md`** (distinct from the mechanics-focused
  `docs/testing.md`): which doctest tier to choose, what to fake vs. let run
  real, expected thoroughness, and a test-first default.
- **Write `docs/state-machines.md`.** Seven XState machines exist with no doc
  on when to reach for XState vs. `useState`/`useReducer`, naming
  (`fooMachine.ts`), the one-machine-per-hook pattern, or the boundary
  between machine state and tRPC/SSE-driven state.
- **Decide which directories get their own CLAUDE.md.** Candidates that
  carry real conventions with no home: `src/cli/` (40+ commands, shared
  `lib/`, where to add a new one) and `src/webapp/` (tRPC routers, raw
  routes, auth, server — where the tRPC-by-default rule logically lives).
- **Fill in missing "how to add X" guides**: add a connector, add a service
  (interface + real + fake), add a CLI command. (Adding a card type, an API
  endpoint, and a box are already covered.)
- **Write a decision-tree doc** for recurring judgment calls that aren't
  written down anywhere: service vs. direct library call, connector vs. CLI
  command, procedure vs. plain code, and the boundary cases for raw Fastify
  route vs. tRPC procedure (long-polling, large responses, binary uploads).
- **State the "typed everywhere" principle in one place.** Currently only
  inferable from a dozen scattered conventions (tRPC end-to-end types, Zod at
  the boundary, no `as` casts to dodge the type checker).
