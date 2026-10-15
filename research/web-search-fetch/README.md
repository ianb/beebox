# Web search and fetch for agents (2026-10-15)

The boxholder's question (2026-10-15): the built-in WebSearch and WebFetch "work okay, but [are] blocked from a lot of sources, and when scouring it's not that good." This survey covers third-party search and fetch services and first-hand probes. It applies to agents in the dev repo and to the agent inside a box. Anchor issue: [fetch-blocked-pages](../../issues/features/2026-10-04-fetch-blocked-pages.md).

| Document | Contents |
|---|---|
| [probes-2026-10-15.md](probes-2026-10-15.md) | First-hand numbers: 15 hard URLs × 8 fetch paths; 4 scouring questions × 9 search tools; $0.35 spent |
| [search-services.md](search-services.md) | Search APIs, model-provider search, MCP servers, deep-research loops, benchmarks |
| [deep-research-reviews.md](deep-research-reviews.md) | Third-party benchmarks, citation studies and practitioner reports on research-dispatch services; Perplexity's legal status |
| [per-site-services.md](per-site-services.md) | Paid per-site data APIs (Instagram, Facebook, LinkedIn, X threads, TikTok, YouTube transcripts, Reddit, Quora) |
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

## Search budget

Claude Code caps WebSearch at 200 calls per session; a box agent sees "this session has used its web search budget (200 of 200 WebSearch calls)". The limit is the `CLAUDE_CODE_MAX_WEB_SEARCHES` environment variable. In one box's seeding pass (2026-08-30) three subagents in one session exhausted it before finishing their lists. Exa calls do not count against it.

## Facts that change the Reddit plan

Reddit announced on 2026-09-30 that RSS support ends 2026-11-13 and that public Data API access closes in phases through March 2027 ([TechCrunch](https://techcrunch.com/2026/09/30/reddit-is-killing-rss-feeds-ending-public-api-access-because-of-ai-bots/)). The `.rss` fallback proposed in the anchor issue has four weeks left. Arctic Shift ingests from Reddit, so its coverage after March 2027 is uncertain.

## Dispositions

### Search

| Option | Disposition | Reason, traced to beebox |
|---|---|---|
| Exa as a second search engine for scouring the web | **adopt** | Best freshness and forum recall in the probes. WebSearch stays for ordinary lookups; Exa is for scouring (breadth, recent posts, forums, small sites). Two ways in: the keyless hosted MCP (`https://mcp.exa.ai/mcp`, no account), or OpenRouter's `openrouter:web_search` tool with engine `exa` (about $0.01 per call on the existing `openrouter` key, [secrets.md](../../beebox/docs/secrets.md)). Unverified: keyless rate limits and Exa's retention terms ([search-services.md](search-services.md#gaps)). |
| Parallel keyless MCP | **later** | Free and fast; better for official sources than for forums. Keep as a second engine if Exa's gaps show. |
| Gemini grounding, OpenAI `web_search` | **later** | Keys are held, but they return a synthesized answer instead of a result list, and they cost more per call ($0.017–0.038). No probe result beat Exa. |
| Brave Search API | **later** | Own index, `freshness` parameter, Goggles for forum re-ranking. Needs a new account with a card. Revisit only if Exa fails a real need. |
| Dispatching a whole research project (Perplexity Sonar Deep Research on OpenRouter; Gemini Deep Research) | **reject for now** | Boxholder (2026-10-15): "These are very bad results"; the cost is prohibitive for what they accomplish. Preferred direction: accept imperfect search and grow a per-box list of places to look as results are found (mn-pottery already keeps a scan-source registry). Trial on one brief from a real box's event-collecting work (details kept in the private issue repo because they name places): Perplexity (480 s, $1.13), Gemini (430 s, about $2.50) and a Claude loop on WebSearch plus Exa (285 s, 30 searches) each found 3 of the box's 14 known in-window events, a different 3 each time. Perplexity had no unsupported citations in a sample of 12 but padded with non-ceramics rows; Gemini had 2 unsupported, both cited to Instagram profiles. Reviews ([deep-research-reviews](deep-research-reviews.md)) report weak claim support and API timeouts for Perplexity. Low overlap means a second engine adds breadth; no contender replaced the others. Perplexity is on the existing OpenRouter key. |
| SERP resellers (SerpApi, Serper, SearchAPI.io) | **reject** | Resell scraped Google results; SerpApi is a defendant in suits by Google and by Reddit. |
| DuckDuckGo html, `s.jina.ai`, Bing API, Google Custom Search | **reject** | Challenge page; needs a key; retired; closed to new customers. |

### Fetch

| Option | Disposition | Reason, traced to beebox |
|---|---|---|
| WebFetch first, a fallback route after it | **adopt** | WebFetch works for most of the open web. The fallback runs only when WebFetch refuses a host, gets a block or CAPTCHA page, or returns an empty script shell. |
| Per-host adapters as the first fallback step | **adapt** | The anchor issue said to wait for a second host. There are now five with working free routes: Reddit, X, YouTube, TikTok, Medium. Drop the Reddit `.rss` step (ends 2026-11-13). |
| Paid per-site data services (Instagram and similar) | **investigate** | Fill the per-site gaps that free routes leave ([per-site-services.md](per-site-services.md)). ScrapeCreators covers 9 of 10 target sites on one key (Instagram, Facebook, LinkedIn, TikTok, YouTube, Reddit comments, Threads, Pinterest); 100 free calls with no card, then about $47 for 25,000 credits that do not expire. Gaps: X threads (GetXAPI or twitterapi.io), Quora (Apify actors only). Supadata for YouTube transcripts from a datacenter IP. All prices are vendor claims; no service has been probed. Next step: spend ScrapeCreators' free calls on one URL per site. |
| For hosts with no adapter: curl with a Chrome UA, then Jina Reader, then a headless browser | **adapt** | Each covered pages the others missed. Jina Reader is a third party that sees every URL; it applies per-domain abuse blocks, so treat it as intermittent. |
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
- Filed [scouring-search-engine](../../issues/features/2026-10-15-scouring-search-engine.md): Exa as a second engine for scouring the web.

Boxholder input (2026-10-15): "site specific routes is very reasonable and good. There are services for things like Insta. This isn't about box search, only about scouring the web. I probably want to keep WebFetch when it works, so think about this as a fallback."
