# Per-site data services for the fallback fetch route (2026-10-15)

The boxholder said "there are services for things like Insta." This note surveys third-party APIs that take a post, profile, or video URL on one platform and return structured JSON. It maps them to the per-site gaps left by the free routes in [fetch-services.md](fetch-services.md) and [probes-2026-10-15.md](probes-2026-10-15.md).

Method: desk research on vendor pricing and docs pages, plus search-result summaries, on 2026-10-15. No signup was made and no paid call was sent. No service in the list offers an unauthenticated demo endpoint, so none was probed. Vendor pages are marketing; every price and field list below is the vendor's claim unless marked otherwise. "Unverified" means the figure came from a secondary page or a search summary.

Volume assumption: about 100 lookups per month per site.

## Summary

- One service covers most gaps with one key: ScrapeCreators (38+ APIs, 100 free calls, no card). SociaVault and EnsembleData overlap with it. Apify covers every site with one token but with a different actor per site.
- No multi-platform service covers all ten sites. Quora has no multi-platform coverage at all; only single-purpose Apify actors exist.
- Free quotas cover the stated volume for most services. Paid packs have a minimum purchase of about $29 to $47 (credits do not expire).
- Reddit's own change affects the existing plan: Reddit announced on 2026-09-30 that RSS ends 2026-11-13 and the public API closes in March 2027 (<https://www.techrepublic.com/article/news-reddit-rss-public-api-shutdown/>, <https://aiweekly.co/alerts/reddit-to-shut-rss-feeds-nov-13-close-public-api-by-march-2027>). The `.rss` route in the earlier notes stops working on 2026-11-13. Arctic Shift depends on data it collects itself; its continuity after March 2027 is unknown (unverified).

## How these services get data

Vendors rarely state it. What the pages say:

- ScrapeCreators: "only public data extraction"; the vendor blog says it calls the platforms' internal APIs (<https://docs.scrapecreators.com/>, <https://scrapecreators.com/blog/best-instagram-scraping-apis-in-2025-complete-comparison-and-review>). Account pools are not mentioned.
- HikerAPI: "unofficial" Instagram API, public data, "never acts on an account" (<https://hikerapi.com>). It also sells a private mobile API product.
- GetXAPI: works "without an official X developer account"; method not stated (<https://getxapi.com>).
- twitterapi.io: independent, not affiliated with X; method not stated (<https://twitterapi.io/pricing>).
- Bright Data: logged-out scraping through its proxy network; it won the Meta contract claim on that basis (see ToS section).
- Apify actors: written by third parties. Listings say "no cookies" or "no login" for several LinkedIn, Quora and Instagram actors (developer claims, unverified).
- Official APIs: X API, Meta oEmbed, Threads API, YouTube Data API, TikTok APIs.

## Instagram

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| `instagram.com/api/v1/oembed/` (existing) | free | caption, author, media id | $0 | none | Probe worked without a token. Meta announced tokenless oEmbed on 2026-06-15 (<https://developers.facebook.com/blog/post/2026/06/15/tokenless-access-to-meta-oembed-apis/>). Meta's Instagram oEmbed docs limit use to embedding and prohibit analytics (<https://developers.facebook.com/docs/instagram-platform/oembed>). No comments. |
| ScrapeCreators | paid | post details, comments (`/v2/instagram/post/comments`), replies, profile; 20 Instagram endpoints | 100 free calls; paid packs from $47 for 25,000 credits ($1.88 per 1,000); cache hits cost 0 | key, no card for free | <https://scrapecreators.com>, <https://docs.scrapecreators.com/>. A vendor tutorial page says $10 for 5,000 credits; the pricing page says $47. Unresolved. |
| HikerAPI | paid | media by URL (`/v2/media/info/by/url`), comments (15 per page, cursor), profile, followers | from $0.0006 per request; 100 free requests; successful responses incl. 403/404 are billed | key; card requirement not stated | <https://hikerapi.com>. Instagram only. Lowest unit price found. |
| SociaVault | paid | profiles, reels, hashtags, comments | 50 free credits; $29 for 6,000 credits; most endpoints 1 credit | key, no card for free | <https://sociavault.com>. |
| EnsembleData | paid | user info, user posts, post info (2 units), comments (4 units) (unit table is not labeled by platform; assignment is a guess) | free 50 units/day; Wood $100/month for 1,500 units/day | account, no card for free | <https://ensembledata.com/pricing>. The free tier covers 100 lookups per month on its own. |
| SocialKit | paid | transcript, summary, comments, details, video download | free 20 credits/month; $29/month for 12,000 | account | <https://www.socialkit.dev/pricing>. |
| Apify `apify/instagram-scraper` | paid | posts, reels, comments, profiles; replies need a paid plan | pay per result: $2.70 per 1,000 on free plan, $1.50 at the top tier; $5 free monthly platform credit | Apify account and token | <https://apify.com/apify/instagram-scraper>. Page shows 100% run success and 4.67 of 5 stars. Free plan returns about 15 comments per post. |
| Bright Data "Instagram - Posts" | paid | posts (comments scraper not listed) | $1.50 per 1,000 records; 5,000 free records/month | account | <https://brightdata.com/products/web-scraper>, <https://brightdata.com/pricing/web-scraper>. |
| Data365 | paid | posts, profiles (fields not shown) | not published; trial by contact form | contact form | <https://data365.co>. Poor fit for a zero-setup route. |

## Facebook

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| Meta oEmbed (tokenless) | free | embed HTML for a public post or video | $0 | none | Same terms as Instagram. No page or group listing. The Meta oEmbed Read page still says App Review is required (<https://developers.facebook.com/documentation/development/features-reference/oembed-read>); the blog post of 2026-06-15 says it is not. Not probed. |
| ScrapeCreators | paid | post, post comments, comment replies, group info, group posts (12 endpoints) | as above | as above | <https://docs.scrapecreators.com/>. Public groups only (inferred from "public data"; unverified). |
| SociaVault | paid | pages, posts, reels, ad library | as above | as above | <https://sociavault.com>. No comments listed. |
| SocialKit | paid | transcript, summary, comments, details, page details | as above | as above | <https://www.socialkit.dev>. |
| Supadata | paid | transcript and metadata for Facebook video | 100 credits/month free | key, no card | <https://supadata.ai/pricing>. Video only. |
| Apify Facebook actors | paid | posts about $2 per 1,000; groups about $2.60 per 1,000 (public groups only); comments $0.40 to $0.50 per 1,000 | $5 free monthly credit | Apify token | Guide: <https://use-apify.com/docs/best-apify-actors/best-facebook-scrapers>; comments actor: <https://apify.com/danek/facebook-comments-ppr>. Search-result prices; unverified. |
| Bright Data "Facebook - Pages Posts" | paid | page posts; groups and comments scrapers not listed | $1.50 per 1,000 records | account | <https://brightdata.com/products/web-scraper>. |
| Data365 | paid | listed as supported | not published | contact form | <https://data365.co>. |

EnsembleData does not list Facebook.

## LinkedIn

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| ScrapeCreators | paid | profile, post, post transcript (6 endpoints); no article endpoint | as above | as above | <https://docs.scrapecreators.com/>. |
| SocialKit | paid | profile, company, company posts, post, transcript | as above | as above | <https://www.socialkit.dev>. |
| SociaVault | paid | public profiles, posts, engagement (grouped with Threads and Twitch) | as above | as above | <https://sociavault.com>. |
| Apify no-cookie post actors | paid | posts from profiles, companies, post URLs; about $1.20 to $4 per 1,000 | $5 free monthly credit | Apify token | <https://apify.com/atomus/linkedin-posts-scraper-pro>, <https://apify.com/supreme_coder/linkedin-post> (one snapshot showed maintenance). "No cookies" is the developer's claim. No article-specific actor found. |
| Bright Data "LinkedIn posts" | paid | posts, "user's articles by URL" (partial), profile, company | $1.50 per 1,000 records | account | <https://brightdata.com/products/web-scraper>. The only service with an article route in the listing. |
| EnrichLayer | paid | People, Company, Jobs APIs (no LinkedIn post or article endpoint confirmed) | PAYG $10 for 100 credits; 1 to 3 credits per person | account; free credits not mentioned | <https://enrichlayer.com/pricing>. Profile enrichment, not post reading. |
| Netrows | paid | LinkedIn among 55+ sources; endpoints not shown | pricing page not read | account | <https://netrows.com>. Unverified. |
| Fresh LinkedIn Profile Data (RapidAPI) | paid | profile-oriented; post and article coverage not confirmed | not confirmed; a Clay forum user hit limits on a $45 plan | RapidAPI account | Search result only: <https://community.clay.com/x/general/msg_38fTP5izUMqh/looking-for-affordable-apis-to-identify-open-linke>. Unverified. |
| Proxycurl | dead | | | | Shut down 2025-07-04 after LinkedIn sued in January 2025 (<https://www.startuphub.ai/ai-news/startup-news/2025/the-1-linkedin-scraping-startup-proxycurl-shuts-down>). Its founder's NinjaPear does not scrape LinkedIn (<https://coresignal.com/blog/coresignal-vs-ninjapear-proxycurl-alternative/>). |

LinkedIn is the platform with active litigation against a data vendor. See ToS section.

## X / Twitter (threads and replies)

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| `api.fxtwitter.com`, syndication, oEmbed (existing) | free | single tweet | $0 | none | Single tweets only. |
| GetXAPI | paid | Tweet Thread (linear self-thread from any tweet, $0.005 per call), Tweet Replies ($0.001 per call, about 20 tweets), profile, search | $0.10 signup credit, no card; top-ups from $10, no expiry | account | <https://getxapi.com>. Method not stated. Newest vendor in the list; no reliability reports found. |
| twitterapi.io | paid | search $0.15 per 1,000 tweets, $0.00015 minimum per call; thread and reply endpoints not shown on the pricing page | bonus credits on recharge; free credits not stated | account | <https://twitterapi.io/pricing>. About 27 Trustpilot reviews, mostly positive; one 2025-12 review says support does not answer, one reports latency spikes up to a minute (<https://ca.trustpilot.com/review/twitterapi.io>, search summary). |
| ScrapeCreators | paid | tweet details, tweet transcript, user tweets, profile, search, community; no thread or replies endpoint | as above | as above | <https://docs.scrapecreators.com/>. Gap for threads. |
| SocialKit | paid | profile, tweets, tweet, thread, article, transcript | as above | as above | <https://www.socialkit.dev>. Lists a Thread endpoint. |
| EnsembleData | paid | user info, user tweets (4 units), post info (2 units), post replies (per reply) | free 50 units/day | as above | <https://ensembledata.com/pricing>. Replies billed per reply. |
| X API pay-per-use | paid, official | post read $0.005 per post returned; user read $0.010 | $20 free credit when a payment card is saved; auto-recharge needs a card | Developer Console, card | <https://docs.x.com/x-api/getting-started/pricing>. The page gives no price for conversation search. A 100-reply thread would cost about $0.50 if billed as post reads (unverified inference). The 3 million reads per month cap is far above personal use. Same-day repeat reads reportedly are not billed twice (<https://www.gigazine.net/gsc_news/en/20260209-x-api-pay-per-use/>, search summary). |
| Apify tweet scrapers | paid | search and conversation scraping; $0.10 to $0.30 per 1,000 tweets | $5 free monthly credit | Apify token | <https://apify.com/apidojo/tweet-scraper>, <https://apify.com/xquik/x-tweet-scraper>. One actor claims thread extraction; the price for that mode was not found. |
| Bright Data "X - Posts" | paid | posts | $1.50 per 1,000 records | account | <https://brightdata.com/products/web-scraper>. |

## TikTok

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| `tiktok.com/oembed` (existing) | free | title, author, thumbnail | $0 | none | No transcript, no comments. |
| ScrapeCreators | paid | video details, transcript (`/v1/tiktok/video/transcript`), comments, profile; 22 endpoints | as above | as above | <https://scrapecreators.com>. Largest TikTok endpoint set found. |
| Supadata | paid | transcript (1 credit, existing captions; 2 credits per minute if generated by AI) and metadata | 100 credits/month free; Basic $5/month; Pro $17/month for 3,000 | key, no card for free | <https://supadata.ai/pricing>. Comments not listed. |
| SocialKit | paid | transcript, summary, comments, video details | as above | as above | <https://www.socialkit.dev>. |
| SociaVault | paid | videos, comments, profiles, shop | as above | as above | <https://sociavault.com>. |
| EnsembleData | paid | user posts, post info, comments | free 50 units/day | as above | <https://ensembledata.com/pricing>. |
| Lamatok | paid | TikTok videos, profiles, comments, hashtags | $0.0025 to $0.02 per request (undated note) | unknown | Unverified; no vendor page read (<https://histre.com/public/notes/chase_ats/tag/workarounds>). |
| TikTok official (Display, Research API) | free, gated | | | app review | Research API is limited to non-commercial researchers at approved institutions (<https://www.xpoz.ai/blog/guides/tiktok-api-pricing-2026/>, search summary). Not usable for arbitrary URLs. |

## YouTube (transcripts from datacenter IPs)

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| yt-dlp / `youtube-transcript-api` (existing) | free | captions | $0 | none | The library's README says YouTube blocks most cloud-provider IPs; fixes are residential proxies or cookies (cookie accounts can be banned) (<https://github.com/jdepoix/youtube-transcript-api>, <https://discuss.huggingface.co/t/how-to-avoid-ip-bans-when-using-youtube-transcript-api-to-fetch-youtube-video-transcripts/165346>). A box runs on Hetzner, so expect blocks. |
| YouTube Data API captions | free, official | `captions.list` costs 50 units; `captions.download` costs 200 units and requires edit rights on the video | 10,000 units/day default | Google Cloud project | <https://developers.google.com/youtube/v3/docs/captions/list>. Useless for other people's videos (<https://transcriptapi.com/blog/youtube-api-quota-exceeded-transcripts>, search summary). |
| Supadata | paid | transcript with timestamps, languages, AI fallback; metadata | 100 credits/month free, no card; 1 credit per transcript | key | <https://supadata.ai/pricing>. A developer report says it works from cloud environments (Hugging Face thread above). |
| ScrapeCreators | paid | `/v1/youtube/video/transcript` (the page marks it "Featured"; the pricing page does not name a YouTube transcript endpoint), comments, replies | as above | as above | <https://docs.scrapecreators.com/>. |
| SocialKit | paid | transcript, summary, comments, search, video download | as above | as above | <https://www.socialkit.dev>. |
| TranscriptAPI and similar | paid | transcripts | not read | account | <https://transcriptapi.com/blog/youtube-transcript-api-not-working> exists; vendor blog only. Unverified. |

## Reddit (live comment trees after March 2027)

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| Arctic Shift (existing) | free | archived posts and comments | $0 | none | Third-party archive; stale scores; may stop. |
| `.rss` (existing) | free | thread feed | $0 | none | Ends 2026-11-13 (links above). |
| ScrapeCreators | paid | `/v1/reddit/post/comments` (GET and POST), 8 Reddit endpoints | as above | as above | <https://docs.scrapecreators.com/>. Whether replies are fully expanded was not stated. |
| SociaVault | paid | subreddits, posts, comments, search | as above | as above | <https://sociavault.com>. |
| EnsembleData | paid | subreddit posts (2 units), post comments (3 units) | free 50 units/day | as above | <https://ensembledata.com/pricing>. |
| Apify Reddit Scraper Lite | paid | posts and comments, about $3.40 per 1,000 results | $5 free monthly credit | Apify token | <https://apify.com/trudax/reddit-scraper-lite>. A related actor omits "load more" replies. |
| Bright Data | paid | "Reddit - Posts" listed; comments scraper not listed | $1.50 per 1,000 records | account | <https://brightdata.com/products/web-scraper>. |
| Reddit Data API | official, closing | | | | Public access closes March 2027; commercial deals only after that (links above). |

## Threads

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| Meta oEmbed (tokenless) | free | embed HTML for a post | $0 | none | Covers Threads per the 2026-06-15 post. Not probed. |
| Threads API | official | keyword search of public posts needs the `threads_keyword_search` permission and app approval; cap 2,200 queries per 24 hours | $0 | Meta app, review | <https://developers.facebook.com/documentation/threads/keyword-search>. Too much setup. |
| ScrapeCreators | paid | profile, user posts, single post, search (5 endpoints) | as above | as above | <https://docs.scrapecreators.com/>. |
| EnsembleData | paid | Threads listed among 8 platforms | free 50 units/day | as above | <https://ensembledata.com/pricing>. |
| SociaVault | paid | public profiles, posts, engagement | as above | as above | <https://sociavault.com>. |
| Apify Threads scrapers | paid | search, profiles, posts; about $1.80 per 1,000 | $5 free monthly credit | Apify token | <https://apify.com/getanyapi/threads-search-scraper>. |

## Quora

No multi-platform service lists Quora. ScrapeCreators, SociaVault, EnsembleData, Bright Data (page checked) and SocialKit do not.

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| Apify Quora actors | paid | questions with nested answers, profiles, spaces | $1 to $5 per 1,000 results | Apify token | <https://apify.com/scrapers-hub/quora-scraper-no-cookies>, <https://apify.com/blackfalcondata/quora-scraper>. Listings only; reliability not checked. |

## Pinterest

| Route | Type | Fields | Price | Setup | Notes |
|---|---|---|---|---|---|
| Pinterest oEmbed | free | pin embed | $0 | none | Not probed here; endpoint existence is unverified. |
| ScrapeCreators | paid | search, pin, user boards, board (4 endpoints) | as above | as above | <https://docs.scrapecreators.com/>. |
| SociaVault | paid | pins, boards, profiles, trends | as above | as above | <https://sociavault.com>. |
| Data365 | paid | listed as supported | not published | contact form | <https://data365.co>. |

## One key for many sites

| Service | Platforms covered (of the ten) | Free tier | Cheapest paid entry | Card at signup | Gaps | Source |
|---|---|---|---|---|---|---|
| ScrapeCreators | Instagram, Facebook, LinkedIn, X, TikTok, YouTube, Reddit, Threads, Pinterest (9) | 100 calls, up to 7,000 more for GitHub star and G2 feedback | $47 for 25,000 credits, no expiry | not required for free | Quora; X thread and replies; LinkedIn article | <https://scrapecreators.com> |
| SociaVault | Instagram, Facebook, LinkedIn, X, TikTok, YouTube, Reddit, Threads, Pinterest (9) | 50 credits | $29 for 6,000 credits, no expiry | not required for free | Quora; transcripts; comments only on Instagram, TikTok, YouTube, Reddit | <https://sociavault.com> |
| EnsembleData | Instagram, X, TikTok, YouTube, Reddit, Threads (6) | 50 units/day (about 1,500/month) | $100/month | not required for free | Facebook, LinkedIn, Pinterest, Quora | <https://ensembledata.com/pricing> |
| SocialKit | Instagram, Facebook, LinkedIn, X, TikTok, YouTube (6) | 20 credits/month | $29/month for 12,000 | not stated | Reddit, Threads, Pinterest, Quora | <https://www.socialkit.dev/pricing> |
| Supadata | YouTube, TikTok, Instagram, Facebook, X (transcripts and metadata only) | 100 credits/month | $5/month billed annually | not required | no comments, no profiles | <https://supadata.ai/pricing> |
| Apify | all ten through separate actors | $5 platform credit per month | $2 to $3 per 1,000 results, inside the credit | not required for free | one actor per site; actor quality varies; token covers all | <https://apify.com/pricing> |
| Bright Data scrapers | Instagram, Facebook, LinkedIn, X, TikTok, Reddit, YouTube (posts-level) | 5,000 records/month | $1.50 per 1,000 records | not required | comments scrapers mostly absent; Quora, Pinterest, Threads not listed | <https://brightdata.com/products/web-scraper> |
| Data365 | Instagram, Facebook, X, TikTok, Reddit, Threads, Pinterest | trial by request | not published | unknown | LinkedIn unconfirmed | <https://data365.co> |

Notes:

- Apify's paid Starter price appears as $19 per month in [fetch-services.md](fetch-services.md) and as $29 per month in a 2026 review (<https://www.usecarly.com/blog/apify-mcp/>). The free $5 credit covers personal volume either way. An AI client can start paid actors on its own, so set a usage limit in the console before connecting an agent (same review).
- Bright Data's 5,000 free records apply to the Web Scraper API page checked; the earlier note says its MCP structured scrapers may need a paid account (unverified).
- ScrapeCreators' unit cost per endpoint is not on the pages read; the pricing page says one credit per request for most endpoints.
- At 100 lookups per site per month across nine sites, about 900 calls per month fit inside ScrapeCreators' 100 free calls only for the first month. After that the cheapest recurring option is the $47 pack (credits do not expire, so one pack covers roughly two years at that volume) or EnsembleData's free daily quota for its six platforms.
- Excluded or not usable: Phyllo/InsightIQ are creator-account linking products that need the creator's consent, not URL lookup (unverified; pages not read). Lamadava: no source found.

## ToS, litigation and retention

- Meta v. Bright Data: the court granted Bright Data summary judgment on the contract claim in January 2024 and Meta dropped the suit in February 2024 (<https://techcrunch.com/2024/01/24/court-rules-in-favor-of-a-web-scraper-bright-data-which-meta-had-used-and-then-sued>, <https://techcrunch.com/2024/02/26/meta-drops-lawsuit-against-web-scraping-firm-bright-data-that-sold-millions-of-instagram-records>). Logged-out scraping has the better precedent. Vendors that use logged-in account pools sit on the other side of that line. None of the vendors above state which they use.
- X Corp v. Bright Data: claims partly dismissed; later revived (see fetch-services.md).
- LinkedIn sued Proxycurl in January 2025; Proxycurl closed in July 2025 (link above). LinkedIn vendors carry the highest continuity risk. Search results found no 2025 or 2026 suit by Meta against a data API vendor (search covered 2021 to 2024 material only).
- Instagram oEmbed terms prohibit use beyond embedding (Meta docs above). Using it as a fetch route conflicts with the stated terms even though the endpoint answers.
- Data retention and privacy policies of the vendors were not read. ScrapeCreators caches responses and bills cache misses only (<https://scrapecreators.com/blog/api-caching-free-cache-hits>), so a vendor holds a copy of looked-up URLs. Treat every URL sent to a vendor as disclosed to that vendor.
- Reliability reports: no independent practitioner reports found for ScrapeCreators, SociaVault, EnsembleData or Supadata beyond one developer comment on Supadata. ScrapeCreators' own benchmark against Apify reports 996 of 1,000 Instagram posts on the first attempt and 46 of 50 profiles for Reels versus 49 of 50 for Apify (vendor data, <https://scrapecreators.com/blog/apify-instagram-reels-scraper-benchmark>). The twitterapi.io Trustpilot reviews are the only user reviews found for a data API.

## Fit for a fallback adapter

Selection rule: free route first; then one multi-platform key; then Apify for the gaps.

| Site | First choice | Second | Reason |
|---|---|---|---|
| Instagram | oEmbed (caption); ScrapeCreators for comments and profile | HikerAPI, Apify `instagram-scraper` | ScrapeCreators has post comments and profile on one key. HikerAPI is cheaper per call but Instagram only. |
| Facebook | ScrapeCreators (post, comments, group posts) | Apify Facebook actors | Only ScrapeCreators, SocialKit and Apify list comments. |
| LinkedIn | ScrapeCreators (profile, post) | Bright Data (posts and articles), Apify no-cookie post actors | Articles have no confirmed route except Bright Data's partial listing. Do not use Proxycurl-style profile databases for posts. Highest legal and continuity risk. |
| X threads and replies | fxtwitter for single tweets; GetXAPI for thread and replies | official X API at $0.005 per post, EnsembleData | GetXAPI prices a thread call at $0.005. The official API has the least ToS risk and costs about $0.50 for a 100-reply thread (unverified inference); it needs a card. |
| TikTok | oEmbed (caption); ScrapeCreators for transcript and comments | Supadata (transcript), EnsembleData | ScrapeCreators has the largest TikTok endpoint set. |
| YouTube transcripts | Supadata | ScrapeCreators, SocialKit | Free 100 per month, no card, reported to work from cloud IPs. Local yt-dlp is a fallback only from non-datacenter IPs. |
| Reddit after March 2027 | ScrapeCreators comments endpoint | SociaVault, EnsembleData, Apify | Arctic Shift and `.rss` stay as free tiers while they last; `.rss` ends 2026-11-13. Check reply expansion before relying on any vendor. |
| Threads | ScrapeCreators | EnsembleData, Apify | Tokenless oEmbed gives text for single posts. |
| Quora | Apify Quora actor | none | Only option found. Needs an Apify token. |
| Pinterest | ScrapeCreators | SociaVault | Pin and board endpoints exist; low priority. |

Setup consequence: ScrapeCreators plus Supadata plus GetXAPI means three keys and about $47 of prepaid credit. ScrapeCreators plus Apify (for Quora and as a general second source) means two keys, with Apify's free credit covering Quora. Supadata's free tier is the only no-card transcript route found; ScrapeCreators also lists a YouTube transcript endpoint, so Supadata is optional if ScrapeCreators proves reliable from the box.

## Open items

- Probe ScrapeCreators with the free 100 calls on one URL per site, from the box's IP, before choosing. Check Reddit reply depth, X thread coverage, and the YouTube transcript endpoint.
- Confirm ScrapeCreators' price: $47 for 25,000 credits (pricing page) or $10 for 5,000 (vendor tutorials).
- Read the pricing pages for Netrows, Data365, Lamatok and the RapidAPI LinkedIn listings (not read).
- Confirm whether any vendor uses logged-in account pools.
- Confirm the X API price for conversation search in the Developer Console.
