---
title: "Agent-applied-migrations plan cites Nidus for an idea the paper does not contain"
workstream: unattached
area: docs
filed-by: agent
discovered-by: agent
discovered-in: worktree-acknowledgements — verifying credit candidates against sources
priority: backlog
resolution: implemented
---

Closed: implemented by the acknowledgements workstream. The prior-art note in `beebox/docs/implemented-plans/agent-applied-migrations.md` now states the checklist decision has no external source and records why the Nidus citation was withdrawn.

`beebox/docs/implemented-plans/agent-applied-migrations.md` (prior-art
section, around lines 151-156) cites Nidus (arXiv 2604.05080) as support for
an agent-owned checklist used as externalized reasoning during a migration.

A read of the full paper finds no checklist or working-list mechanism. The
paper describes a governance runtime that enforces constraints on an agent
from outside it, which is the option the plan rejected.

Fix: correct the prior-art note so it does not attribute the checklist idea
to the paper. Either drop the citation or cite it for what it does describe.
No credit entry was written for Nidus.
