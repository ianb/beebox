# Web search and fetch for agents (2026-10-15)

The boxholder's question (2026-10-15): the built-in WebSearch and WebFetch "work okay, but [are] blocked from a lot of sources, and when scouring it's not that good." This survey covers third-party search and fetch services and first-hand probes. It applies to agents in the dev repo and to the agent inside a box. Anchor issue: [fetch-blocked-pages](../../issues/features/2026-10-04-fetch-blocked-pages.md).

| Document | Contents |
|---|---|
| [probes-2026-10-15.md](probes-2026-10-15.md) | First-hand numbers: 15 hard URLs × 8 fetch paths; 4 scouring questions × 9 search tools; $0.35 spent |
| [search-services.md](search-services.md) | Search APIs, model-provider search, MCP servers, deep-research loops, benchmarks |
| [fetch-services.md](fetch-services.md) | Reader services, unblocking APIs, hosted browsers, per-host routes, logged-in profiles, legal posture |

All probes ran from a residential IP. A box runs on a Hetzner datacenter IP, which many sites treat worse, so every "ok" here is an upper bound for a box.

## What the probes showed

- **WebFetch refuses some hosts before it sends a request.** reddit.com, nytimes.com, wsj.com and ft.com fail with "Claude Code is unable to fetch from <host>"; x.com returns 402. WebFetch also reads only server HTML. It matched or did worse than plain `curl` on all 15 URLs.
- **No single general fetch path returned real content for more than 6 of 15 URLs.** curl with a Chrome user agent, Jina Reader (`r.jina.ai`, no key) and the headless browser each reached pages the others missed. With per-host routes added, 10 of 15 returned content. NYT, WSJ, FT, Quora and a Cloudflare challenge page had no free route.
- **Per-host routes were fast and reliable:** Reddit (Arctic Shift, `.rss`), X (`api.fxtwitter.com`, the syndication endpoint, oEmbed), TikTok and YouTube oEmbed, YouTube transcripts through `yt-dlp`, Medium author RSS. All but `yt-dlp` answered in under 1.5 s.
- **Archives did not work from a script.** archive.ph and Wayback snapshot fetches returned 429 on the first request.
- **WebSearch was weakest on freshness and forums.** It returned no Reddit URL for any of the four questions. On the "last two months" question, 0 of its results were in the window, while Exa returned 8 of 10 in the window, 5 of them Reddit threads. On the technical question it returned templated SEO pages and no GitHub repo.
- **Exa and Parallel have keyless hosted MCP servers** (`https://mcp.exa.ai/mcp`, `https://search.parallel.ai/mcp`). They returned results in 0.8–2.1 s at no cost, with no signup. Exa leaned toward recent forums and personal blogs; Parallel toward official and news pages.
- **The box has no headless browser.** `beebox/docker/Dockerfile` installs no Chromium or `agent-browser`; `deploy.sh` marks them dev-only. The anchor issue's scope note says otherwise; that note is wrong.

## Facts that change the Reddit plan

Reddit announced on 2026-09-30 that RSS support ends 2026-11-13 and that public Data API access closes in phases through March 2027 ([TechCrunch](https://techcrunch.com/2026/09/30/reddit-is-killing-rss-feeds-ending-public-api-access-because-of-ai-bots/)). The `.rss` fallback proposed in the anchor issue has four weeks left. Arctic Shift ingests from Reddit, so its coverage after March 2027 is uncertain.

## Dispositions

### Search

| Option | Disposition | Reason, traced to beebox |
|---|---|---|
| Exa keyless MCP in the dev repo | **adopt** | Zero setup; best freshness and forum recall in the probes. Queries go to Exa; dev-repo queries are not box content. Unverified: keyless rate limits and Exa's retention terms ([search-services.md](search-services.md#gaps)). |
| OpenRouter `openrouter:web_search` (engine `exa` or `parallel`) for box agents | **adapt** | Rides the `openrouter` grant a box already holds ([secrets.md](../../beebox/docs/secrets.md)); about $0.01 per call. It would join the OpenRouter rows of the egress table ([security-report.md §3](../../beebox/docs/security-report.md#3-data-egress)). A box query can carry private context, so this needs the egress row and an off switch. |
| Parallel keyless MCP | **later** | Free and fast; better for official sources than for forums. Keep as a second engine if Exa's gaps show. |
| Gemini grounding, OpenAI `web_search` | **later** | Keys are held, but they return a synthesized answer instead of a result list, and they cost more per call ($0.017–0.038). No probe result beat Exa. |
| Brave Search API | **later** | Own index, `freshness` parameter, Goggles for forum re-ranking. Needs a new account with a card. Revisit only if Exa fails a real need. |
| Deep-research APIs and loops (Gemini Deep Research, GPT Researcher) | **later** | The scouring complaint is source quality per query. A better engine under the agent's own loop addresses that first. |
| SERP resellers (SerpApi, Serper, SearchAPI.io) | **reject** | Resell scraped Google results; SerpApi is a defendant in suits by Google and by Reddit. |
| DuckDuckGo html, `s.jina.ai`, Bing API, Google Custom Search | **reject** | Challenge page; needs a key; retired; closed to new customers. |

### Fetch

| Option | Disposition | Reason, traced to beebox |
|---|---|---|
| Per-host adapters behind one `fetch` entry point | **adapt** | The anchor issue said to wait for a second host. There are now five with working free routes: Reddit, X, YouTube, TikTok, Medium. Drop the Reddit `.rss` step (ends 2026-11-13). |
| Fallback chain: curl with a Chrome UA, then Jina Reader, then a headless browser | **adapt** | Each covered pages the others missed. Jina Reader is a third party that sees every URL; it applies per-domain abuse blocks, so treat it as intermittent. |
| A headless render path in the box | **investigate** | The box has none today. [Server-side capture](../../issues/features/2026-09-11-server-side-webpage-capture.md) needs one. Options: Chromium in the image, or Cloudflare Browser Run (no unblocking; needs a Workers paid plan). |
| Logged-in persistent profile | **later** | The only route to content behind the boxholder's own accounts (including paywalled news they subscribe to). Risk lands on the real account. The [browser-task card](../../beebox/docs/implemented-plans/browser-task-card.md) already covers the logged-in case through Claude in Chrome on the boxholder's machine. |
| Archives (Wayback, archive.ph) | **reject** as a primary route | 429 on the first request. Keep the Wayback availability check as a last resort only. |
| Unblocking APIs and stealth browsers (Bright Data, Zyte, ScrapingBee, Browserbase stealth, Apify actors) | **decision for the boxholder** | See below. |

## The "no stealth or proxy" line

The anchor issue and [research/AGENTS.md](../AGENTS.md#fetching-sources) say not to use stealth-browser or residential-proxy fetchers. An agent wrote that line; the boxholder did not decide it. Facts for the decision ([fetch-services.md](fetch-services.md#tos-and-legal-posture)):

- **What it would add:** NYT, WSJ, FT, Quora, Cloudflare-challenged sites, live Reddit comment trees, and probably datacenter-IP access in general. Nothing else in this survey reaches those.
- **Cost:** cents to a few dollars a month at 300 pages. Bright Data has a 5,000-request free tier. All need an account and most need a card.
- **Legal record:** every defendant found is a commercial scraper or AI company at scale; none is an individual at personal volume. Logged-out public access has the better precedent (Meta v. Bright Data, 2024). Logged-in access and DMCA anti-circumvention claims carry the risk (Reddit v. SerpApi et al., active).
- **Other costs:** the vendor sees every URL and page fetched, which can include private links from a box. Several vendors are in active litigation and can lose service. A box's datacenter IP used for evasion can be blocked for other uses.
- **Already crossed in a small way:** a box's `capture-page` trick sends a spoofed Chrome user agent.

Lean: keep the line for boxes, where the egress and vendor-risk costs apply to box content. For the dev repo, the gap it fills is mostly paywalled news, which a logged-in profile with the boxholder's own subscriptions covers without evasion.

## Filed and amended

- Amended [fetch-blocked-pages](../../issues/features/2026-10-04-fetch-blocked-pages.md): Reddit RSS end date, the box has no headless browser, the five-host case for an adapter entry point, a link here.
- Filed [scouring-search-engine](../../issues/features/2026-10-15-scouring-search-engine.md): Exa MCP for dev agents, OpenRouter web search for box agents.
