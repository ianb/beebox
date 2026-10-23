---
title: "A web chat's husk card is written and never committed"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — G-paperwork and I-deciding walks, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. The husk is committed with the session's usage manifest after each turn (titled, untitled, or below the title gate), on mark-done, and by the nightly review for the sessions it reviewed.

After the 2026-10-22 journey walks, `git status` in the walk boxes showed `?? _content/chat/web/`. The I-deciding report found it in six of seven boxes; in the seventh (F-newcomer) the box agent had staged it by chance.

`ensureChatHusk` (`beebox/src/core/chat/husk.ts:89`) writes the `chat` card when a session id is assigned. Nothing in that path commits it. The chat-review run commits only the usage manifest and says so: "husk writes are not committed here" (`beebox/src/core/chat/review/run/core.ts:228-232`). The husk lands in git only when an agent runs a broad `git add`. On 2026-10-09 the A-lending husk was committed only because `bbx trick` swept the tree.

Reports: [G-paperwork](../../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (R3), [I-deciding](../../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (R10).

## Why the fix is not obvious

The husk changes several times in a session (title, status), and each commit takes the box git lock. Options: commit on creation and on each status change; or commit with the session's usage manifest, as the closed [manifest fix](2026-10-09-chat-title-run-leaves-usage-manifest-uncommitted.md) does. Not checked on a ticked box: a scheduled job with a broad `git add` may hide this in normal use.
