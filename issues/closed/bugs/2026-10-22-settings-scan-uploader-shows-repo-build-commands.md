---
title: "Settings shows repository build commands for the scan uploader"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — F-newcomer walk, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct work. Decision: a person sees a command only when they are expected to enter it. The "First-time setup" block is removed; the setup command shown after minting stays. The install steps are in `scan-uploader/README.md`.

The person's Settings page has a Scan uploaders section. Its "First-time setup on a new machine" block shows `git clone <repo>` and `pnpm install --filter scan-uploader...`, and tells the reader to build `scan-uploader/dist/scan-uploader.mjs` with pnpm (`InstallInstructions`, `beebox/src/frontend/src/components/settings/ScanUploaderSection.tsx:74-92`). These are instructions for a developer with a checkout of the repository.

The F-newcomer walker opened Settings to find notifications and read it as "developer language, completely off-putting for someone who just wants reminders". The 2026-10-09 F walk also noted the "Mint a token … configure" text.

Report: [F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (rows 26, 55).

## Why the fix is not obvious

The steps are real and someone has to find them. Options: show the install steps only to an operator; or move them to a document that the section links to, and keep the person-facing text to what a scanner does for them.
