---
title: "Codex 0.165.0 turns memory v2 on for fresh profiles; should box Codex chats keep Codex's own memory?"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Codex 0.165.0
labels: [sdk-update]
---

Codex 0.165.0 (published 2026-10-27): *"Enabled memory v2 by default for fresh
profiles and added support for importing external-agent memories into it."*
Codex memory stores notes from one thread and feeds them into later threads.

A box's Codex chat runs as that box's own user (per-box users since
2026-10-25), so its Codex home is a fresh profile. beebox's fixed Codex config
(`CODEX_FIXED_CONFIG`, `beebox/src/services/codex-binary.ts:18`) sets only
feedback and the update check. When the pin reaches 0.165.0 (settled
2026-10-29T20:09Z), every box's Codex chats start keeping memories with no
beebox setting involved.

For a person using the box:

- **Memory on (the new default):** a Codex chat can recall something said in
  an earlier Codex chat in the same box. The recall lives in Codex's home, not
  in the box's cards, so it is invisible in the box, is not in git, and is not
  shared with the box's Claude chats. Each box keeps its own memory, so nothing
  crosses boxes.
- **Memory off (pin it in `CODEX_FIXED_CONFIG`):** Codex chats behave as they
  do today; the box's cards stay the only place that carries knowledge between
  chats.

Cost: turning it off is one config key plus a check that the key name is right
for 0.165.0. Leaving it on costs nothing now.

Lean: off, so a box's knowledge stays in its cards, where the person can see
and edit it.

The sdk-update schedule will hold Codex at 0.164.0 until this is decided, and
take 0.165.0 after.

Re-reviewed 2026-10-30: the pin is held at 0.164.0 pending this call; the issue lacks `needs: [decision]` in frontmatter.
