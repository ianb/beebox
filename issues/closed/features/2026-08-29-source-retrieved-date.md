---
title: "External source citations need a retrieval date"
workstream: source-retrieved-date
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-source-retrieved-date — field critique of research provenance
resolution: implemented
---

Implemented in the resolving commit. External source tags now accept and render
an optional, validated `retrieved="YYYY-MM-DD"` attribute. The agent guide and a
passing `knows_directly` audit teach agents to use it.

When I gather a fact from an external website, I want to record when I checked
the page, so a later reader can judge how current the fact is.

The `{% source %}` tag accepts an external `href`, but it cannot record the date
that the agent retrieved the page. Research briefings can require a source and
check date for every fact, but the card syntax cannot preserve both facts in one
citation.
