---
title: "Agent guide omits third-party quote attribution"
workstream: source-retrieved-date
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-source-retrieved-date — field critique of research provenance
resolution: implemented
---

Implemented in the resolving commit. The agent guide now documents `from=` for
third-party words, and a passing `knows_directly` audit covers the distinction.
The existing renderer already shows the attribution in inline and block quotes.

When I record exact words from a third party, I want the rendered quote to name
the speaker, so nobody mistakes those words for the boxholder's voice.

The `{% quote %}` schema and renderer support `from=`, but the agent guide does
not document it. The guide also describes the tag as if it only applies to the
boxholder's words. An agent can therefore omit an attribution that the renderer
already knows how to show.
