---
title: "The agent guide says a dismissed question means the boxholder didn't care; the question card says it was put away for now"
workstream: agent-changelog
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-agent-changelog — a curator rehearsal over the week's landings
resolution: wontfix
---

**Closed (wontfix, 2026-11-01):** Boxholder, 2026-11-01: "Often questions I don't answer are ones I don't care about." The guide's reading stands beside the card's.

`beebox/src/core/agent-guide/guide.md:299` says: "A dismissal or expiry means the
boxholder didn't care to answer that, so raise the bar before asking again."

`beebox/src/schemas/question.ts:196` says a dismissed question is "put away for
now (Later), by the person or by Decide for me. Still answerable later." Line 197
says of expiry that it "demotes visibility, it does not close the question."

The `front-door` work (2b85087bf) changed the meaning of dismissal, and the guide
kept the old one. An agent that follows the guide can treat a question the person
put off as one they do not care about.
