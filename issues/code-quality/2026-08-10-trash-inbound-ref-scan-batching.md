---
title: "Batch inbound-reference scans for multi-card trash commands"
workstream: card-menu
area: beebox
labels: [cards, performance]
filed-by: agent
discovered-in: worktree-card-menu — finish review of card trash reference warnings
priority: normal
---

`bbx rm` reports inbound references before it moves cards to Trash. For a
multi-card command, it currently scans every card, Markdown file, and view once
for each target. This repeats file-system and parser work that one traversal
could share across all targets.

The command result also uses two shapes for `data.inboundRefs`: a bare array for
one successful target and a path-keyed record for dry runs and multiple targets.
Choose one stable result shape before callers depend on this field.

Refactor the advisory scan to read each referrer once and test all target remaps
in that traversal. Keep the report advisory: a scan failure must not prevent an
otherwise valid trash command.
