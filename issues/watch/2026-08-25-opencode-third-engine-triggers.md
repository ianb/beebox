---
title: "OpenCode as a third box engine — re-evaluate when these upstream triggers land"
workstream: research-opencode
area: callback-box
---

[research/opencode/engine.md](../../research/opencode/engine.md) (2026-08-25, v1.18.23)
sized an OpenCode adapter at roughly the Codex adapter's size and dispositioned it
*later*. What it would buy over Codex: same-turn validator feedback via an in-process
`tool.execute.after` plugin, USD cost per message, richer transcripts, first-party
ChatGPT-subscription auth.

Re-check when any of these fires:

- **Caller-chosen session id at the HTTP/SDK boundary.** anomalyco/opencode#2159 is
  marked complete but only the internal `createNext` takes `id`; `Session.CreateInput`
  and the generated SDKs don't. Trigger: `id` appears in the v2 `session.create` body.
- **Storage settles.** anomalyco/opencode#34445 (migration data loss) closes and a
  release goes by without session-schema migrations.
- **API consolidation.** Structured output (`format`) lands on the v2 `session.prompt`,
  or v1 is removed, so an adapter no longer straddles both.
- **Permission ask gets a timeout** or a documented headless policy, so unattended runs
  don't need a defensive auto-responder.
- **Claude subscription OAuth becomes first-party** (today: community plugin only).
