---
title: "Agents' web search misses recent forum posts and repos: add an agent search engine"
workstream: unattached
area: dev-tooling
filed-by: agent
discovered-by: Ian
discovered-in: worktree-web-search-fetch — survey of web search and fetch services
---

Claude Code's WebSearch is the only search tool for agents in the dev repo and
in a box. In probes on 2026-10-15 it returned no Reddit URL for any of four
scouring questions. On a "last two months" question none of its results fell
in the window. On a technical question it returned templated SEO pages and no
GitHub repo. Exa's keyless MCP server returned 8 of 10 results in the window
on the same question, 5 of them Reddit threads, in about 2 s at no cost.
Numbers and method: [probes](../../research/web-search-fetch/probes-2026-10-15.md).

WebSearch stays for ordinary lookups. Exa would be a second engine agents
reach for when scouring: breadth, recent posts, forums, small sites. Two ways
in, from the [survey](../../research/web-search-fetch/README.md#search):

- Exa's keyless hosted MCP server (`https://mcp.exa.ai/mcp`). No account.
  Check its rate limit and retention terms first.
- OpenRouter's `openrouter:web_search` tool with engine `exa`, on the existing
  `openrouter` key, about $0.01 per call.

Related: Claude Code caps WebSearch at 200 calls per session
(`CLAUDE_CODE_MAX_WEB_SEARCHES`). A box's seeding pass on 2026-08-30 had three
subagents exhaust it. Exa calls do not count against it. Decide whether box
runs should raise the cap.

Open questions: what guidance tells an agent when to scour with Exa instead
of WebSearch, and whether one probe run (four questions, single runs) is
enough evidence or a larger comparison should come first.
