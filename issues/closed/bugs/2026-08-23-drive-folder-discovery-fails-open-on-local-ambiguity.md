---
title: "Drive folder discovery fails open on local ambiguity"
workstream: connector-integrity
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — independent review of Drive trash tombstones
priority: normal
resolution: implemented
---

**Closed 2026-08-25** in 3051bf12: an occupied safe-name path is compared by drive-id (same id = re-mount, otherwise reported); a card with an unreadable drive-id suspends folder discovery for that run and is reported. Drive `sync()` now accumulates failures into `result.error`.

Drive folder discovery has two silent ambiguity paths.

First, two remote children can map to the same safe local card name. `syncFolder` skips the second file when its derived path already exists, without checking the existing card's Drive ID or reporting an error. The remote child remains untracked forever.

Second, `findDriveCardTracking` warns and skips an unreadable Drive card, and silently skips a card whose Drive ID cannot be parsed. If that card is a trash tombstone for a configured folder child, the ID is absent from the claimed set and the folder pass can recreate the supposedly untracked child.

Folder discovery should fail closed when local identity is ambiguous. It should report a connector failure instead of silently skipping a name collision or rediscovering while a candidate tombstone cannot be read. Add tests for colliding safe names and an unreadable or malformed trash card.
