---
title: "A sweep of the repo's dependencies, to remove the ones we do not need"
workstream: dep-reduction
area: beebox
labels: [dependencies, code-quality]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder idea, 2026-10-25
---

Each dependency costs install time, image size, update work, and supply-chain
exposure. Nobody has reviewed the dependency list as a whole. On 2026-10-25 the
direct counts were: `beebox` 55 runtime and 21 dev, `workstreams-app` 18 and
17, `personal-vibe-check` 19 and 2, `tap-check` 2 and 7, the root 4 and 15.

## Proposed shape

For each direct dependency, find what uses it and decide one of:

- **Remove.** Nothing imports it, or the one use is dead code.
- **Replace with the platform.** Node or the browser now does the job
  (`fetch`, `node:test` helpers, `structuredClone`, `node:util` `parseArgs`,
  `fs.glob`, and similar).
- **Replace with a small local helper.** A small part of a large package is
  used, and a short helper with a test does the same job.
- **Consolidate.** Two packages do one job (two date libraries, two schema
  validators, two markdown parsers); pick one.
- **Keep.** Say why in one line.

Also check transitive weight: a direct dependency that pulls in a large tree
for a small use is a candidate even when it is used.

Knip already reports unused dependencies; start from its output, then read
the code for the rest. A removal that changes behavior, or where the choice
of replacement is a design question, gets filed instead of merged.

Related: the [weekly dependency update schedule](../docs-and-chores/2026-09-28-weekly-dependency-update-schedule.md)
keeps the remaining set current; fewer dependencies make that schedule
cheaper. The [what-can-we-remove sweep](2026-09-14-what-can-we-remove-sweep.md)
and the [functional duplication sweep](2026-10-22-functional-duplication-sweep.md)
are neighbors for code.

## Inventory

The per-dependency inventory (2026-10-27) is in
[dev/dependency-inventory-2026-10.md](../../dev/dependency-inventory-2026-10.md).
No removal has been made yet; each one waits on the boxholder's review.
