---
title: "Try searxng-ai-kit: SearXNG as a local CLI and MCP server for agent web search"
workstream: unattached
area: dev-tooling
labels: [web-search]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

[searxng-ai-kit](https://github.com/nikvdp/searxng-ai-kit) packages the
SearXNG metasearch engine as a stand-alone CLI, a Python library, and an MCP
server for coding agents. It runs SearXNG in the calling process from a
prebuilt binary (Linux and macOS), so there is no SearXNG server to host. It
also has an "AI research" mode that sends results to a model.

Repository facts on 2026-10-18: created 2025-06, last push 2026-05-01, 41
stars, **no license file** (GitHub reports `license: null`). Without a
license we cannot redistribute or vendor it; local trial use is the limit
until that changes.

## Why look at it

[Add an agent search engine](../features/2026-10-15-scouring-search-engine.md)
found that WebSearch misses recent forum posts and repos, and proposed Exa as
a second engine. The
[search survey](../../research/web-search-fetch/search-services.md#searxng)
rated self-hosted SearXNG as free and private, but noted that upstream
engines (Google especially) block server IP addresses. A local CLI changes
that trade: on a laptop the queries come from a residential IP address, and
the agent can pick engines per query (for example Reddit, Hacker News,
GitHub).

## Questions

- Run the same four scouring questions as
  [the 2026-10-15 probes](../../research/web-search-fetch/probes-2026-10-15.md)
  through its CLI and MCP server. Compare against WebSearch and Exa on the
  same measures: results in the time window, Reddit and forum hits, GitHub
  repos, latency.
- Which engines answer from the laptop, and which fail with CAPTCHA or rate
  limits? Does the same hold from the production server's IP address?
- What does the MCP server expose, and does the "AI research" mode call a
  model with its own key? We only need plain search; check that plain search
  sends nothing to a model.
- Binary provenance: how the release binaries are built, and whether to run
  one or build from source.
- Fit: a dev-repo tool only, or something a box could use? A box runs on the
  server, where the IP blocking applies.

## Limits

Trial only. Do not install it in a box or on the server, and do not vendor
it, until the license question is settled.
