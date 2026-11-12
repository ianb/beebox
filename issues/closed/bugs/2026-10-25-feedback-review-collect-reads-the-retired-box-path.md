---
title: "feedback-review/collect.ts reads boxes at the retired single-user path as the hub user"
workstream: box-isolation-followups
area: tooling
filed-by: agent
discovered-by: agent
discovered-in: box-isolation — retiring the single-user server layout, 2026-10-25
labels: [deploy, server, feedback-review]
resolution: implemented
---

**Closed 2026-10-27 (box-isolation-followups).** The boxholder wants the tool
kept. `collect.ts` lists the server's boxes from `hub.json` as `beebox` and
scans, reads and resolves each box as `bbx-<slug>` (`runOnServer`'s new
`boxUser(slug)`). A box root its user cannot reach fails the scan. Tested
against a fake `ssh`; not yet run against production.

`feedback-review/collect.ts` finds and reads each box's `_config/feedback/`
files on the server with `REMOTE_BOXES_DIR = "/home/beebox/boxes"`, through
`runOnServer`, which drops to the `beebox` user. On the server boxes now live
at `/var/lib/beebox/<slug>/box`, each private to its own user `bbx-<slug>`
(`0700` inside the home); the hub user cannot read them. The collector finds
nothing and reports no feedback.

A fix needs two things: the new root with the `<slug>/box` shape, and reading
each box as its own user (root, then `su - bbx-<slug>`), since no single
account can read every box any more. `run-on-server.ts`'s `asUser` is a fixed
account, so the per-box step needs a different shape. Whether the tool is
still wanted is a question first: its last change was 2026-10-09, and the
boxes' feedback files may have another reader by now.

Where: `feedback-review/collect.ts:28`, `feedback-review/collect.ts:150-190`,
`feedback-review/run-on-server.ts`; the layout is `docs/server/provisioning.md`
("Server layout").
