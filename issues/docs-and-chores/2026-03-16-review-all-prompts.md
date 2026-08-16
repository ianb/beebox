---
title: "Review all prompts (using the prompt viewer)"
workstream: unknown
area: callback-box
---

The tooling for this now exists; what remains is the actual review, which is
mostly Ian's judgment work: read the prompts, decide what's redundant, stale,
or mis-placed, and comment.

**The tool** (built 2026-07, worktree `prompt-viewer`): the browser page at
`/main/dev/prompts/` shows every prompt in the system — the static inventory
(system prompts, subagent prompts, all schema instructions, connector rules,
procedure templates) plus the *assembled* chat / chat-thread / reactor context
stacks as an agent actually receives them, with word/token counts per layer.
Regenerate the data with `pnpm prompt-viewer` in `callback-box/` (reads
`~/src/boxes/test1`; `docs/maintenance.md` has the details). Every fragment has
a stable kebab-case name (`chat-system-prompt`, `schema-memo`,
`reactor/claude-md`, …) — **cite prompts by these names when commenting**, so
review notes are unambiguous and greppable.

**The review itself:**

- Read the three assembled stacks end-to-end, the way an agent does —
  [prompt-surface-review.md](../../callback-box/docs/prompt-surface-review.md)
  is the procedure for acting on findings (where an instruction should live,
  what to trim).
- Triage the duplication findings on the page. Known real signal at filing
  time: `schema-gdoc` ↔ `schema-gsheet` share restated guidance; several
  smaller cross-prompt boilerplate overlaps. Findings pairing an inventory
  entry with its own assembled layer (e.g. `chat-system-prompt` ↔
  `chat/system`) are expected containment, not duplication.
- Sanity-check the always-loaded budget: at filing time chat carries ~9.8k
  words (~16.7k est. tokens) always-loaded. Is that spent well?
- The size ledger (`dev/prompts/size-ledger.jsonl`) accumulates a point per
  real change — rerun `pnpm prompt-viewer` after prompt changes so growth
  stays visible; the page charts it once there are ≥2 points.

Output of the review: comments/decisions per named fragment, then edits (via
the prompt-surface-review workflow / normal prompt-editing flow) and a fresh
ledger point.
