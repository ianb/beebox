---
title: "Remove temporary Bee Box name-change migration compatibility"
workstream: unattached
activate-on: 2026-09-07
category: code-quality
filed-by: agent
discovered-by: Ian
discovered-in: worktree-name-change-plan — retaining compatibility during the Bee Box rename
---

The 2026-08-31 Bee Box rename retained compatibility code so existing state can
migrate safely. Keep that compatibility during the settling period. After this
issue activates, inspect the legacy-name inputs in
`beebox/src/lib/state-migration.ts` and their call sites and tests. Remove only
the compatibility that the rename work explicitly made temporary, after the
deployed migration has had one week to run.
