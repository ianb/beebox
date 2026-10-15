# Search services for agents: survey (2026-10-15)

Desk research. No sign-ups, no spend, no code. Prices were read from vendor pages on 2026-10-15 unless marked. "Unverified" means a secondary source only, or no source found. Benchmarks are vendor-run unless stated.

Scope: third-party SEARCH and "deep research" services for Bee Box agents. A sibling note covers fetch/scrape/reader services. The boxholder complaint is weak breadth, freshness and long-tail coverage when scouring. The boxholder weights zero extra setup very heavily, so options that ride on keys the box already holds (OpenRouter, Gemini, OpenAI, Mistral) are called out first.

## Summary of decision-relevant points

- Four routes need no new vendor account: OpenRouter `openrouter:web_search` server tool (engines Exa, Parallel, Perplexity, native), Gemini Google Search grounding, OpenAI Responses `web_search`, Mistral Agents/Conversations `web_search`. Details in the table and sections.
- OpenRouter is the widest zero-setup route. One OpenRouter key gives Exa ($7/1k), Parallel ($1-5/1k) and Perplexity ($5/1k) search with no separate signup. The older `:online` suffix and `web` plugin are deprecated in favor of the server tool.
- Google's own results are only reachable through Gemini grounding ($14/1k queries on Gemini 3+). Grounded output carries ToS limits on caching and reuse.
- Bing Search API is retired (2025-08-11). Google Custom Search JSON API is closed to new customers and ends 2027-01-01.
- Independent-ish benchmarks put Perplexity, Parallel, Exa, Brave, You.com and OpenAI web search within about 6 points of each other (74-80). Vendor spread is small relative to configuration spread. No benchmark measures forum/long-tail recall directly.

## Comparison table

| Option | Index | Price per 1k | Free tier | Setup | Content returned | Privacy | ToS note |
|---|---|---|---|---|---|---|---|
| OpenRouter `openrouter:web_search` (engine auto/native/exa/parallel/perplexity/firecrawl) | Depends on engine | Exa $7 (deep $12-15); Parallel $1 or $5; Perplexity $5; native passes through; plus tokens | None stated | Existing OpenRouter key | Citations/annotations; `max_results` default 5 | Unverified | Engine-specific |
| Gemini grounding with Google Search | Google | $14 per 1k queries (Gemini 3+), 5,000/month free pooled; $35 per 1k grounded prompts on 2.5 | 1,500 RPD (2.5, paid) or 500 RPD (2.5 Flash free); 5,000/month (3+) | Existing Gemini key | Model answer with grounding metadata, not raw results | Google API terms | Terms bar caching, reselling, analyzing grounded results; show only to the requesting user |
| OpenAI Responses `web_search` | OpenAI (provider not named) | $10 per 1k calls plus search tokens; preview non-reasoning $25 | None stated | Existing OpenAI key | Answer with citations; page open/find actions on reasoning models | ZDR link only; unverified | Standard OpenAI terms |
| Mistral `web_search` / `web_search_premium` | Unnamed | Reported $30 per 1k calls (third-party only); premium news reported $50 | Free plan "limited web searches" | Existing Mistral key | Answer with reference chunks | Unverified | Unverified |
| Anthropic `web_search` server tool | Brave (reported; see below) | $10 per 1k searches plus tokens | None | Anthropic API key (Messages API) | Encrypted content, title, URL, page_age; cited_text up to 150 chars | Basic versions ZDR-eligible; dynamic filtering versions are not | Standard Anthropic terms |
| Exa | Own index (not described in docs) | $4 instant; $7 fast/auto; $12 deep-lite/deep; $15 deep-reasoning; contents $1 per 1k pages | $10 credit at signup, resets monthly to $10; no card | New account | Highlights, text, summary, subpages | ZDR on enterprise only | Own index; no scraper concern |
| Tavily | Unverified (aggregates) | $8 per 1k basic (1 credit at $0.008); $16 advanced | 1,000 credits per month, no card | New account | Snippets; optional raw content | ZDR claim unverified | Acquired by Nebius (announced 2026-02) |
| Brave Search API | Own index (30-40B pages, company claim) | $5 per 1k Search; Answers $4 per 1k plus tokens | $5 credit per month | New account, card required (identity check) | Snippets; LLM Context returns extracted chunks | ZDR on Enterprise | Own index; storing results needs storage-rights plan |
| Perplexity Search API | Own (claim not verified on fetched page) | $5 per 1k; fast $1 | Unverified | New account | Title, URL, snippet, date; page content up to `max_tokens` | Sonar API ZDR policy (primary source) | Perplexity faces a Reddit scraping suit |
| Perplexity Sonar / Pro / Deep Research | Same | Sonar $1/$1 per M tokens plus $5-12 per 1k requests; Sonar Pro $3/$15 plus $6-14; Deep Research $2/$8 plus $5 per 1k queries and citation/reasoning tokens | Unverified | New account (or via OpenRouter) | Synthesized answer plus citations | ZDR policy | Same |
| Kagi Search API | Kagi (own plus aggregated; unverified) | $12 per 1k search; $4 per 1k extract | Trial plan, amount not stated | Kagi account | Results with snippets | Unverified | Documented commercial API |
| Serper | Google (reseller via scraping) | $1.00 to $0.30 per 1k | 2,500 free queries | New account | Google SERP JSON | Unverified | Scrapes Google. ToS-gray |
| SerpApi | Google/Bing etc. (scraping) | $25 to $2 per 1k by plan; $15 at 5,000/mo | 250 per month | New account | SERP JSON | Unverified | Scrapes Google. Google sued SerpApi 2025-12-19 |
| SearchAPI.io | Google etc. (scraping) | $4 down to $1 per 1k | 100 requests | New account | SERP JSON | Unverified | Scrapes Google. ToS-gray |
| Parallel Search | Own index (company claim) | Turbo/Fast $1; Basic/Advanced $5; +$1 per 1k extra results | Up to 5,000 requests per month per pricing page | New account; MCP works anonymously | Excerpts, optional full content | Unverified | Own index |
| Linkup | Own index (page implies; unverified) | $5 standard; $50 deep (results only) | $20 credit with professional email | New account | Results or sourced answer | ZDR on Enterprise | Unverified |
| You.com | Own index (unverified) | $5 per 1k Standard | $100 credit (20,000 searches); MCP 100/day keyless | New account | Highlights/snippets | ZDR claim on page (unverified) | Unverified |
| Jina s.jina.ai | Unverified | Token-based; about 10,000 tokens per search (unverified) | 10M tokens one-time, non-commercial (unverified) | New account | Search results with page content | Unverified | Jina acquired by Elastic (2025-10) |
| Google Custom Search JSON | Google | n/a | n/a | Closed to new customers | n/a | n/a | Ends 2027-01-01 |
| Bing Search API | Bing | Retired 2025-08-11 | n/a | n/a | n/a | n/a | Replaced by Grounding with Bing in Azure AI Agents |
| DuckDuckGo (ddgs) | DDG (scraping) | Free | Free | pip package | Snippets | n/a | Unofficial; rate-limited; project says not for commercial use |
| SearXNG self-hosted | Meta-search over upstream engines | Free (hosting) | n/a | Self-host | Snippets | Stays on your host | Upstream engines block server IPs; Google often fails |
| Mojeek | Own index | GBP 2 / 3 per 1k (Startup/Business) | Free credit on Startup | Bank card to open account | Title, URL, snippet | 90-day standard retention; ZDR on request | Own index; AI use listed as included |
| Marginalia | Own small-web index | Free non-commercial key by email | Yes | Email request | Results | Unverified | AGPL; narrow index |

## Zero-setup routes (keys the box already holds)

### OpenRouter (key held)
- The `web` plugin and `:online` suffix still work as shorthand, but the page marks the plugin deprecated and points to the `openrouter:web_search` server tool. `:online` equals `model: openrouter/auto` plus `plugins:[{id:"web"}]`.
- Engines: `auto` (native when the provider has it, else Exa), `native`, `exa`, `parallel`, `perplexity`, `firecrawl` (bring your own Firecrawl key).
- Prices per request on OpenRouter: Exa instant/fast/auto $0.007, deep-lite/deep $0.012, deep-reasoning $0.015; Parallel turbo/fast $0.001, basic/advanced $0.005; Perplexity $0.005; extra results beyond 10 cost $0.001 each. Search is billed on top of tokens, including for free models.
- With the server tool the model decides when to search, zero to many times, and `max_total_results` caps the total. The plugin searched once per request.
- Domain filters: Exa include and exclude together; Parallel, Perplexity and Anthropic native take one at a time; Google native has none and returns 400 if forced; OpenAI native ignores exclude silently.
- Freshness controls are not listed on the page. Use an engine through OpenRouter and the model's query wording. Unverified whether date filters pass through.
- Setup cost: none beyond the existing key. Per-call cost is about 1.4x Anthropic/OpenAI native at the Exa tier, and lower at the Parallel tier.
- Source: https://openrouter.ai/docs/guides/features/server-tools/web-search and https://openrouter.ai/docs/guides/features/plugins/web-search

### Gemini grounding with Google Search (key held)
- Source of Google results with no SERP-scraping risk. Output is an answer plus grounding metadata, not a result list.
- Pricing: Gemini 3 and newer, 5,000 requests per month free (pooled), then $14 per 1k queries. Gemini 2.5 models, $35 per 1k grounded prompts after 1,500 RPD. One request can fire several queries and each is charged. Source: https://ai.google.dev/gemini-api/docs/pricing
- Terms: per a Parallel article (competitor), the Gemini API terms bar caching, framing, syndicating, reselling, analyzing or training on grounded results, and require showing them only in an app you own to the requesting user. Check the Gemini API terms directly before building a stored research corpus. Source: https://parallel.ai/articles/why-ai-agents-cant-just-use-google-search.md
- No domain filter. Recency control is by prompt only.
- Gemini Deep Research (see deep research section) uses this tool by default.

### OpenAI Responses API `web_search` (key held)
- $10 per 1k calls plus search content tokens at model rates. Preview non-reasoning models $25 per 1k. `gpt-5-search-api` costs $1.25/$10 per M tokens. Source: https://developers.openai.com/api/docs/pricing
- `filters.allowed_domains` or `blocked_domains` up to 100 each, Responses API only. Reasoning models get `open_page` and `find_in_page` actions. `search_context_size` low/medium/high. `external_web_access:false` gives cache-only. No recency filter on the page. Source: https://developers.openai.com/api/docs/guides/tools-web-search
- Chat Completions search models (`gpt-4o-search-preview`) are deprecated, shutdown 2026-07-23 (already past).
- Backing index not named. Unverified.
- Artificial Analysis scored it 74 at $40.19 search cost per 1k tasks (see benchmarks).

### Mistral web search (key held)
- Built-in connector `web_search` and `web_search_premium` (adds news provider verification). Works in the Agents API and Conversations API only. Not in Chat Completions. Backing engine not named. Source: https://docs.mistral.ai/agents/tools/built-in/websearch
- Price: $30 per 1k calls and $50 for premium news appear only in third-party pages (e.g. https://curlscape.com/blog/mistral-api-pricing-2026). Mistral's pricing page says only "tool APIs are priced per call" with no rate (https://mistral.ai/pricing). Treat as unverified.
- Highest per-call cost of the four routes, and needs an agent/conversation object rather than a plain call.

### Anthropic `web_search` server tool
- Needs an Anthropic API key and a Messages API call. It does not apply to a Claude Code subprocess that uses only subscription auth. Unverified whether Claude Code's built-in WebSearch calls this tool; the presence of a "WebSearch" tool in Claude Code suggests it does.
- $10 per 1k searches plus tokens. Versions: `web_search_20250305` (basic), `_20260209` (dynamic filtering via code execution), `_20260318` (adds `response_inclusion`). `max_uses`, `allowed_domains` or `blocked_domains` (one only; subpaths allowed; no wildcard in the domain), `user_location`. Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- ZDR: basic versions eligible; `_20260209` and later are not unless `allowed_callers:["direct"]`. Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools
- Index: Brave Search is listed as an Anthropic subprocessor (Simon Willison, 2025-03-21: https://simonwillison.net/2025/Mar/21/anthropic-use-brave/). A 2026 blog claims a second provider, turbopuffer (https://xponent21.com/insights/claude-web-search-brave-turbopuffer/). Unverified.
- Implication: the current WebSearch weakness may be a Brave-backed index with a small result count per query. Unverified.

## Per-option sections

### Exa
- Own index; neural/semantic search. Search types instant, fast, auto, deep-lite, deep, deep-reasoning; `additionalQueries` up to 10 for deep types.
- Pricing: $4 instant, $7 fast/auto, $12 deep-lite/deep, $15 deep-reasoning per 1k, 10 results included, +$1 per 1k extra results; contents $1 per 1k pages per type; Answer $5 per 1k; Agent endpoint $0.012 to $1.00 per request by effort. Free: $10 credit, no card, resets monthly. Enterprise adds ZDR. Source: https://exa.ai/pricing
- Filters: `startPublishedDate`/`endPublishedDate`, `includeDomains`/`excludeDomains` (1,200 entries, wildcards), `category` (company, publication, news, personal site, financial report, people). `maxAgeHours` sets crawl freshness (0 = always live). Source: https://exa.ai/docs/reference/search
- Returns text, highlights, summaries, subpages. Strong date and domain control suits "recent posts on small blogs".
- MCP: official hosted `https://mcp.exa.ai/mcp`, keyless rate-limited use, OAuth or API key. Tools `web_search_exa`, `web_fetch_exa`, optional `web_search_advanced_exa`, `agent_run`. Source: https://exa.ai/docs/reference/exa-mcp
- Exa's separate Research API (/research/v1) is reported deprecated 2026-05-01 in favor of search `deep-reasoning` (Parallel article; unverified from Exa).
- Privacy: only Exa marketing claims "never retains data"; ZDR is listed under enterprise. No training statement found. Unverified.

### Tavily
- Aggregator-style; index ownership unverified. Acquired by Nebius, announced 2026-02-10, reported $275M; brand to continue. Source: https://nebius.com/newsroom/nebius-announces-agreement-to-acquire-tavily-to-add-agentic-search-to-its-ai-cloud-platform
- Credits: $0.008 each pay-as-you-go; basic/fast/ultra-fast search 1, advanced 2; extract 1 per 5 URLs; research 4-250 credits. Free: 1,000 credits per month, no card. Project plan $30 for 4,000 credits. Sources: https://www.tavily.com/pricing, https://docs.tavily.com/documentation/api-credits
- Filters: `time_range`, `start_date`/`end_date`, `topic` general/news/finance, `include_domains` (300) with `prefer` or `restrict` mode, `exclude_domains` (150), `include_raw_content`. Source: https://docs.tavily.com/documentation/api-reference/endpoint/search
- MCP: official, remote `https://mcp.tavily.com/mcp/`, OAuth works with Claude Code. Source: https://docs.tavily.com/documentation/mcp
- Reception: AIMultiple ranked it fifth of eight (13.67), statistically behind Brave only. Privacy and SOC 2 claims came from an unverified comparison site.

### Brave Search API
- Own index (company claim: 30-40B pages, 100M page updates daily). Source: https://brave.com/search/api/
- $5 per 1k Search, 50 QPS, $5 free credit per month. Card required as an anti-fraud step, not charged on free use. Answers $4 per 1k plus $5 per M tokens. Enterprise has ZDR. Storing results needs a plan with storage rights.
- LLM Context endpoint returns extracted page chunks with token budget (default 8,192 tokens, max 32,768), `freshness` (pd, pw, pm, py, or a date range), and Goggles for custom re-ranking (restrict, exclude user-generated content, boost domains). Source: https://api-dashboard.search.brave.com/documentation/services/llm-context
- Official MCP server exists (Glama lists it as Official; repo URL not verified).
- Goggles is the only per-query re-rank control found in this survey. It could favor forums by boosting them.

### Perplexity (Search API, Sonar, Deep Research)
- Search API: $5 per 1k, fast $1 per 1k, no token charges; `max_results` 1-20, up to 5 queries per request billed as one, domain allow or deny list (20), language filter, `max_tokens` content budget. Recency and date filters were not visible on the page read. Source: https://docs.perplexity.ai/guides/search-quickstart, https://docs.perplexity.ai/guides/pricing
- Sonar: $1/$1 per M tokens plus request fee $5-12 per 1k by context size. Sonar Pro $3/$15 plus $6-14. Sonar Deep Research $2/$8, citations $2, reasoning $3 per M, searches $5 per 1k. Agent API tool prices: web search $0.0025 per call.
- Privacy: stated Zero Data Retention policy for the Sonar API, no training on customer data (primary: https://docs.perplexity.ai/docs/resources/privacy-security.md).
- Also reachable through OpenRouter at $5 per 1k.
- Legal: Reddit's DMCA claims against Perplexity and SerpApi largely survived dismissal on 2026-07-31 (per Parallel article; competitor source).
- Official MCP: not confirmed in this survey.

### Kagi Search API / FastGPT
- Search $12 per 1k, Extract $4 per 1k pages; pay-as-you-go. Source: https://kagi.com/api/pricing. Other APIs: Enrichment, Universal Summarizer (not in v1 yet), FastGPT (price not on the page; a third-party tracker lists $15 per 1k, unverified). Source: https://help.kagi.com/kagi/api/overview.html
- Third-party pages disagree on Search price ($2.50 to $25); the vendor page figure is $12.
- Official MCP: `https://mcp.kagi.com/mcp` with Bearer key, or `uvx kagimcp` (per mcp.so listing; unverified against Kagi docs).
- Kagi is known for downranking SEO spam and its Small Web index. Whether the API exposes Lenses or Small Web results is unverified.

### SerpApi, Serper, SearchAPI.io (SERP scrapers)
- All three return Google (and other engines') result pages obtained by scraping. Treat as ToS-gray: Google's terms prohibit automated access, and Google filed suit against SerpApi on 2025-12-19. The court dismissed Google's DMCA claims on 2026-07-20 with leave to amend; Google refiled, hearing 2026-10-13 (Parallel article, competitor source). The ruling concerned copyright, not Google's ToS. Source: https://www.gigazine.net/gsc_news/en/20260723-google-loses-lawsuit-against-serpapi
- SerpApi: free 250 per month; $75 for 5,000 ($15 per 1k); Legal Shield (up to $2M coverage) from the $150 tier. Source: https://serpapi.com/pricing
- Serper: 2,500 free queries; $50 for 50k ($1.00 per 1k) down to $0.30. Page contradicts itself on card requirement. Source: https://serper.dev
- SearchAPI.io: 100 free; $40 for 10k ($4 per 1k) down to $1. Source: https://www.searchapi.io/pricing
- Return snippets and SERP features only; no page content. Good Google freshness filters (tbs). The user gets real Google ranking, which is the main reason to accept the risk.
- AIMultiple ranked SerpApi last of eight (12.28) on relevance; SerpApi is a subscriber to AIMultiple's services (disclosed).

### Parallel
- Search API: Turbo/Fast $1, Basic/Advanced $5 per 1k (10 results), Extract $1 per 1k, Task API $5 (Lite) to $2,400 (Ultra8x) per 1k, FindAll per match. Up to 5,000 free requests per month stated; card requirement not stated. Source: https://parallel.ai/pricing
- MCP: `https://search.parallel.ai/mcp`, anonymous free tier, optional Bearer or OAuth. Tools `web_search` (objective plus 2-3 queries), `web_fetch` (up to 20 URLs). Source: https://docs.parallel.ai/integrations/mcp/search-mcp
- Cheapest per-call route to a search API from this list, and reachable through OpenRouter at $1-5 per 1k.
- Own index claimed by Parallel; unverified independently.

### Linkup
- $0.005 per standard search, $0.05 deep; $20 credit for professional-email accounts, topped up monthly. ZDR on Enterprise. Source: https://docs.linkup.so/pages/documentation/development/pricing and https://linkup.so/pricing
- Index ownership not stated. Official MCP not confirmed. Scored 48.3% on the openbenchmarks coding-agent board (below).

### You.com
- Search $5 per 1k Standard; $100 free credit; Research API tiers $12 (Lite), $50 (Standard), $100 (Deep), $450 (Exhaustive), $1,200 (Frontier) per 1k. Free MCP tier: 100 queries per day with no key. Source: https://you.com/docs/pricing
- Scored 74 on Artificial Analysis Search Index (highlights).

### Jina s.jina.ai / DeepSearch
- Elastic completed the Jina acquisition in 2025-10. A third-party tracker says Search Foundation APIs continue unchanged. Official confirmation for s.jina.ai not found. A source says the pricing page returned 404 in 2026-08. Source: https://secure.businesswire.com/news/home/20251009619654/en/
- Token-priced: reportedly $0.05 per M tokens after a one-time 10M free grant (non-commercial); about 10,000 tokens per search (unverified). Treat as unverified and low priority.

### Google Programmable Search / Vertex
- Custom Search JSON API closed to new customers; ends 2027-01-01. New engines since 2026-01-20 are limited to "Sites to search" (50 domains). Google's successor is Vertex "Agent Search" for own-data grounding, not whole-web. A Web Search Service API with whole-web results needs a partner agreement and returns at most 20 results (unverified details; Parallel article). Sources: https://brave.com/learn/google-api-shutdown/ (Brave, competitor), https://parallel.ai/articles/why-ai-agents-cant-just-use-google-search.md
- Not an option for new use.

### Bing
- Bing Search APIs retired 2025-08-11. Microsoft's replacement is Grounding with Bing Search inside Azure AI Agents. Price reports conflict ($14 vs $35 per 1k); not confirmed from Microsoft. Grounding output is not for reuse in other applications (Parallel article). Source: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
- Not an option without an Azure agent setup.

### DuckDuckGo (ddgs)
- Unofficial scraper library. Rate-limited server-side (HTTP 202/429). The project states it is for educational use and not for use violating DuckDuckGo's terms. No SLA. Usable as a free fallback only. Sources: https://www.sourcepulse.org/projects/1832662, https://github.com/FoundationAgents/MetaGPT/issues/1567

### SearXNG
- Self-hosted meta-search. JSON endpoint `/search?q=...&format=json`; the limiter is off by default. Upstream engines (Google especially) block server IPs with CAPTCHAs; no settings file fixes an upstream block. Anecdotal reports only; no dated 2026 confirmation found. Sources: https://docs.controlplane.com/template-catalog/templates/searxng, https://www.ssdnodes.com/learn/lang/vi/searxng-rate-limits-and-429-errors
- Adds one more container per deployment. Quality varies with which engines happen to be unblocked. Could include forum-oriented engines (Reddit, HN via configured engines) at no cost. Unverified.

### Mojeek
- Own index. GBP 1 per 1k personal (2,000/day), GBP 2 Startup (100k/day), GBP 3 Business (40 results per request). Startup results cacheable for one hour; Business has storage rights. 90-day standard retention, ZDR on request. Bank card required to open an account. AI use listed as included. Source: https://www.mojeek.com/services/search/web-search-api/
- Small independent index; relevant for avoiding Google/Bing. Coverage of recent posts is unverified.

### Marginalia
- Own index of the small, non-commercial web (index contents are not described on the API page). Free non-commercial API key by email; commercial metered key. Public key `public` is rate limited. AGPL. Source: https://about.marginalia-search.com/article/api/
- A useful supplement for small blogs and personal sites; not a general search.

## MCP servers

| Service | Official MCP | Notes |
|---|---|---|
| Exa | Yes, hosted `https://mcp.exa.ai/mcp` | Keyless free tier |
| Tavily | Yes, `https://mcp.tavily.com/mcp/` | OAuth with Claude Code |
| Parallel | Yes, `https://search.parallel.ai/mcp` | Anonymous tier |
| Brave | Yes (listed Official on Glama; unverified in Brave docs) | stdio default |
| Kagi | Yes, `https://mcp.kagi.com/mcp` (per mcp.so) | Unverified against Kagi docs |
| You.com | Yes, free 100/day | From pricing page |
| Perplexity, Linkup, Jina, Serper | Not confirmed | Third-party servers exist |

For Claude Code subprocesses, an MCP server is the lowest-effort way to give agents a new search tool. Exa and Parallel need no key to try.

## Deep research loops

- OpenAI deep research: `o3-deep-research` and `o4-mini-deep-research` shut down 2026-07-23; OpenAI recommends `gpt-5.6-sol` for deep research. Tools: web search, remote MCP with `search` and `fetch` tools, file search. Background mode keeps data about 10 minutes, so it conflicts with ZDR. Source: https://developers.openai.com/api/docs/guides/deep-research. Price not on the page. The same page set recommends `gpt-5.5` with high or xhigh reasoning plus background mode.
- Gemini Deep Research: agents `deep-research-preview-04-2026` and `deep-research-max-preview-04-2026`, Interactions API only, background required, preview. Tools default to Google Search, URL Context, Code Execution; MCP and file search supported. Source: https://ai.google.dev/gemini-api/docs/deep-research. Cost is token-based on Gemini 3.1 Pro rates; third-party estimates are about $1-3 per standard task and about $3-7 for Max (unverified; https://tokencost.app/blog/gemini-deep-research-agent-cost). Runs on the existing Gemini key.
- Perplexity Sonar Deep Research: $2/$8 per M tokens plus $5 per 1k searches and citation/reasoning tokens. Also on OpenRouter (price there unverified).
- Parallel Task API: processors from Lite $5 per 1k to Ultra8x $2,400 per 1k; structured output with citations. Parallel reports 58% on BrowseComp for its top tier (July 2026, vendor-run). Source: https://parallel.ai/pricing, https://parallel.ai/blog/deep-research-browsecomp
- Exa: Agent endpoint, effort levels $0.012 to $1.00 per request. Deep search types add multi-step query expansion (https://exa.ai/pricing).
- You.com Research API: $12 to $1,200 per 1k by tier.
- Tavily Research: 4-250 credits per request.
- Open source: GPT Researcher (assafelovic; about 28-29k stars mid-2026 per aggregators; retrievers include Tavily, Bing, Google CSE, DuckDuckGo, SearXNG, Arxiv; MCP support; latest listed v3.5.1, 2026-06-23). LangChain `open_deep_research` (LangGraph, MIT, scored 0.4344 RACE on DeepResearch Bench in 2025; leaderboard no longer online). Sources: https://pypi.org/project/gpt-researcher/, https://rywalker.com/research/open-deep-research. A blog claims an open agent called Onyx tops DeepResearch Bench; unverified.
- Because the box already has Claude Code subprocesses, a loop of many cheap searches by the agent itself (via MCP or OpenRouter) may match these services' multi-step behavior with lower cost. No benchmark in this survey tests that.

## Benchmarks

Who ran each is stated. None tests forum or long-tail recall specifically.

1. Artificial Analysis Search Index (Artificial Analysis; third party; data as of 2026-09-28). Equal-weighted mean of DeepSearchQA F1 (900 tasks), BrowseComp (200-sample subset) and AA-Omniscience (600 private). Fixed answer model GPT-5.6 Luna (medium). No funding disclosure on the methodology page. Scores: Perplexity (medium) 80, Perplexity (high) 79, Octen 77, Parallel Advanced 75, Brave LLM Context 75, OpenAI Web Search 74, You.com 74, Nimble 74, Exa auto 74, Firecrawl 73, Parallel Basic 73, TinyFish 71, no-search baseline 33. Search cost per 1k tasks ranged $9 (Octen) to $65.57 (Exa auto). Latency 15-60 s per task. Tavily and Linkup are not in the table I read. Sources: https://artificialanalysis.ai/agents/search-api, https://artificialanalysis.ai/methodology/search-api
2. AIMultiple "Agentic Search" (AIMultiple; December 2025 snapshot, updated 2026-05-13). 100 AI/LLM queries, 5 results per API, GPT-5.2 judge, 10% human check. Agent Score: Brave 14.89, Firecrawl 14.58, Exa 14.39, Parallel Pro 14.21, Tavily 13.67, Parallel Base 13.50, Perplexity 12.96, SerpApi 12.28. Top four overlap statistically; only Brave over Tavily is significant. Latency: Brave 669 ms, Parallel Pro 13.6 s. Disclosure: SerpApi subscribes to AIMultiple's benchmarking services. Queries are AI/LLM topics only. Source: https://aimultiple.com/agentic-search
3. openbenchmarks-labs (OpenBenchmarks Labs; self-described independent; no funding disclosed; snapshot 2026-09-15). Coding-agent docs tasks, 100 held-out tickets, 3 runs, `gpt-5.6-sol` fixed. Search and fetch board: Exa deep 83.0% +/-1.0, Exa auto 81.7%, TinyFish 79.0%. Search-only board: Perplexity low 77.3%, Firecrawl 70.3%, Parallel fast 66.7%. Secondary summary: Perplexity high 77.7, Parallel advanced 77.0, Tavily about 60, Linkup standard 48.3, Brave LLM Context 43.0 (search-only). The same org's multi-turn company-search board (secondary summary): Parallel basic F1 46.5, Exa deep 45.4, Brave web search 28.0. Treat the independence claim as unverified. Sources: https://github.com/openbenchmarks-labs/web-search-for-coding-agents, https://github.com/openbenchmarks-labs/multi-turn-company-search
4. Parallel (vendor). Search Index 75 vs Exa 74 vs Tavily 66 (Tavily basic) in Parallel's article, citing Artificial Analysis; BrowseComp deep-research claims (58% top tier vs OpenAI web search 57.7%); Exa 14%, Perplexity 6%, Anthropic 7% on an older run. Sources: https://parallel.ai/articles/why-ai-agents-cant-just-use-google-search.md, https://parallel.ai/blog/deep-research-browsecomp
5. Tavily (vendor) article on Exa vs Parallel (2026-04-27) reports Parallel's published numbers: SealQA 41% for both (Exa 326 CPM, Parallel 191 CPM). Source: https://tavily.com/blog/exa-vs-parallel-benchmarking-retrieval-apis-for-ai-agents-in-2026
6. DeepResearch Bench (academic, ICLR 2026) for full deep-research agents, not search APIs. Source: https://mlanthology.org/iclr/2026/du2026iclr-deepresearch/

Reading the data: ranks disagree across boards (Exa leads the coding-docs board, trails on Artificial Analysis; Brave leads AIMultiple, mid-pack on AA, last-tier on one openbenchmarks board). Configuration matters more than vendor. A test on the box's own scouring queries (forums, small blogs, recent posts) would settle the question better than any published board.

## Gaps

- Backing index of OpenAI, Mistral and Perplexity search: not found.
- Mistral per-call price: third-party only.
- Tavily, Exa, You.com privacy and training terms: no primary text read.
- Whether Claude Code's built-in WebSearch uses the Anthropic server tool, and its result count: not verified.
- Whether OpenRouter passes through date filters to Exa: not verified.
- OpenAI deep research current pricing: not found on the page read.
- FastGPT price, Kagi API invite status: not verified (pages did not state; vendor Search price page shows self-serve signup).
