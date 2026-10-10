---
title: "instruction surface size budget"
workstream: doc-structure
area: beebox
resolution: implemented
---

> **Naming note (2026-10-09):** agent instruction files in this repository and in boxes were renamed from `CLAUDE.md` to `AGENTS.md`. This document predates that and keeps the old name.

**Closed:** Resolved by [the agent guide spec](../../../beebox/docs/implemented-plans/agent-guide-spec.md):
the ledger's `budget:` header is the target size, and `pnpm lint:guide`
asserts the rendered guide and the always-loaded total against it — the
measurement (knowledge-audit ledger) this issue names is now paired with an
assertion that acts on it. The "inject a slim-down prompt" delivery mechanism
this issue proposes (a `bbx validate` warning triggering an in-session fix)
was deliberately not built; the linter fails the build instead, which is the
`git blame`-visible enforcement point this plan chose. [Context size
measurement legibility](../../features/2026-06-20-context-size-measurement-legibility.md)
stays open — its compositional per-layer breakdown is a separate ask.

(From the OpenClaw/Hermes comparison, 2026-07: the agent guide is generated at
~657 lines with no budget at all — we *measure* via the knowledge-audit ledger
but nothing acts on the measurement.)

Give each instruction surface (agent guide, box CLAUDE.md, guide cards,
personality) a **target size**. When a surface exceeds its target, don't
truncate — inject a prompt telling the agent to slim it down: consolidate
overlapping rules, demote detail to lazier tiers (rules/skills per the
loading-eagerness axis above), drop what no longer earns its tokens.

Delivery mechanism (boxholder, 2026-07-04): **just do it with `bbx validate`** —
add a size warning to validation, so the existing PostToolUse hook surfaces it
the moment the agent touches an oversized surface, and the agent can consider
fixing it right away in the same session. No new machinery: validate already
runs on every Edit/Write and already has the warn-don't-block channel (exit 2
on stderr). The size targets become validation config; knowledge-audit remains
the longitudinal view.

Competitor precedent, both mechanical-truncation-shaped, which we specifically
*don't* want: OpenClaw budget-caps bootstrap files (20k chars/file, 60k total)
and head+tail-truncates on overflow, salvaging rule-like lines via a regex
"policy digest" — i.e., a lossy machine guess at what mattered. Hermes is
closer to our shape: memory files have hard caps and an overflow write simply
*errors with instructions to the model to consolidate* (max 3 retries) — the
model does the slimming, code only enforces the ceiling. The synthesis for us:
knowledge-audit supplies the measurement, a target supplies the threshold, and
the agent (not a truncator) does the editing — with the existing
claude-md-lint soft warning upgraded from "guardrail" to "router" by actually
prompting the fix.
