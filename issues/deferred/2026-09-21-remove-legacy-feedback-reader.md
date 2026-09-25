---
title: "Remove legacy agent-feedback Markdown recognition after box migration"
workstream: unattached
activate-on: 2026-12-21
category: code-quality
filed-by: agent
discovered-by: agent
discovered-in: worktree-feedback-as-cards — feedback-to-doc-cards migration
area: beebox
---

The `feedback-to-doc-cards` migration converts timestamped `.md` observations
under `_config/feedback/` and `resolved/` into `.doc.card` files. During rollout,
the collector reads both shapes. The old shape should be removed once every
local and production box has the `feedback-to-doc-cards` entry in
`_config/migrations.jsonl`, and a scan confirms no matching `.md` files remain.

Code that exists only for the legacy shape:

- `feedback-review/collect.ts:32-38` — timestamped `.md` recognition in
  `isLegacyFeedbackFilename` and `isFeedbackFilename`.
- `feedback-review/collect.ts:260-264` — the transition refusal to resolve a
  legacy note before its box migration.
- `beebox/scripts/migrate/feedback-to-doc-cards.ts:13-68` — the converter can
  become a retired script tombstone. Keep the append-only manifest entry in
  `beebox/src/core/migrations.ts`.
- `feedback-review/collect.test.ts` — legacy list and resolve cases can be
  removed after convergence.

Before removing the reader, run the collector against all configured boxes and
check the manifests and feedback directories directly. A missing feedback
directory on a box that never recorded an observation is normal.
