---
title: "Agents cannot read Reddit links: add a fetch path that works without the closed Reddit API"
workstream: unattached
area: dev-tooling
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder shared a Reddit thread to review
---

The boxholder shares Reddit threads for agents to review. On 2026-10-04 every
default fetch path failed for one thread, so agents need a dedicated route.

## Research (2026-10-04)

Tested against one r/ClaudeAI thread:

| Path | Result |
|---|---|
| Page or `.json` over plain HTTP | 403 "blocked by network security" |
| `api.reddit.com` | 403 |
| `bin/browse` (headless Chrome) | same block page |
| r.jina.ai reader proxy | 403 passed through |
| Claude in Chrome | reddit.com is on the extension's own blocklist |
| Wayback Machine | no snapshot |
| `https://www.reddit.com/r/<sub>/comments/<id>/.rss` | **200**, Atom feed with post and comments; returned 429 after about three requests |
| Arctic Shift `api/posts/ids?ids=<id>` and `api/comments/tree?link_id=<id>` | **200**, post and the full comment tree (104 comments), no key |
| `i.redd.it` images | 200 |

Background, from reporting (not verified first-hand): Reddit started returning
403 to unauthenticated `.json` requests broadly around 2026-05-30. Since the
Responsible Builder Policy (2025-11), the self-serve "create app" path no
longer issues OAuth credentials. API access is a manually reviewed request,
with a reported 2–4 week wait, and small projects are often refused. Treat
the official API as unavailable.

Arctic Shift is a third-party archive. Caveats: it captures at ingest, so
scores and comment counts are stale (score 1, 0 comments for this thread);
removed post text is missing; and the service can change or stop. The `.rss`
feed is Reddit's own, but it rate-limits quickly.

Not recommended: paid scraping services and "stealth browser + residential
proxy" fetchers. They work by evading Reddit's bot detection.

Untested: a persistent `bin/browse` profile that the boxholder logs into once
by hand. The block page offers login as a way through.

## Proposal

A `bin/fetch-reddit <url>` dev tool that prints the post and an indented
comment tree as text, and saves linked `i.redd.it` images:

1. Arctic Shift first (one request each for the post and the tree).
2. Fall back to the `.rss` feed, one request, honoring 429 with a single
   delayed retry, then fail with a clear message.
3. Tell agents in one line of dev guidance to use it for reddit.com links.

Open question: whether this belongs to a general `bin/fetch` that routes
known-hostile hosts to adapters. Do not build that until a second host needs
it.
