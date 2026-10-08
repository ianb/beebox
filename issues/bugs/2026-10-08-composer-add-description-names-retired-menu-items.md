---
title: "The composer's Add button describes menu items that no longer exist"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walk, 2026-10-08
---

The composer's Add button carries an agent-facing description:

`data-bbx-does`: "opens the attach menu — capture, attach file, upload files, send screenshot, share location"
(`beebox/src/frontend/src/components/chat/InteractiveChat-composer/view.tsx:273`).

The menu itself offers "Capture…", "Add files…", "Send screenshot…" and "Share
location" (`:294`). The "attach file" and "upload files" items were merged into
"Add files…" on 2026-08-25. The description was not updated.

In the first B-inventory walk the box agent told the walker to use "attach
file" and "upload files", copying the description. In the second walk the
agent named no controls, so the stale text had no effect; the code still
carries it.

Related and closed, a different defect:
[agent instructions primed a wrong control name](../closed/docs-and-chores/2026-09-21-chat-agent-instructions-prime-wrong-control-name.md).
See also [composer attach UX](2026-08-08-chat-composer-attach-ux.md).

Reports: [B](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (row 11),
[B2](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (R7).
