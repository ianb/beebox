---
name: feedback-run-audits
description: Knowledge audits in this project ARE runnable — stop hedging about LLM cost
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2acb3276-4768-4b9a-963f-ad48afb7c15d
---

When the user asks for new knowledge audits in `src/dev/knowledge-audits.yaml`, just run them after writing them. Don't preemptively hedge about "LLM cost" or "you'll want to run these yourself" — the harness is documented (`docs/knowledge-audits.md`), the command is `npx tsx src/dev/knowledge-audit.ts run --box ~/src/boxes/test1 [--filter <tag>]`, and the user has caught me declining to run them more than once. **Why:** the user has already paid for the agent's cycles in this session; my refusing to spend a few more is artificial caution, not helpfulness. **How to apply:** after writing or modifying audits, run the affected subset before reporting the work as done. Recording status comments in the YAML afterwards is the normal follow-up. Reports land in the gitignored `src/dev/reports/` directory.

Related: doc-generator bug — `src/core/generate-docs.ts` iterates `schemas` (XML legacy) but not `cardSchemas` (phase-2 YAML), so per-schema generated docs are stale for most card types. If a `memo-yaml-format` style audit fails by "agent shows XML," the doc is the cause, not the agent.
