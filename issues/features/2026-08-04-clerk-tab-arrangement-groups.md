---
title: "Support local Chrome tab groups in Clerk tab arrangements"
workstream: tab-organizer-clerk
needs: [design]
design: ../../callback-box/docs/plans/clerk-tab-arrangements.md
area: clerk
filed-by: agent
discovered-in: worktree-tab-organizer-clerk — simplifying the experimental tab-arrangement plan
priority: backlog
---

When my browser workspace uses local Chrome tab groups, I want to include those tabs in a Clerk arrangement, so the box can preserve or revise the organization without flattening the groups.

The first tab-arrangement version rejects a selected scope if any tab is grouped. This keeps the experiment small. It avoids the `tabGroups` permission, group identity mapping, cross-window group rules, and another mutable object in stale-state comparison.

A later design should decide:

- Whether group title, color, and collapsed state are editable or only preserved.
- How a proposal names new groups without trusting Chrome group IDs from the box.
- Whether moving part of a group is allowed.
- How Apply and Undo behave when group membership changes after sharing.
- Whether adding the `tabGroups` permission changes the extension's install or update experience.

Chrome collaborative/shared tab groups are not part of this issue. They have different trust and synchronization semantics and need a separate decision if they become relevant.

## Research (incomplete)

Verify current Chrome behavior for moving grouped tabs across windows, group deletion when its last tab moves, and permission prompts before fixing the proposal schema.
