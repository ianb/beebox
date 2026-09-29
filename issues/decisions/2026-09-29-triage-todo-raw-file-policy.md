---
title: "Decide how triage follow-up handles raw files without card frontmatter"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-jev-triage — destination todo question review
---

A destination can ask a per-item `todo-question`; yes adds an ordinary
frontmatter todo. The implementation supports admitted cards. Positive answers
for raw staged files fail explicitly because a raw file cannot carry that todo.
Normal scan/document preparation produces cards, but both triage engines can
also encounter raw staged files.

## Research (2026-09-29)

- `beebox/src/core/triage/todo.ts` rejects positive annotation targets without
  the `.card` extension before changing their bytes.
- The legacy `run/routing.ts` validates todo answers before moving a batch, so
  one positive raw-file answer rejects that batch.
- The Jev `auto/core.ts` reports the item's application error and continues other
  items, but leaves the raw item staged. A later automatic pass judges it again.
- No negative answer is invented, and no requested todo is silently omitted.

Choose an explicit policy before broadening annotation beyond cards: wrap raw
files in a document card during intake, hold them with a repair request, or allow
filing while recording unavailable follow-up. Wrapping belongs in preparation;
using a destination-choice question for an annotation failure can ask the wrong
question. Also isolate legacy item failures and avoid paying repeatedly for an
unchanged unsupported target once the recovery policy is chosen.

This is separate from adding optional questions to ordinary triage destinations.
The current explicit-failure behavior is tested; no live box content was used.
