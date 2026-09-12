---
title: "Agent documentation: a browsable, complete, public corpus a chatbot can be pointed at"
workstream: agent-docs
area: docs
filed-by: agent
discovered-by: Ian
discovered-in: main session — handoff briefing for the agent-docs workstream
labels: [soft-launch]
priority: important
---

Documentation for *agents*, distinct from the human site. The boxholder's
framing: "It will be more complete than the site (because the agent can read
and then filter down), and still hierarchical (the agent can browse). This is
the documentation that will work when you paste a prompt into your preferred
chatbot (chatgpt or whatever) and then ask it questions *about* beebox."

Constraints that follow: public stable URLs; plain markdown; an entry point
that lands in one fetch; enough structure for the model to choose what to
fetch next; completeness over curation; a hierarchy that is neither a flat
dump nor a tree too deep to reach substance.

The corpus question has a hard edge: `beebox/docs/` is internal design
material (plans cite real boxes and `private-issues/`), so publishing it
wholesale would leak. The vetting has to be an explicit act, not a per-file
re-judgement, and material that can be generated from the code should be,
so it tracks the engine instead of drifting.

Shape, corpus, vetting boundary, and the pasted prompt are worked out in
[the plan](../../beebox/docs/plans/agent-docs.md). Shares `site/`'s build
with the [public site](2026-07-20-public-site.md) workstream and the home
page with the
[container-first install](2026-09-06-container-install-is-the-primary-path.md)
prompt.
