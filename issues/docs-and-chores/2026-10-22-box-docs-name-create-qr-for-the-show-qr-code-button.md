---
title: "Box docs tell the agent to send people to \"Create QR\"; the button says \"Show QR Code (iPhone)\""
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — F-newcomer and G-paperwork walks, 2026-10-22
---

The `bbx notify` section of the box docs says to pair the iPhone app with "the profile menu, then Settings, Companion Apps, and \"Create QR\"" (`beebox/src/core/docs-gen/package-docs/bbx-commands-scheduling.ts:144`, generated into `beebox/box-docs/bbx-commands.md`). The button is "Show QR Code (iPhone)" (`beebox/src/frontend/src/components/settings/CompanionPairingSection.tsx:162`). The box agent quoted "Create QR" to the person in both walks. The F walker noticed the mismatch.

Commit `f415229f8` renamed the button on 2026-10-17. Commit `01895383f` wrote the docs line three minutes later with the old label.

Reports: [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (row 39), [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (row 38).

## Fix

Change the docs line to "Show QR Code (iPhone)" and regenerate `box-docs`. A test that each control label named in the generated docs exists in the frontend would catch the next rename; that is a larger change.
