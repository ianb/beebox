---
title: "layout-check's unit-directory finding names no import edge and runs only at commit"
workstream: unattached
area: beebox
labels: [layout-check, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261025-233625
---

File-layout rule 5 (one unit per directory) fires when a new or moved module,
a test support file, or a removed import changes the import graph. The finding
names the file that tripped it but not the import edge that made the second
unit, and it runs only in the pre-commit hook: `lint:changed` and
finish-verify do not run it. Implementers find the cause by experiment, one
commit at a time.

Coding feedback: box-memory-and-crash-recovery/20261025T155522Z-implemented.md
(four experiments; the cause was a test support file importing a sibling),
box-isolation/20261024T201653Z-implemented.md (three blocked commits),
front-door/20261026T012618Z-review-adjudicated.md (a removed import formed a
unit), front-door/20261026T023747Z-implemented.md (two move rounds).

Directions named in the entries: name the importer and imported file in the
finding; run the check from `lint:changed`; a dry-run form that reports the
unit graph for a proposed file and import.
