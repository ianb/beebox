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

Two routes, from the [survey](../../research/web-search-fetch/README.md#search):

- **Dev repo:** register Exa's hosted MCP server (`https://mcp.exa.ai/mcp`) for
  agents in this checkout. No account. Check its keyless rate limit and
  retention terms first.
- **Box:** OpenRouter's `openrouter:web_search` server tool with engine `exa`
  (or `parallel`), on the `openrouter` grant the box already holds, about
  $0.01 per call. A box query can carry private context, so this needs an
  egress-table row and a per-box off switch.

Open questions: whether agents need guidance on when to use the new tool
instead of WebSearch, and whether one probe run (four questions, single runs)
is enough evidence or a larger comparison should come first.
