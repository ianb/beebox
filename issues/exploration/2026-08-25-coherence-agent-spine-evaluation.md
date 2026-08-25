---
title: "Check out `coherence` — a decision journal, machine-checkable specs, and a work ledger for agent-driven projects"
workstream: unattached
area: monorepo
labels: [tooling-eval, agent-instructions, docs]
filed-by: agent
discovered-by: Ian
discovered-in: main session — link passed along for evaluation
---

[coherence](https://github.com/daniloc/coherence) (Danilo Campos, MIT,
TypeScript, Node ≥22 — created 2026-06, still active). Installs as a dev
dependency and hooks into the agent host: `npx coherence hooks install --host
claude` (or `--host codex`).

Its framing, which is the interesting part:

> The expensive resource in a codebase is not bytes and not lines — it is
> **inference** … it's paid again by every reader, forever — nobody's inference
> makes the next reader's cheaper. In a world where the readers are mostly
> agents burning tokens, that invoice compounds fast.

Three mechanisms:

- **A decision journal** — what was chosen, what was rejected, and why, "so
  settled questions stay settled instead of getting re-litigated by every fresh
  session." Doubles as a human highlight reel.
- **Machine-checkable specs** — a `*.spec.md` tree tied to code by *oracles*
  that re-grade it every build: "when the docs rot, the build says so."
- **A work ledger** — "who owns what, within what boundary, and where two agents
  are about to collide."

Plus a derived multi-resolution graph over specs + code, rendered as an outline
and an "agent map", behind language (tree-sitter) and platform adapters.

## Why it lands here specifically

Every one of the three overlaps something this repo already built, which makes
it a good mirror rather than a shopping list.

**The claim-rot idea is the one we do not have, and there is a live example
sitting in the tree right now.** `pnpm doc-check` enforces *broken references,
orphaned docs, duplicate basenames* — that a doc **points** somewhere real. It
never checks that a doc **says** something true. Today:

- `callback-box/docs/security-overview.md:66` states "On fresh boxes, scheduled
  agent runs are off by default."
- `src/core/box/defaults.ts` ships **three** seeded schedules `enabled: true` —
  `refresh-maps`, `gc-procedure-runs`, `process-retrospective`.

A false claim, in the security document whose stated premise is leading "with
blast radius, not reassurance", in a repo with documentation enforcement — and
nothing caught it, because nothing checks claims. That is precisely the gap
coherence's oracles target. Whatever we conclude about adopting the tool, this
one claim should be fixed.

**A decision journal is something we do in prose, unevenly.** `issues/decisions/`,
`docs/stack-decisions.md`, and the rationale paragraphs in plan docs all serve
this, and the repo is unusually good at writing down *why* — but nothing injects
it into a fresh session, so settled questions do get re-litigated. Recent
instance: an agent proposed auto-replacing generated Codex skill mirrors and was
stopped only because a test encoded the prior decision. The test worked; a
journal would have worked earlier and cheaper.

**The work ledger is `bin/workstreams`** — worktrees, tri-state agent liveness,
`--exclude-self-ancestor`, fail-closed guards. Ours is arguably more developed on
the collision-avoidance side (it stands in front of an irreversible delete).
Worth comparing what a ledger records that a registry does not.

**The agent map is MAP.md + `refresh-maps` + `doc-graph`.** Same instinct —
derive a navigable index so an agent orients without spelunking. Ours is
box-side and repo-side, generated, and currently the subject of a throughput
investigation. Coherence deriving its graph from a spec tree *plus* code is the
notable difference.

## What to actually do

- **Read the full reference** — the README's `<details>` section is written for
  agents and is where the mechanisms are specified.
- **Decide separately about the three mechanisms.** They are severable, and the
  claim-checking one is the only one that fills a real hole. Borrowing the idea
  (oracles over our existing docs) may beat adopting the tool.
- **Cost of adoption is real**: a dev dependency, Node ≥22, host hook
  installation, and a `*.spec.md` tree that becomes a second documentation
  system alongside CLAUDE.md, `docs/`, plans, and the generated box docs. This
  repo already has a lot of agent-facing surface; a fourth one needs to earn it.
- **Note the host-hooks angle.** It installs per host (`--host claude` /
  `--host codex`), which is the same problem the AGENTS.md mirror generator
  solves here. Worth seeing how they handle it.

Related: [proving-it-works](2026-08-14-proving-it-works-demo-video-plugin.md) —
the other outside tool in the queue, and the same shape of question: adopt,
borrow the idea, or neither. Record the call either way so the link is not
re-evaluated later.
