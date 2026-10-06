---
title: "Check out OpenSpec — spec-driven changes with behavior deltas, compared with bbx-plan"
workstream: unattached
area: docs
labels: [agent-workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder shared openspec.dev
---

[OpenSpec](https://openspec.dev/) ([repo](https://github.com/Fission-AI/OpenSpec),
[concepts](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md))
is a spec-driven workflow for coding agents. It supports Claude Code, Codex,
and many other agents. This note compares it with our planning workflow:
`.claude/skills/bbx-plan/` (SKILL.md, TEMPLATE.md), plans in
`beebox/docs/plans/`, and plan reconciliation in `/finish`
(`.claude/agents/finish.md`, step 5).

Related prior art: [check out spec kit](2026-05-28-check-out-spec-kit.md).

## How OpenSpec works

- `openspec/specs/<domain>/spec.md` is the source of truth for **current
  behavior**. A spec is a list of `### Requirement:` entries, each stated with
  RFC 2119 keywords (SHALL/MUST/SHOULD/MAY), and `#### Scenario:` entries in
  GIVEN/WHEN/THEN form.
- `openspec/changes/<name>/` holds one proposed change: `proposal.md` (intent,
  scope, out of scope, approach), `design.md` (how), `tasks.md` (numbered
  checkbox list), and **delta specs** under `specs/` with
  `## ADDED` / `## MODIFIED` / `## REMOVED Requirements` sections.
- Commands: `/opsx:explore` → `/opsx:propose` → `/opsx:apply` →
  `/opsx:verify` (optional) → `/opsx:archive`.
- **Archive** applies the deltas to the main specs mechanically: ADDED is
  appended, MODIFIED replaces, REMOVED deletes. The change folder moves to
  `changes/archive/<date>-<name>/`.
- The rules: a spec is a behavior contract, with no class names, libraries, or
  steps. "Lite" rigor is the default; "full" rigor is for contract, migration,
  or security changes. Artifact dependencies are "enablers, not gates."
- The CLI has a documented machine contract
  ([agent-contract.md](https://github.com/Fission-AI/OpenSpec/blob/main/docs/agent-contract.md)):
  one JSON document per invocation, and one diagnostic envelope
  `{severity, code, message, target, fix}`.

## Mapping onto bbx-plan

| OpenSpec | Ours |
|---|---|
| `proposal.md` intent + scope + out of scope | Plan intro/JTBD, *Smallest fix and budget*, *NOT in scope* |
| `design.md` | *Tracks / scope* (Direction, Vocabulary lock-ins) |
| `tasks.md` checklist | *Implementation order* |
| Scenarios as acceptance checks | *Rollout shape*: "state done-when as the tests that must pass"; doctests are executable scenarios |
| `/opsx:verify` | `/finish` step 5: each plan requirement MET / PARTIAL / UNMET / UNCLEAR with `file:line` evidence |
| Archive: deltas merge into `specs/`, change folder archived | `/finish`: plan moves to `docs/implemented-plans/`; "fold durable 'how it works now' prose into a present-tense `docs/` reference" |
| Lite vs full rigor | *When to invoke* skip rules; one template |
| — | Cite-don't-assert, *Could this be simpler?* gate, *Failure modes*, *Stated preferences*, BIG CHANGE size review, knowledge audits |

bbx-plan is stronger on checking design claims: citations, failure modes, the
simpler-version gate, and the size review. OpenSpec is stronger on stating
**observable behavior** separately from design, and on keeping one current
record of that behavior.

## Ideas that may be worth taking

1. **A behavior-delta section in the plan template.** "What observable behavior
   is ADDED / MODIFIED / REMOVED," written without implementation terms. Today
   behavior is mixed into each track's Direction. `/finish` step 5 must extract
   "concrete requirements" from prose. An explicit list would give finish a
   checklist, and would give the cross-model reviewer a target that design
   changes cannot move.
2. **MODIFIED and REMOVED as first-class entries.** Our plans describe new
   things well. A plan that silently drops or changes existing behavior has no
   dedicated place to say so. The *NOT in scope* gate does not cover "this
   stops working."
3. **Mechanical merge into current-behavior docs.** Finish folds plan prose
   into `docs/` by judgment. OpenSpec merges requirement blocks mechanically.
   Question: is a judgment fold good enough, or do reference docs drift? A
   check could be: do implemented plans leave reference docs that state the
   behavior in present tense?
4. **Scenarios should name the case.** "Scenario: Rejects an expired token."
   The review question "what's the one case I'd be upset to see broken?" maps
   onto our Failure modes table.
5. **Lite by default.** A smaller template variant for mid-size work that
   warrants a plan but not every section. Tension: the skill says blank
   sections are "the failure modes you haven't thought about yet"; a lite
   variant weakens that. Needs a decision, not a default.
6. **The CLI diagnostic envelope** is unrelated to planning but relevant to
   `bbx` as an agent surface: stable codes plus a `fix` field per diagnostic.
   Compare with the current `bbx` error output before proposing anything.

## Probably not worth taking

- A separate `openspec/specs/` tree beside `beebox/docs/`. Doctests are our
  executable behavior record, and prose GIVEN/WHEN/THEN would duplicate them.
- The per-change folder with four files. One plan file plus subplans already
  keeps the change together, and git history is the audit trail.
- Artifact dependency schemas (`schema.yaml`). One workflow does not need a
  configurable graph.
