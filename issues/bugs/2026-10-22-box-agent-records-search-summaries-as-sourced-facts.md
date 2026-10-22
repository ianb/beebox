---
title: "The box agent records web-search summaries as facts and cites pages it did not open"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — I-deciding walk, 2026-10-22
---

In the I-deciding walk the agent made 17 web searches and 8 fetches to compare washing machines. Much of what it recorded came from the search tool's own summary, and it cited a page that it did not read. Spot-checks against those pages on 2026-10-22:

- "The Good Guys includes taking the old machine away with delivery." The page says removal comes only with the premium "Delivery, unpack and remove" service. A later search by the agent said so too; the claim was not changed. It reached the chat, the notes, and the recommendation ("well under budget with removal included").
- The recommended model at $574 came from a search summary that also said the promotion had ended and "the $574 price may be out of date". The agent's fetch of the same URL returned a category list, not the product.
- Saturday delivery was recorded as "not confirmed". The cited page says delivery runs 7 days a week in most areas.
- One cited URL was never fetched and returns 404. The box's own URL check flagged it as a non-blocking warning in `.beebox/url-check.log`, and nothing showed that warning to anyone.
- "Bosch still has a good name" has no source. The walker: "based on what?"

Report: [I-deciding](../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (rows 11, 39, 40; R5, R6, R8; section "Spot-checks of recorded facts").

## Why the fix is not obvious

The agent guide's PROVENANCE section (`beebox/src/core/agent-guide/guide.md`) covers `{% source href %}`. It does not say "open a page before you cite it" or "a search summary is not the page". A rule could say: fetch the page before you record a fact from it, and mark a figure seen only in a search summary as such. A rule does not cover the case where the fetch fails (the $574 page). The URL-check warning could also reach the agent or the person. A knowledge audit could test the rule on a research task.

Related: [citation conventions and kept copies of sources](../features/2026-10-09-citation-conventions-and-kept-copies-of-sources.md), [scouring search engine](../features/2026-10-15-scouring-search-engine.md), [fetch blocked pages](../features/2026-10-04-fetch-blocked-pages.md).
