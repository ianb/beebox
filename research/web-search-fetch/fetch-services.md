# Fetching blocked and rendered pages: services, routes, and legal posture

Research date: 2026-10-15. Desk research plus a few unauthenticated GET requests. No sign-ups, no spend, no code changes.

Question: how can an agent (Claude Code in the dev repo, or inside a box on a Hetzner server) get the content of a known URL when plain fetch fails? Sources: [fetch-blocked-pages issue](../../issues/features/2026-10-04-fetch-blocked-pages.md), [server-side capture issue](../../issues/features/2026-09-11-server-side-webpage-capture.md). A sibling report covers search APIs.

How to read the evidence:

- "Probe" means a curl request I ran on 2026-10-15 from a residential Mac IP. A datacenter IP (the Hetzner box) can get different results. Nothing here was probed from a datacenter.
- "Vendor claim" means the vendor's own page. Several fetched pages were summarized by a small model, so numbers are as read from the page on the date above. Items marked (unverified) came from secondary sources or memory.
- Search-result aggregators and vendor blogs have commercial stakes. Treat them as leads.

## Main findings

1. Fetch has three tiers. Tier 1: plain HTTP plus a local extractor (works for most of the open web). Tier 2: a rendered page (headless browser, already present as `agent-browser` / `bin/browse`, or Cloudflare Browser Run). Tier 3: per-host routes and unblocking services for hostile hosts.
2. Reader services that do not evade bot detection (Jina Reader, Cloudflare Browser Run `/markdown`) fail on Reddit. Probe: `r.jina.ai` returns the Reddit 403 page for `www.reddit.com` URLs even from a residential IP.
3. Per-host free routes exist for most hosts the issues name and need no signup. They are listed in the probe table below: Reddit `.rss` and Arctic Shift, X via `api.fxtwitter.com` and the syndication endpoint, Instagram oEmbed, TikTok/YouTube oEmbed, Bluesky public API.
4. Unblocking services (Bright Data, Zyte, ScrapingBee, ScraperAPI, Firecrawl enhanced proxy, Apify actors) cost cents to a few dollars at 300 pages/month, but most need an account and a card. Bright Data has a free tier of 5,000 requests/month. They work by proxies, CAPTCHA solving, and browser fingerprinting. Legal posture is in its own section.
5. A logged-in persistent profile is the only route here that reaches content gated by the human's own account. It carries account-ban risk and Chrome 136+ constrains how to attach to it.

## Probe results (2026-10-15, residential IP, no auth)

| Endpoint | Result | Notes |
|---|---|---|
| `www.reddit.com/r/ClaudeAI/.rss` | 200 Atom | Reddit's own feed. Issue notes 429 after about three requests. |
| `arctic-shift.photon-reddit.com/api/posts/search?subreddit=ClaudeAI&limit=1` | 200 JSON | Third-party archive. `posts/ids?ids=1` returned `{"data":[]}`. |
| `api.pullpush.io/reddit/search/submission/` | 429 | Rate-limited on first request; status uncertain. |
| `r.jina.ai/https://www.reddit.com/r/ClaudeAI/` | 200 wrapping a Reddit 403 page | Text: "You've been blocked by network security. To continue, log in to your Reddit account or use your developer token". |
| `r.jina.ai/https://example.com` | 200 | Reader works for cooperative sites. |
| `old.reddit.com/r/ClaudeAI/` | 302 | Redirect target not followed. Not tested further. |
| `api.fxtwitter.com/jack/status/20` | 200 JSON | Tweet text, author, counts. |
| `api.vxtwitter.com/jack/status/20` | 200 | Body not inspected. |
| `cdn.syndication.twimg.com/tweet-result?id=20&token=a` | 200 JSON | Tweet text, favorite count, user. |
| `publish.twitter.com/oembed?url=...` | 301, then 200 JSON | Returns embed HTML blockquote with tweet text. |
| `x.com/jack/status/20`, `instagram.com/p/<id>/` | 200 | HTML shells (script-rendered, login-gated content). Content not checked. |
| `nitter.net/jack/status/20` | 200 page that says "nitter.net is offline." | Nitter instance is down. |
| `www.instagram.com/api/v1/oembed/?url=<public post>` | 200 JSON | Returned title (caption), author_name, media_id with no token. |
| `api.instagram.com/oembed/` | 302 | Older endpoint, not followed. |
| `www.ddinstagram.com` | connection failed | Not alive from here. |
| `www.tiktok.com/oembed?url=...` | 200 JSON | |
| `www.youtube.com/oembed?...` | 200 JSON | Metadata only, no transcript. |
| `public.api.bsky.app/xrpc/app.bsky.actor.getProfile` | 200 JSON | `bsky.social/xrpc/...` returns 401. Use the `public.api.bsky.app` host. |
| `mastodon.social/api/v1/timelines/public` | JSON error "requires an authenticated user" | Instance-specific. Single status lookup by ID is usually public (unverified). |
| `archive.org/wayback/available?url=nytimes.com` | 200 JSON | Availability API alive. |
| `web.archive.org/web/2024/<url>` and `web.archive.org/save/<url>` | 429 | Rate-limited from this IP after other probes. Save Page Now limits not confirmed. |
| `archive.ph/newest/<nytimes url>` | 302 to a snapshot URL | Content not fetched. Another source reports CAPTCHA and rate limiting. |
| `12ft.io` | connection failed | Appears dead (unverified beyond one probe). |
| `linkedin.com/posts/<made-up>` | 404 | Uninformative: I used a fake URL. |

## Comparison table (300 pages/month)

Prices are from the vendor pages listed in the sections below. "Evades?" means the service markets or documents proxy rotation, CAPTCHA solving, or fingerprint evasion as a feature.

| Service | Kind | Cost at 300 pages/mo | Free tier | Setup surface | Evades bot detection? | Reaches Reddit / IG / X / LinkedIn |
|---|---|---|---|---|---|---|
| Jina Reader | reader proxy | $0 | No key: 20 RPM. New key: 10M tokens | None without key | No (vendor says it does not bypass) | Reddit: no (probe). Others untested |
| Cloudflare Browser Run `/markdown` | hosted render | Workers Free: 10 browser min/day; Paid: 10 h/mo included | Yes (Free plan) | Cloudflare account + API token | No; always identifies as a bot | Hosts that block bots will block it |
| Firecrawl cloud | scrape API | $0 (1,000 free credits/mo; 1 credit/page) | 1,000 credits/mo | Account + API key | Hosted "enhanced" proxy mode (cost unverified) | Vendor claims vary; no independent test found |
| Firecrawl self-host | OSS (AGPL-3.0) | Server cost | n/a | Docker stack | No Fire-engine; plain Playwright | Cooperative sites only |
| Crawl4AI | OSS (Apache-2.0) | Server cost | n/a | pip + browser | Stealth/proxy hooks; you supply proxies | Cooperative sites |
| Exa contents | API | $0.30 ($1/1,000 pages) | $10/mo credit | Account + key | Not stated | Not stated |
| Tavily extract | API | Free tier covers it (1,000 credits/mo) | 1,000 credits/mo | Account + key | Not stated | Not stated |
| Diffbot | API | Free tier (10,000 credits/mo; 1 credit/page) | 10,000 credits, 5 req/min | Account + key | Not stated | Not stated |
| Zyte API | unblocking API | About $0.04 to $0.38 for HTTP-tier pages; browser tier $0.30 to $4.82 (PAYG ranges) | $5 trial credit, 30 days | Account + card | Yes (ban handling, headless) | Vendor-dependent |
| ScrapingBee | unblocking API | $19/mo plan minimum | 1,000 credits (per ScraperAPI page; ScrapingBee page not stated) | Account + card | Yes | LinkedIn priced at 30 credits/page |
| ScraperAPI | unblocking API | $49/mo plan minimum | 7-day trial, 5,000 credits (page also says 1,000 free) | Account + card | Yes | |
| Bright Data Web Unlocker | unblocking API | $0.45 ($1.5/1,000) | 5,000 requests/mo | Account (+ card) | Yes | Vendor-dependent |
| Apify (Reddit Scraper Lite) | actor marketplace | About $3.40 per 1,000 results; a 100-comment thread is about 100 results | $5/mo platform credit | Account + token | Uses proxies (residential recommended) | Reddit: top-level comments only per a related actor note |
| Browserbase | hosted browser | Free: 1 browser hour | 1 h, 3 concurrent | Account + key | Paid plans: CAPTCHA + basic stealth | |
| Steel | hosted browser | $0 + usage ($0.10/h) | $30 one-time credit | Account + key | Stealth only on Enterprise | |
| Hyperbrowser | hosted browser | Free 5,000 credits | 5,000 credits/mo | Account + key | Paid: CAPTCHA + stealth + residential | |
| Kernel | hosted browser | Free (Developer, $5 credit/mo) | Yes | Account + key | Managed stealth on all plans | |
| Browser Use cloud | hosted browser | Pay as you go | Not verified | Account + key | Yes (stealth, CAPTCHA, residential built in) | |
| Anchor Browser | hosted browser | Free $5 credit/mo | Yes | Account + key | Starter: CAPTCHA bypass, "Cloudflare Verified" | |
| Per-host free routes (fxtwitter, oEmbed, .rss, Arctic Shift, Bluesky) | public endpoints | $0 | n/a | None | No | See probe table |
| Logged-in local profile | local | $0 | n/a | Human logs in once | No evasion; uses the human's real account | Reaches gated content; ban risk |

## 1. Reader and markdown services

### Jina Reader (`r.jina.ai`)

- Prefix a URL with `r.jina.ai/`. Returns markdown. Probe: works on `example.com`; wraps a Reddit 403 for Reddit.
- Limits: no key 20 RPM; free key 500 RPM; paid 500 RPM; premium 5,000 RPM (vendor page, which also lists a conflicting FAQ figure). New key includes 10M free tokens. Source: <https://jina.ai/reader/>.
- Privacy: same-URL responses cache for 5 minutes. Requests with cookies are never cached. A "Do Not Cache or Track" option exists. Jina states it does not train on API content. No general retention period is stated. Source: same page.
- Stance on blocks: the vendor states Reader does not bypass anti-bot systems and respects a site's block. You may pass your own cookies or proxy. Source: same page.
- Ownership: I recall Elastic acquired Jina AI in late 2025 (unverified; not checked this session).
- Datacenter IPs: not tested. The service fetches from Jina's own IPs, so the box's IP does not matter for the target site. The box's content leaves to Jina.

### Cloudflare Browser Run (formerly Browser Rendering) `/markdown`, `/content`

- REST: `POST https://api.cloudflare.com/client/v4/accounts/<accountId>/browser-run/markdown` with `{"url": ...}` and a bearer token with `Browser Run - Edit`. Renders in a real browser. SPAs may need `gotoOptions.waitUntil: networkidle0`. Source: <https://developers.cloudflare.com/browser-run/quick-actions/markdown-endpoint/>.
- The docs state the `userAgent` parameter does not bypass bot protection, and requests are always identified as bots. Requests carry Web Bot Auth signature headers that cannot be removed. Source: same page; <https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/>.
- Price: Workers Free 10 browser minutes/day, 3 concurrent. Workers Paid 10 browser hours/month included, then $0.09/hour. Source: <https://developers.cloudflare.com/browser-run/pricing/>. The Workers Paid base fee ($5/month) is from memory (unverified).
- At 300 pages/month, usage fits the free plan if pages render in under about 60 seconds each in total.
- Fit: a hosted JS renderer with a clean identity. It does not help with hosts that block bots. It would add a Cloudflare account to box setup.

### Firecrawl

- Scrape, crawl, map, extract; markdown output. Cloud tiers: Free 1,000 credits/month; Hobby $16/month yearly ($19 monthly), 5,000 credits; Standard $83/month yearly, 100,000 credits. 1 credit = 1 basic page. JSON/Question/Highlight formats add 4 credits. Error pages (403/404) still cost 1 credit. Source: <https://www.firecrawl.dev/pricing>.
- Proxy modes: `basic`, `enhanced`, `auto` (retries with enhanced if basic fails). Enhanced credit cost not on the page I read. Source: <https://docs.firecrawl.dev/features/proxies>. I recall enhanced costing about 5 credits per page (unverified).
- Self-host: AGPL-3.0 server, MIT SDKs. Self-hosted instances have no Fire-engine, which handles IP blocks and bot detection; the user configures Playwright and proxies. Source: <https://docs.firecrawl.dev/contributing/self-host>. Third-party reviews say the same.
- Reach on hostile sites: vendor-dependent; I found no independent test of Reddit/IG/LinkedIn.
- Privacy: content goes to Firecrawl cloud. Retention terms not read.

### Exa contents

- `contents` returns text, highlights, or summary for given URLs. $1 per 1,000 pages per content type. $10 free credit per month, no card. Source: <https://exa.ai/pricing>. 300 pages cost $0.30.
- Whether Exa fetches live or from its index, and its behavior on blocked hosts, is not stated on that page. Not verified.

### Tavily extract

- Free Researcher plan: 1,000 credits/month, no card. Pay as you go $0.008/credit. Source: <https://www.tavily.com/pricing>. Credits per extracted URL not on the page (I recall 1 credit per 5 URLs basic; unverified).

### Diffbot

- Extract API: 1 credit per page, 2 credits via datacenter proxy. Free plan 10,000 credits/month, 5 requests/minute. Paid starts at $299/month. Source: <https://www.diffbot.com/pricing/>.
- Fit: free tier covers 300 pages. Quality on blocked hosts not tested.

### Spider.cloud

- Pricing page redirected and showed no numbers when fetched (<https://spider.cloud/credits/new>). Price and free credits unverified. Not recommended for further work without a direct page read.

### Crawl4AI (self-host)

- Python library, Apache-2.0. Runs Playwright; has stealth and proxy hooks; you supply proxies. No public managed cloud (a hosted API is described as closed beta). Source: secondary comparison posts, e.g. <https://www.scrapingbee.com/blog/crawl4ai/> (vendor blog, a competitor).
- Fit: duplicates `agent-browser` for rendering. Adds a Python dependency to a TypeScript stack.

### Defuddle and Trafilatura (local extractors)

- Defuddle is already the extractor in the Clerk extension (`beebox-clerk/src/platform/extract-readable.ts`, per the capture issue). Trafilatura is a Python extractor. I did not fetch their docs this session; both are free local libraries (from memory, unverified).
- Local extraction fixes content quality, not blocking. It pairs with any fetch tier.

## 2. Scraping APIs with unblocking

### Technique

These services route requests through large proxy pools (datacenter, residential, mobile IPs), rotate IPs on failure, run real or patched browsers with fingerprints that match human browsers, solve CAPTCHAs (automated or human-assisted), and retry on blocks. They sell success rate on protected sites. "Residential" IPs belong to consumer ISPs. How the provider sources them varies and is a separate ethics and legal question (not researched here).

### Vendors and prices

| Vendor | Pricing facts (page, read 2026-10-15) | Source |
|---|---|---|
| Zyte API | Pay as you go from $0.13 to $1.27 per 1,000 HTTP responses; $1.01 to $16.08 per 1,000 browser-rendered. Higher commitments lower the rate. $5 trial credit, 30 days. Charges only successful responses ("starts at $0.06 per 1,000"). | <https://www.zyte.com/pricing/> |
| ScrapingBee | Plans from $19/month (75,000 credits). Per-domain credit costs: standard page 1; Amazon 5; Google/Bing 25; LinkedIn 30; Cloudflare/DataDome/PerimeterX-protected sites +10. | <https://www.scrapingbee.com/pricing/> |
| ScraperAPI | Plans from $49/month (100,000 credits, US/EU geotargeting). 7-day trial with 5,000 credits (page also mentions a 1,000-credit free plan). Multipliers not on the page. | <https://www.scraperapi.com/pricing/> |
| Bright Data Web Unlocker | Pay as you go $1.5 per 1,000 requests, pay only for success. Free tier 5,000 requests/month, no card. Deposit-match offer up to $500. | <https://brightdata.com/pricing/web-unlocker> |
| Bright Data MCP | 5,000 free requests/month on new accounts, covering web search and page scraping via Web Unlocker. A third-party listing says the 60+ structured scrapers (Instagram, LinkedIn, etc.) need a paid account (unverified). Setup needs one API token. | <https://docs.brightdata.com/mcp-server/overview> |
| Oxylabs | Price and tiers not fetched. Not verified. | |
| Apify | Free $5/month platform credit; Starter $19/month. Reddit Scraper Lite: from $3.40 per 1,000 results; "proxies highly recommended, residential preferred". A related actor notes comment trees omit "load more" replies. Instagram and LinkedIn actors exist (not priced here). | <https://www.apify.com/pricing>, <https://apify.com/trudax/reddit-scraper-lite>, <https://apify.com/s-r/reddit-scraper> |

### Cost at 300 pages/month

- Bright Data Web Unlocker: about $0.45, inside the free 5,000 requests.
- Zyte: about $0.04 to $0.38 (HTTP), $0.30 to $4.82 (browser), depending on site tier. Inside the $5 trial for the first month.
- ScrapingBee or ScraperAPI: a $19 or $49 monthly plan. Protected-site multipliers raise credit use but 300 pages stay far below plan quotas.
- Apify: Reddit threads cost per result, so ten 100-comment threads is roughly 1,000 results, about $3.40.

### Reported reach

- Reddit: blocking applies to unauthenticated `.json` since about 2026-05-28 to 05-30 (secondary sources, vendor blogs). One source says better proxies do not fix it; another says residential IPs are also blocked. Managed vendors claim to return normalized JSON anyway. No independent test seen. Sources: <https://dev.to/tonywangca/why-reddit-blocked-unauthenticated-json-in-2026-and-how-to-still-get-reddit-data-58b9>, <https://medium.com/@alex_79882/reddits-api-is-officially-dead-in-2026-here-s-what-i-use-instead-f88ee5b809c8>.
- LinkedIn: ScrapingBee charges 30 credits per page, which implies it offers it. LinkedIn's litigation record (below) is the relevant risk.
- Account setup: all need a vendor account and, except Bright Data's free tier, a card.
- Privacy: target URLs and returned content pass through the vendor. Retention terms not read.

## 3. Hosted browsers

| Service | Free tier | Paid | Stealth / CAPTCHA | Persistence | Source |
|---|---|---|---|---|---|
| Browserbase | 1 browser hour, 3 concurrent, 15-min sessions; 1,000 Search + 1,000 Fetch calls | Developer $20/mo (100 h, 1 GB proxy); Startup $99/mo | Free: none. Developer/Startup: auto CAPTCHA + basic stealth. Scale: advanced stealth, verified agents. Page lists "bring your own proxy". | Contexts not on pricing page | <https://www.browserbase.com/pricing> |
| Steel | $30 one-time credit | Scale $250/mo + usage; browser $0.10/h (Launch); CAPTCHA $3/1k solves; proxy $10/GB | Stealth browser only on Enterprise | Not on page | <https://steel.dev/pricing> |
| Hyperbrowser | 5,000 credits/mo, 1 session | Startup $30/mo; Scale $100/mo; browser $0.10/h; proxy $10/GB | Auto CAPTCHA + basic stealth + residential on paid; "ultra stealth" Enterprise | Profiles not on page | <https://www.hyperbrowser.ai/pricing> |
| Kernel | $5/mo credit; 3 managed-auth connections | Hobbyist $30; Start-Up $200 | Managed stealth on all plans | Managed Auth (kept login sessions) on all plans | <https://www.kernel.sh/docs/info/pricing> |
| Browser Use cloud | Not verified | Pay as you go; sessions about $0.02 to $0.03/h; Dev $29/mo (conflicting pages) | Stealth, auto CAPTCHA, residential proxies built into every session | Not found | <https://docs.cloud.browser-use.com/guides/proxies-and-stealth> |
| Anchor Browser | $5/mo credit | Starter about $20 to $50/mo (sources conflict); $0.05 to $0.10/h | Starter: "Cloudflare Verified" agents + CAPTCHA bypass; full stealth top tier | "Authenticated (logged in) browsers" on Starter | <https://docs.anchorbrowser.io/pricing> and third-party comparisons |

Stance: two vendor positions exist. Browserbase, Notte, and Cloudflare promote Web Bot Auth (signed requests identifying agents; see <https://browserbase.com/blog/identity>). Browser Use, Hyperbrowser, Kernel, and Anchor market stealth, residential proxies, and CAPTCHA solving. Several vendors do both.

Fit for Bee Box: a hosted browser adds a vendor account and sends page content, and for persistent logins the human's credentials or cookies, to a third party. At 300 pages/month the cost is near zero, so setup surface decides.

## 4. Per-host routes

### Reddit

- Plain page, `.json`, `api.reddit.com`: blocked ("blocked by network security", offers login or developer token). Probe confirms the same page via Jina.
- Official API: the Responsible Builder Policy (Nov 2025) says "You must request access and get explicit approval before accessing any Reddit data through our API". Self-serve app creation no longer suffices. Non-commercial use points to a support-form sign-up and to Devvit first. Authenticated rate limit reported at 60 requests/minute (secondary source). Sources: <https://www.redditapis.com/blogs/reddit-data-api-2026>, <https://vorplabs.com/agent-tools/reddit-data-api>. Reddit's own policy text was not fetched; one secondary source could not find it at redditinc.com/policies.
- `.rss` per thread or subreddit: alive (probe 200). Omits scores, comment counts, flair. Rate-limits fast.
- Arctic Shift: alive (probe 200). Third-party archive, stale scores, removed text missing, can stop. PullPush: 429 on the first request (status uncertain).
- Old Reddit HTML: probe returned 302; not followed. One guide lists old.reddit and `.rss` as free but limited. Unverified from this environment.
- Headless Chrome: issue reports the same block page; one source reports the block even on a cold Playwright session.
- Datacenter vs residential: all non-archive routes (`.rss`) are Reddit's own and rate-limit by IP. A shared Hetzner IP would hit 429 sooner (unverified).

### X / Twitter

- `api.fxtwitter.com/<user>/status/<id>`: alive, returns text, author, counts, no auth. Operated by a third party; X Corp pressure on such projects is a risk.
- `cdn.syndication.twimg.com/tweet-result?id=<id>&token=a`: alive, returns tweet JSON. This is X's embed backend and can change.
- `publish.twitter.com/oembed`: alive, returns embed HTML with tweet text.
- Nitter: `nitter.net` shows "offline". A secondary source reports X Corp cease-and-desist letters on 2026-08-24 and the repository archived on 2026-09-11 (unverified).
- Guest tokens: reported largely shut. Threads and replies are harder than single tweets. Source: <https://scrapfly.io/blog/posts/best-twitter-scrapers-github> and Apify actor pages (vendor).
- Datacenter vs residential: not tested; fxtwitter fetches from its own servers.

### Instagram

- oEmbed: `www.instagram.com/api/v1/oembed/?url=<post>` returned JSON with caption, author, media_id without a token (probe). Meta's developer page still says an app token and App Review are required (<https://developers.facebook.com/docs/instagram/oembed>). A WordPress blog and daily.dev report Meta dropped the token requirement on 2026-06-15 (<https://wpmayor.com/meta-tokenless-oembed-wordpress/>). Reported fields: thumbnail and author_name were removed at some point (Discourse thread). The probe still showed `author_name`, so field availability varies.
- `ddinstagram.com`: unreachable from my probe.
- Full page HTML: login-gated shell. No free route reaches media files or comments (not tested).
- Logged-in automation ban risk: no source found this session.

### LinkedIn

- Public post pages: one made-up URL returned 404, which tells nothing. I found no documented free route. LinkedIn restricts anonymous profile access; its litigation record is in the legal section.

### YouTube

- oEmbed gives metadata only (probe 200).
- Transcripts: `youtube-transcript-api` README says YouTube blocks most cloud-provider IPs (`RequestBlocked`/`IpBlocked`). Its workaround is rotating residential proxies (Webshare). A 2026 issue reports the free Webshare tier gives datacenter proxies that are also blocked. Cookie auth is reported disabled and risks permanent bans on the account used. Sources: <https://github.com/jdepoix/youtube-transcript-api>, <https://github.com/jdepoix/youtube-transcript-api/issues/593>. `yt-dlp` has the same IP issue (unverified for 2026).
- Implication: transcripts work from a residential IP (laptop dev) and fail from the Hetzner box without a proxy.

### TikTok, Bluesky, Mastodon

- TikTok oEmbed: alive (probe 200).
- Bluesky: `public.api.bsky.app` XRPC works without auth (probe 200). `bsky.social` returns 401 for the same call.
- Mastodon: public timeline needs auth on `mastodon.social`. Status lookup by ID is usually public (unverified).

### Paywalled news

- Wayback Machine availability API alive (probe 200). Fetching `web.archive.org/web/...` and anonymous Save Page Now returned 429 from my IP. Save Page Now limits not confirmed.
- archive.today (`archive.ph`/`archive.is`): `newest` lookup redirected to a snapshot (probe). Reports: operating in 2026, CAPTCHA and rate limiting, a January 2026 incident where its CAPTCHA page ran script that attacked a blog, and Wikipedia stopped accepting it as a citation source in February 2026 (secondary, unverified). Source: <https://kiroku.today/en/guides/archive-today-guide>.
- Google cache: removed (from memory, not re-verified).
- 12ft.io: connection failed in my probe.
- Publisher RSS: usually carries headline and summary, sometimes full text (general knowledge, not verified per publisher).
- Archive and paywall-removal tools retrieve content the publisher meant to restrict. Terms-of-service posture is in the legal section.

## 5. Logged-in browser profile

- Idea: a persistent headless Chrome profile that the human logs into once. Block pages such as Reddit's offer login as the way through ("log in to your Reddit account or use your developer token"). This is untested here.
- Chrome 136+ ignores `--remote-debugging-port` and `--remote-debugging-pipe` against the default user-data directory; they need a non-default `--user-data-dir`. Reason: attackers used remote debugging to extract cookies. Chrome for Testing keeps the old behavior. Source: <https://developer.chrome.com/blog/remote-debugging-port>. Consequence: attaching an agent to the human's everyday Chrome profile no longer works. A separate dedicated profile directory works.
- Playwright `storageState` saves cookies and local storage to JSON for reuse (general knowledge; not re-fetched). Cookie reuse from a datacenter IP can look like account takeover to the site (unverified).
- Claude in Chrome: the official help article lists "adult content websites" and "known pirated content sites" as blocked, and says "Claude asks for permission before accessing financial sites". It names no domains. A third-party reimplementation lists 58 blocked domains including Reddit, news, and others; that list is unverified. The issue file says reddit.com is on the extension's blocklist, which matches the third-party list and contradicts the official article's text. Sources: <https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely>, <https://github.com/noemica-io/open-claude-in-chrome>. Users report false positives with no override (<https://claudeissues.com/issue/48295-claude-in-chrome-url-categorization-api-blocks-legitimate-ticket-athletics-sites>).
- Ban risk: automation under a real account violates most platforms' terms (see legal section). I found no quantified ban-rate reports. YouTube transcript library discussions warn that cookie-authenticated automated requests lead to permanent account bans (<https://github.com/jdepoix/youtube-transcript-api/issues/593>, secondary).
- Hosted variants: Kernel Managed Auth and Anchor "authenticated browsers" keep a login in a vendor browser. This moves credentials to the vendor.
- Fit: a box agent in a Hetzner container would log in from a datacenter IP, which raises detection risk, and the human must log in through some remote UI.

## 6. MCP servers and other agents

| Server | What it does | Notes |
|---|---|---|
| Official `fetch` MCP | HTTP GET, markdown conversion, no JS | Handles most open-web reading per one guide. No help on blocked or script-rendered pages. |
| Playwright MCP | Real browser; can attach to an existing session with cookies | Fails on anti-bot-protected sites per ZenRows. Runs locally. |
| Firecrawl MCP | scrape, crawl, map, extract | Same coverage as the Firecrawl API. Free 1,000 credits/month. |
| Bright Data MCP | Search, Web Unlocker scrape, 60+ structured scrapers | 5,000 free requests/month; structured tools may need paid (unverified). One API token. |
| Jina MCP | Reader, search | Same coverage as Jina Reader. |
| browser-use MCP | Drives a browser agent | Local or cloud. |

Sources: <https://www.zenrows.com/blog/best-scraping-mcp-servers> (vendor), <https://geekflare.com/guides/web-scraping-mcp-servers/>, <https://docs.brightdata.com/mcp-server/overview>. A community MCP routes between Trafilatura, Jina, Firecrawl, and pypdf by URL pattern (same ZenRows article).

Other agents:

- ChatGPT agent's cloud browser signs outbound requests with HTTP Message Signatures (RFC 9421) so sites can identify it. At launch it could not sign in to sites or complete payments. Source: <https://help.openai.com/en/articles/11845367-chatgpt-works-cloud-browser-allowlisting>.
- Cloudflare defines a "signed agents" class, agents that users direct and whose platform signs requests via Web Bot Auth. Site owners set rules for it. Source: <https://blog.cloudflare.com/signed-agents>.
- Perplexity: Cloudflare reported in August 2025 that Perplexity used undeclared crawlers with a Chrome user agent and IPs outside its published ranges after declared bots were blocked, and de-listed it as a verified bot. Perplexity denied this and said fetches occur when a user asks. Source: <https://www.neowin.net/news/perplexitys-stealth-crawlers-exposed-in-new-cloudflare-report/>, <https://www.techrepublic.com/article/news-cloudflare-accuses-perplexity-stealth-crawling-violations/>. Comet's documented handling of blocked sites: not found.
- Manus and OpenClaw: no official documentation found on blocked-site handling.

## ToS and legal posture

Purpose: facts for re-examining the line "no stealth browser or residential-proxy fetchers". This section states facts. It does not give legal advice. A lawyer would be needed for any real exposure.

### What the techniques are

- A plain `fetch` with a Chrome user-agent string misstates the client's identity. The capture issue says a box agent already does this (`capture-page` trick).
- Headless Chrome is the same engine as a user's browser. Sites detect it by fingerprint and behavior.
- Stealth browsers and unblocking APIs patch fingerprints, rotate IPs (often residential), and solve CAPTCHAs, so the server cannot tell the client is automated.
- Reader services and Cloudflare Browser Run identify themselves as bots and respect blocks (vendor statements above).
- Archives (Arctic Shift, Wayback) serve copies. The requester never touches the origin.
- A logged-in profile uses the human's account. It does not hide automation unless combined with stealth.

### Case law and disputes (status as reported; verify against dockets)

- hiQ v. LinkedIn: Ninth Circuit (April 2022, on remand) held CFAA "without authorization" does not apply to public websites. The district court then granted LinkedIn summary judgment on breach of contract in November 2022 (hiQ had agreed to the user agreement and used fake profiles). The parties settled confidentially in December 2022, so the stipulation has no precedential value. Takeaway from commentators: public scraping is generally not a CFAA violation in the Ninth Circuit, but contract liability remains. Sources: <https://www.morganlewis.com/blogs/sourcingatmorganlewis/2022/12/linkedin-v-hiq-landmark-data-scraping-suit-provides-guidance-to-data-scrapers-and-web-operators>, <https://www.proskauer.com/blog/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case>.
- Meta v. Bright Data (N.D. Cal., Judge Chen, 2024): summary judgment for Bright Data on the contract claim. The ruling held Meta's terms apply to logged-in users and Bright Data scraped logged off. Meta then dropped the remaining claims and waived appeal; Bright Data says this involved no settlement or change of conduct (Bright Data's characterization). Sources: <https://www.mediapost.com/publications/article/392920/judge-sides-against-meta-in-battle-over-scraping-p.html>, <https://www.mediapost.com/publications/article/393996/meta-abandons-lawsuit-against-bright-data-over-scr.html>.
- X Corp v. Bright Data (N.D. Cal., Judge Alsup): claims dismissed in part; Alsup held federal copyright law preempted X's claims about selling publicly posted user data. A later ruling allowed X to revive the case with new harm allegations. Current status not found. Source: <https://www.mediapost.com/publications/article/401510/x-corp-can-revive-scraping-battle-with-bright-dat.html>.
- Reddit v. Perplexity, SerpApi, Oxylabs, AWMProxy (S.D.N.Y., filed 2025-10-22): alleges the defendants scraped Reddit content from Google Search results. Reddit's core claims are DMCA anti-circumvention. A secondary report (KuCoin news aggregator) says Judge Engelmayer largely denied SerpApi's motion to dismiss on 2026-07-31 and found a plausible conspiracy with Perplexity. Treat as unverified. Sources: <https://searchengineland.com/reddit-sues-perplexity-serpapi-scraping-google-463681>, <https://www.kucoin.com/news/flash/reddit-lawsuit-against-serpapi-survives-dismissal-motion>.
- Google v. SerpApi (N.D. Cal.): Judge Gonzalez Rogers dismissed Google's DMCA 1201 claims on 2026-07-20, with and without leave to amend in different parts. One source reports an amended complaint on 2026-08-10 (unconfirmed). Source: <https://seroundtable.com/google-lawsuit-serpapi-dismissed-41731.html>. The Reddit and Google cases pull in opposite directions on whether bot-detection evasion is DMCA circumvention.
- LinkedIn v. Proxycurl and ProAPIs: Proxycurl shut down in July 2025 instead of fighting (reported). LinkedIn sued ProAPIs in October 2025 over 1 million fake accounts; an agreement in principle was reported in February 2026. LinkedIn states every suit has ended in a judgment prohibiting scraping. Sources: <https://news.bloomberglaw.com/artificial-intelligence/linkedin-strikes-deal-to-settle-scraping-battle-with-startup>, <https://www.unipile.com/proxycurl-alternative/>.
- Cloudflare v. Perplexity (not a lawsuit): Cloudflare publicly accused Perplexity in August 2025 of stealth crawling and de-listed it as a verified bot (see section 6).

Defendants in these cases are commercial scrapers or AI companies operating at scale, not individuals reading a handful of pages. I found no report of a suit against an individual for personal-volume agent fetching. That absence is from search results and is not proof.

### Platform terms (what each says, as far as verified)

- Reddit: API access needs explicit approval; non-commercial route via support form or Devvit. Terms prohibit deriving revenue without approval (secondary sources). Reddit's own text was not fetched.
- Meta/Instagram: Meta's terms prohibit automated collection; the Bright Data ruling limits that to logged-in users. oEmbed is a published endpoint (token requirement disputed above).
- LinkedIn: user agreement prohibits scraping; hiQ lost on contract.
- X: terms and enforcement (Nitter C&D) are restrictive; guest access has been reduced.
- YouTube: blocks cloud IPs; automation under a logged-in account risks permanent ban per library maintainers' community.
- Paywalled publishers and archive tools: archives and paywall-removal tools retrieve content the publisher restricts; publishers' terms generally prohibit this. I did not read any specific publisher's terms. Copyright and DMCA claims have been raised against archive.today-like services (not verified here).

### Risks to the user at personal volume

- Account risk: any logged-in route can lead to account restriction or ban (LinkedIn restricts fake accounts within about a day per its own statement; YouTube warnings above). Risk applies to the human's real account.
- IP risk: a Hetzner IP used for evasive fetching can be blocked and may affect other box functions on the same IP (unverified, plausible).
- Contract risk: logged-out public access has the better precedent (Meta v. Bright Data). Logged-in access under agreed terms has the worse (hiQ).
- Vendor risk: unblocking vendors are defendants or targets in active suits (Oxylabs, SerpApi, Bright Data). A vendor can lose service or be enjoined.
- Data-flow risk: every hosted service receives the URLs and content an agent fetches, which can include a user's private links.
- Reputation: Cloudflare publicly named Perplexity for evasive fetching.

### What the existing line covers

The "no stealth or residential proxy" line was set by a prior agent and carried into the 2026-10-06 decision text as "Stealth-browser and residential-proxy fetchers stay out (they evade bot detection)". Facts bearing on it:

- Evasion is the stated product of Bright Data, Zyte, ScrapingBee, ScraperAPI, Browser Use cloud, and the paid tiers of Browserbase, Hyperbrowser, Kernel, and Anchor.
- Services that do not evade (Jina, Cloudflare Browser Run) fail on Reddit.
- Free per-host routes (`.rss`, Arctic Shift, fxtwitter, syndication, oEmbed) need no evasion and reach Reddit, X, and Instagram for single items.
- Routes with no evasion-free option found: LinkedIn, Instagram comments and media, Reddit full live comment trees, YouTube transcripts from a datacenter IP, paywalled news.
- The legal record separates logged-off public access (CFAA and contract rulings favor the scraper) from logged-in access, fake accounts, and DMCA anti-circumvention theories (active, mixed results).

## Open questions and not verified

- Oxylabs pricing and Spider.cloud pricing.
- Firecrawl enhanced-proxy credit cost and independent reach on Reddit/IG/LinkedIn.
- Exa and Tavily behavior on blocked hosts.
- Whether `old.reddit.com` and `.rss` work from the Hetzner IP.
- Any probe from a datacenter IP.
- Reddit's current Data API terms text and approval outcomes for personal use.
- Current status of the Reddit v. SerpApi ruling and X Corp v. Bright Data.
- Instagram oEmbed token requirement (Meta page and third-party reports conflict; probe succeeded without a token).
