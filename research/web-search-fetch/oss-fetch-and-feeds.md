# Open-source fetch and feed tools for a "look here" list (2026-10-15)

Context: a box agent keeps a per-box list of sources to re-check on each pass (a pottery-scene box: potters' own event pages, gallery calendars, art-center pages, newsletters, studios' Facebook and Instagram pages) and adds sources as it finds them through Exa search. This note covers the open-source libraries and self-hosted systems for that job. Hosted services are in [fetch-services.md](fetch-services.md) and [per-site-services.md](per-site-services.md); the overall plan is in [README.md](README.md).

The four needs:

- **(a) Watch a known source cheaply** for changes or new items.
- **(b) Read hard pages**: JS-rendered pages, embedded Google Sheets and Calendars, ticketing and registration platforms.
- **(c) Get social pages** (Instagram, Facebook pages and events) as feeds.
- **(d) Newsletters.**

Method: GitHub API for stars, last push, last release and license (read 2026-10-15); repository source for what each tool supports; live probes for URL patterns. Probes ran from a residential IP with at most 3 requests per host. A box runs on a Hetzner datacenter IP, so every "works" below is an upper bound for a box. Docker and PHP are not installed on this machine, so RSSHub and RSS-Bridge were not run locally.

## Findings in short

- **The highest-value finding is structural, not a tool.** Four of eight small arts-organization WordPress sites tried expose The Events Calendar REST API with no login (`/wp-json/tribe/events/v1/events`), and the one tried also serves an ICS export. Squarespace serves `?format=json` and `?format=rss` on an events collection. Google Calendar embeds map to a public ICS URL. Google Sheets embeds map to a CSV export URL. Eventbrite organizer pages carry schema.org `Event` JSON-LD in plain HTML. All of these were fetched with plain `curl`, no browser. A "look here" source entry should record the platform and the data URL, not only the page URL.
- **The public `rsshub.app` instance is unusable from a script.** All three routes tried (Instagram, Reddit, Facebook) returned a Cloudflare "Just a moment" challenge (HTTP 403). Self-hosting is the only route. RSSHub has no Reddit route in its current tree.
- **Social feeds are the weak spot.** Instagram and Facebook feeds from RSSHub, RSS-Bridge, gallery-dl and Instaloader work only with a logged-in cookie for anything beyond a few public posts, or break often; the risk lands on the account used. Paid per-site APIs in [per-site-services.md](per-site-services.md) are the lower-risk route.
- **Nitter is effectively gone** after X Corp's cease-and-desist letters in 2026-08. Redlib has had no commit since 2026-04, and Reddit ends RSS on 2026-11-13.
- **Change watching has a clear self-hosted answer:** changedetection.io (35k stars, Apache-2.0, release 2026-10-12), with a REST API, Playwright fetcher and Apprise notifications. For a box, a thin in-house watcher (hash of the extracted text or the structured data, per source) may be simpler than running a second service; see the ranking.
- **Hard-page libraries split into two groups.** Rendering without evasion: Playwright, Crawl4AI. Bot-detection evasion (fingerprint impersonation, challenge solving): Scrapling StealthyFetcher, Camoufox, nodriver/zendriver, patchright, CloakBrowser, curl_cffi, FlareSolverr, Byparr. The boxholder has not decided on evasion, so each is marked in the table.

## Table

Stars and dates from the GitHub API on 2026-10-15. "Evasion" = TLS or browser fingerprint impersonation, or CAPTCHA/challenge solving, as a stated purpose. Fit is for the look-here list: **high**, **medium**, **low**, **no**.

| Tool | Kind | License; maintained | Reaches | Needs login? | Evasion? | Fit |
|---|---|---|---|---|---|---|
| [RSSHub](https://github.com/DIYgod/RSSHub) | Self-host feed generator (Node) | AGPL-3.0; 46.5k stars; release tag 2026-10-15 | ~1,977 route namespaces: Instagram, Facebook page/group, X, Telegram, Mastodon, Threads, Eventbrite city listings, YouTube, Bandcamp; generic HTML/JSON transform routes | Instagram stories/highlights/tags need cookie; Facebook and X need cookie for much; X needs `TWITTER_AUTH_TOKEN` | no (flags `antiCrawler`) | medium |
| [RSS-Bridge](https://github.com/RSS-Bridge/rss-bridge) | Self-host feed generator (PHP) | Unlicense; 9.3k; last push 2026-10-13; last tagged release 2025-08-05 | FacebookBridge, InstagramBridge, TwitterBridge, TelegramBridge, YouTube, RedditBridge, CssSelectorBridge, XPathBridge, FilterBridge | Facebook: public pages only, login walls fail; Instagram: not stated | no | medium |
| Feed43, FetchRSS, RSS.app | Hosted page-to-feed | Closed; hosted | Any page by selector; RSS.app and FetchRSS list Instagram and Facebook feeds | Account; paid tiers | not stated | note only |
| [PolitePol](https://politepol.com) | Hosted page-to-feed (also open source) | Status unverified; the GitHub repo search found no maintained copy | Page to feed by click selection | Account | no | low |
| [morss](https://github.com/pictuga/morss) | Self-host feed full-text proxy (Python) | AGPL-3.0; 788 stars; last push 2024-04 | Adds full text to existing feeds | no | no | no (stale) |
| [changedetection.io](https://github.com/dgtlmoon/changedetection.io) | Self-host change watcher (Python/Flask) | Apache-2.0; 35k; release 0.60.9 on 2026-10-12 | Any URL; text, JSON, XPath/CSS/jq filters; restock/price; RSS output | no | no (plain fetch, or Playwright/Puppeteer/WebDriver for JS) | high |
| [urlwatch](https://github.com/thp/urlwatch) | Self-host change watcher (Python CLI) | Source tree has a COPYING file; API reports no SPDX id (BSD-3-Clause per project site, unverified); 3.1k; last push 2026-07-10 | URL, shell command, browser job; unified diff | no | no | medium |
| [Huginn](https://github.com/huginn/huginn) | Self-host agent/workflow system (Ruby) | MIT; 50k; release 2026-10-13 | WebsiteAgent scrape, RSS, IMAP, webhooks, digests | no | no | low (heavy; overlaps the box agent) |
| [FreshRSS](https://github.com/FreshRSS/FreshRSS) and [Miniflux](https://github.com/miniflux/v2) | Self-host feed readers | AGPL-3.0 / Apache-2.0; 16k / 9.8k; pushed 2026-10 | FreshRSS: XPath/JSON "web scraping" feeds; Miniflux: scraper rules, RSS-Bridge hook | no | no | low (reader UIs; the box needs an API, not a UI) |
| [Kill the Newsletter](https://github.com/leafac/kill-the-newsletter) | Self-host email to Atom | MIT; 3.1k; release v2.1.3 on 2026-10-03 | Newsletters sent to a generated address | no | no | medium (the box's own mailbox may replace it) |
| [gallery-dl](https://github.com/mikf/gallery-dl) | Media/metadata downloader (Python) | GPL-2.0; 20k; release v1.32.16 on 2026-10-09 | Instagram (posts, reels, stories, highlights, tag search, user info), Facebook (albums, photos, profiles, videos), X, Bluesky, Tumblr, many more | Instagram and Facebook: cookies (listed as the auth method) | no | medium |
| [Instaloader](https://github.com/instaloader/instaloader) | Instagram downloader (Python) | MIT; 13.6k; release v4.15.4 on 2026-10-12 | Instagram profiles, posts, stories, hashtags | Anonymous works at low volume; login for stories and heavier use | no | low-medium |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Video/metadata extractor (Python) | Unlicense; 198k; release 2026.08.19 | YouTube (transcripts, listings); Facebook video and reel; Instagram post/story/tag; Vimeo; many | Instagram user extractor listed "Currently broken"; cookies for private items | no | medium (YouTube only) |
| [twscrape](https://github.com/vladkens/twscrape) | X search/GraphQL client (Python) | MIT; 2.9k; release v0.20.1 on 2026-08-25 | X posts, search, users | Yes: an account pool (cookies or credentials) | no | low (ban risk, see below) |
| [Redlib](https://github.com/redlib-org/redlib) | Reddit front end (Rust) | AGPL-3.0; 3.8k; last push 2026-04-24; last release 2025-03-20 | Reddit pages and feeds | no | no | no (stale; Reddit closing RSS and API) |
| [Nitter](https://github.com/zedeus/nitter) | X front end (Nim) | AGPL-3.0; 14.5k; repository flagged archived; commits 2026-09-06 and 2026-10-09 are README edits | X profiles | Needs guest/session tokens | no | no |
| [Crawl4AI](https://github.com/unclecode/crawl4ai) | Crawler to Markdown (Python) | Apache-2.0; 85.6k; release v0.9.5 on 2026-10-14 | JS-rendered pages through Playwright; Docker server with REST; hosted cloud exists | no | Has proxy, session and hook options; it is not marketed as an evasion tool | medium |
| [Playwright](https://github.com/microsoft/playwright) | Browser automation (Node, Python) | Apache-2.0; 97.8k; release v1.64.1 on 2026-10-14 | Any page a browser reaches | no | no | high (as the render step) |
| [Scrapling](https://github.com/D4Vinci/Scrapling) | Scraping framework (Python) | BSD-3-Clause; 87.9k; release v0.4.15 on 2026-08-23 | `Fetcher` (HTTP), `DynamicFetcher` (Playwright), `StealthyFetcher`; adaptive selectors; MCP server | no | **Yes** for StealthyFetcher: README says it handles Cloudflare Turnstile | medium |
| [Camoufox](https://github.com/daijro/camoufox) | Patched Firefox for automation (Python, Node via Playwright) | MPL-2.0; 12.6k; beta releases v156.0.1-beta.39 on 2026-10-15; README says "under development" | Any page, with spoofed fingerprint | no | **Yes** (fingerprint spoofing) | medium |
| [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) and [patchright-nodejs](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs) | Patched Playwright (Python, Node) | Apache-2.0; 4.9k / 0.8k; pushed 2026-10-15 / 2026-09-13 | Same as Playwright, fewer automation leaks | no | **Yes** | low |
| [nodriver](https://github.com/ultrafunkamsterdam/nodriver) and [zendriver](https://github.com/cdpdriver/zendriver) | CDP-driven Chrome without WebDriver (Python) | AGPL-3.0 both; 4.8k / 1.5k; pushed 2026-10-08 / 2026-10-02 | Any page | no | **Yes** (undetected-Chrome lineage) | low (AGPL, Python only) |
| [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) | Patched Chromium, Playwright drop-in | MIT; 32k; pushed 2026-10-14; claims unverified | Any page | no | **Yes** (README: passes bot-detection tests) | low |
| puppeteer-extra stealth plugin ([puppeteer-extra](https://github.com/berstend/puppeteer-extra)) | Stealth patches for Puppeteer/Playwright (Node) | MIT; 7.4k; last push 2024-07-18 | Any page | no | **Yes** | no (stale) |
| [curl_cffi](https://github.com/lexiforest/curl_cffi) | HTTP client with browser TLS/JA3 impersonation (Python) | MIT; 6.7k; release v0.16.4b1 on 2026-09-20 | Server-HTML pages that block non-browser TLS | no | **Yes** (TLS/HTTP2 fingerprint) | low-medium |
| [curl-impersonate](https://github.com/lwthiker/curl-impersonate) and [fork](https://github.com/lexiforest/curl-impersonate) | curl build with browser TLS fingerprints | MIT; original last push 2024-07; fork 2.8k, pushed 2026-10-07 | Same as curl_cffi, as a CLI | no | **Yes** | low |
| [wreq](https://github.com/0x676e67/wreq) and wreq-js | Rust HTTP client with browser emulation; a JS port exists | Apache-2.0; 1.1k; pushed 2026-10-15 | Same class as curl_cffi, for Rust and Node | no | **Yes** | low (Node option if impersonation is approved) |
| [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) | HTTP proxy that solves Cloudflare/DDoS-Guard challenges with a real browser | MIT; 15.9k; release v3.5.2 on 2026-09-12 | Cloudflare-fronted sites; JSON API (`request.get`, sessions) | no | **Yes** (challenge solving) | low |
| [Byparr](https://github.com/ThePhaseless/Byparr) | FlareSolverr-compatible API on a different engine | GPL-3.0; 2k; release v3.0.4 on 2026-08-18 | Same as FlareSolverr | no | **Yes**; README says it does not guarantee a bypass and that challenges often need clean network traffic | low |
| [Defuddle](https://github.com/kepano/defuddle), [Readability](https://github.com/mozilla/readability), [Trafilatura](https://github.com/adbar/trafilatura) | Main-content extractors | MIT / Apache-2.0 / Apache-2.0; 9.7k / 11.5k / 7k; releases or pushes within 3 months | Article text from HTML already fetched | no | no | note only (already in use) |
| [node-ical](https://github.com/jens-maus/node-ical), [ical.js](https://github.com/kewisch/ical.js), [icalendar](https://github.com/collective/icalendar), [recurring-ical-events](https://github.com/niccokunzmann/python-recurring-ical-events) | ICS parsers | Apache-2.0 / MPL-2.0 / see repo / LGPL-3.0; all pushed 2026-10 | ICS text to events; the Python recurrence library expands RRULEs in a window | no | no | high |
| [extruct](https://github.com/scrapinghub/extruct) | Embedded-metadata extractor (Python): JSON-LD, microdata, OpenGraph | BSD-3-Clause; 1k; pushed 2026-10-15 | Eventbrite and other schema.org `Event` data | no | no | medium (Node can parse `ld+json` with a regex and `JSON.parse`) |

## Feed generators

### RSSHub

- Self-host with `docker run -d --name rsshub -p 1200:1200 diygod/rsshub`; the `diygod/rsshub:chromium-bundled` tag adds Puppeteer for routes that need it ([deploy docs](https://docs.rsshub.app/deploy/)). The deploy page does not state limits for the public instance.
- **Public instance probe (2026-10-15):** `https://rsshub.app/instagram/user/natgeo`, `/reddit/subreddit/Pottery` and `/facebook/page/NASA` each returned HTTP 403 and a Cloudflare "Just a moment..." page, with a plain `curl` user agent. A script cannot use the public instance.
- **Instagram:** route `/instagram/user/:key`. Posts for a user work without a cookie in code; stories, highlights and hashtags throw `ConfigNotFoundError` without `INSTAGRAM_COOKIE` (needs `sessionid` and `ds_user_id`). Source: `lib/routes/instagram/index.ts`. The route sets `antiCrawler: true`.
- **Facebook:** `/facebook/page/:id` reads page content through Facebook's page plugin and works for pages and some public profiles; "posts behind a login wall require `FACEBOOK_COOKIE`" (`c_user` and `xs`); the route description says to set it on `Rate limit exceeded`. `/facebook/group` also exists. Source: `lib/routes/facebook/page.ts`. I did not run it, so how many page posts it returns without a cookie is unverified.
- **X:** `/twitter/user/:id` requires `TWITTER_AUTH_TOKEN` (an account cookie) or a third-party API setting.
- **Telegram:** `/telegram/channel/:username` reads the public `t.me/s/` preview; no login. Not probed.
- **Reddit:** no Reddit directory in the current route tree (checked all 9,721 tree paths). Reddit also ends RSS on 2026-11-13 ([TechCrunch](https://techcrunch.com/2026/09/30/reddit-is-killing-rss-feeds-ending-public-api-access-because-of-ai-bots/)).
- **Events:** `/eventbrite/:region/:eventType?` scrapes Eventbrite city listings (not organizer pages). No generic ICS route found; no Meetup, Luma or Squarespace routes found.
- **Generic transform routes:** `lib/routes/rsshub/transform` provides HTML and JSON to feed conversion with CSS selectors. This is the RSSHub route for sites without a feed. It fetches server HTML only (a Puppeteer variant is a separate route type).
- **License note:** AGPL-3.0. Running it as a separate service and calling it over HTTP keeps it outside the box codebase.

### RSS-Bridge

- PHP, Unlicense. Last push 2026-10-13; the last tagged release is 2025-08-05, so people run it from `master` or the Docker image. Active commits include new bridges the same week.
- Bridges present in `bridges/`: `FacebookBridge`, `InstagramBridge`, `TwitterBridge`/`TwitterV2Bridge`, `TelegramBridge`, `RedditBridge`, `YoutubeBridge`, `CssSelectorBridge`, `CssSelectorComplexBridge`, `CssSelectorFeedExpanderBridge`, `XPathBridge`, `FilterBridge`.
- **FacebookBridge:** modes User (page/profile) and Group. Code comments say pages that need a login are served without Open Graph metadata and fail, and that non-public groups show a login page. A "fix user post extraction" commit landed 2026-08-08, so Facebook changes break it and maintainers patch it. Public pages only.
- **InstagramBridge:** commits 2026-08-01 ("fix(instagram)") and 2026-10-04. Whether it works anonymously from a datacenter IP is unverified.
- **CssSelectorBridge / XPathBridge:** these turn any server-rendered page into a feed by selector. They cover the "no feed" case without a login; they do not run JavaScript.
- Runs as a PHP app (Docker image available); I could not run it here (no PHP or Docker).

### Hosted page-to-feed (note only)

- **RSS.app**, **FetchRSS** and **Feed43** turn pages into feeds by selector; RSS.app and FetchRSS also advertise Instagram and Facebook page feeds. Prices found are secondary-source and undated: RSS.app listed at a free tier of 2 feeds with 24-hour refresh ([directory listing](https://thegtmdirectory.com/tools/rssapp/md)); FetchRSS listed at $4.95 to $9.95 a month ([Information Today](https://www.infotoday.com/OnlineSearcher/Articles/Features/RSS-The-Most-Useful-Dead-Technology-on-the-Internet-139013.shtml?PageNum=2)). Unverified. Each needs an account and sees every URL.
- **PolitePol:** a 2022 review describes a free tier without script-loaded pages and with feed expiry after inactivity; current status unverified. **morss:** last push 2024-04; skip.

## Change watchers

### changedetection.io

- Apache-2.0; 35k stars; release 0.60.9 on 2026-10-12. `docker run -d --restart always -p 127.0.0.1:5000:5000 -v datastore-volume:/datastore dgtlmoon/changedetection.io`.
- Fetchers in `content_fetchers/`: plain `requests`, Playwright, Puppeteer, WebDriver (Selenium). The README recommends a separate `sockpuppetbrowser` container for JS pages. Visual Selector and Browser Steps require the Playwright fetcher.
- Filters: CSS, XPath 1 and 2, JSONPath, jq, regex, "ignore text", "trigger on text". It can parse JSON embedded in HTML. This fits the structured-data sources in the next section: watch the Tribe JSON, the Squarespace JSON or an ICS file and get diffs of only the changed events.
- Processors: text/JSON diff and restock/price (per-product price graphs).
- Notifications through Apprise (email, webhooks, chat apps). It can create an RSS feed of detected changes. A REST API exists (`changedetectionio/api/`: Watch, Tags, Notifications, Search, Import, SystemInfo); an API key is required. Not exercised here.
- Cost: one Python container plus an optional Chrome container. State lives in a datastore volume. The box would run it as an extra service with an extra port and key to hold.

### urlwatch

- Python CLI, YAML job list, cron-driven, unified diff output; `browser` job type for JS pages. Last push 2026-07-10. License: a `COPYING` file exists and the API reports no SPDX id; the project site says BSD-3-Clause (unverified here). Simpler than changedetection.io and easier to drive from files, but with no UI, API or Apprise.

### Huginn

- MIT, 50k stars, release 2026-10-13. Event-graph agents: WebsiteAgent (scrape with CSS/XPath/JSON), RSS, IMAP and webhook agents, digests. It duplicates what the box agent and a watcher already do. Skip unless the boxholder wants a visual workflow layer.

### A thin in-box watcher (comparison, no code written)

For the sources in the next section, the cheapest check is one conditional GET or one small JSON request per source, then a hash of the normalized event list. It needs no browser. Signals available before fetching a page body: HTTP `ETag`/`Last-Modified` (not tested here), the Tribe API's per-event `modified` field, sitemap `lastmod` (WordPress and Wix sitemaps carry it; Wix lists an `event-pages-sitemap.xml` with its own `lastmod`), and ICS `X-PUBLISHED-TTL`/`REFRESH-INTERVAL` hints.

## URL patterns for event sources

All patterns below were fetched with plain `curl` and a descriptive user agent unless marked unverified. "OK" means HTTP 200 and the expected content type.

### WordPress with The Events Calendar (Tribe)

- **REST:** `https://SITE/wp-json/tribe/events/v1/events?per_page=50` returns JSON `{events, rest_url, next_rest_url, total, total_pages}`. Default window starts at today and runs 2 years ahead (`start_date`, `end_date` echoed in `next_rest_url`). Page with `&page=N`, or follow `next_rest_url`. Other parameters from the plugin's REST docs (unverified here): `search`, `categories`, `tags`, `venue`, `organizer`, `featured`, `starts_after`, `ends_before`.
- **Event fields seen:** `id`, `title`, `url`, `start_date`, `end_date`, `all_day`, `timezone`, `utc_start_date`, `description`, `excerpt`, `cost`, `categories`, `tags`, `venue`, `organizer`, `website`, `image`, `modified`, `modified_utc`, `ticketed`, and `is_virtual`/`virtual_url` on newer versions. `modified` supports a "changed since last pass" check.
- **ICS export:** `https://SITE/events/?ical=1` returned `text/calendar` with 17 `VEVENT`s for Baltimore Clayworks (plugin `ECPv6.18.1`; headers `X-PUBLISHED-TTL:PT1H`). The events page slug can differ (`/calendar/` at Northern Clay Center).
- **Plain WordPress:** `/feed/` returned RSS (71 KB) on Northern Clay Center. `/wp-sitemap.xml` or the Yoast `/sitemap_index.xml` list sitemaps with `lastmod`. Posts API `/wp-json/wp/v2/posts?per_page=10` exists on most WordPress sites (not probed).
- **Other event plugins (unverified):** Modern Events Calendar and Events Manager have their own endpoints; detect by fetching the page and looking for plugin paths under `/wp-content/plugins/`.

### Squarespace

- **Events collection:** `https://SITE/events?format=json` returned 449 KB of JSON with `upcoming` (2 items) and `past` (30 items) arrays and `collection.typeName: "events"`. Item fields include `title`, `fullUrl`, and `startDate` in epoch milliseconds (e.g. `1795215600908`).
- **RSS:** `https://SITE/events?format=rss` returned RSS with 22 `item`s. The `pubDate` is the item's publish date, not the event date, so use JSON for dates. The XML comment names `squarespace.com`.
- **Same pattern for blog collections:** `/blog?format=rss`, `/blog?format=json`. Works for any collection page whose URL slug is known (probed on one site).
- **`?format=ical` on the collection URL** returned the HTML page, not an ICS. Squarespace documents "Add to calendar" at the single event page level; whether `?format=ical` works on an event item URL is unverified.
- **Detect Squarespace:** response header `server: Squarespace`; URL shape `/events/2025/11/21/slug`.
- Probed site: Ben Owen Pottery (Seagrove). Three requests.

### Wix

- **Server-rendered text is thin.** The home page of a sample Wix site was 800 KB and held about 200 words of visible text, so a text extractor sees little; the data lives in scripts and API calls.
- **Blog feed:** `https://SITE/blog-feed.xml` returned RSS (empty channel on the sample); the home page `<link rel="alternate">` advertises it. Wix Blog only.
- **Sitemap:** `https://SITE/sitemap.xml` returned a sitemap index listing `event-pages-sitemap.xml` and `booking-services-sitemap.xml` with `lastmod` dates. Fetching `event-pages-sitemap.xml` gives event page URLs (not fetched; the sample's events sitemap was last modified 2021-04-13). The event pages themselves are the Wix Events app; their detail pages are the readable unit.
- **Wix Events app:** no public feed or JSON endpoint found. A rendered page read (headless browser) is the fallback. Not probed beyond the three requests.
- Probed site: Wortendyke Studio (Wix subdomain).

### Google Calendar embeds

- **Embed URL form:** `https://calendar.google.com/calendar/embed?src=CALENDAR_ID&ctz=...` (new embeds sometimes encode the id in base64 in `src` or `cid`; decode before use). The `<iframe>` is in the page's static HTML.
- **Public ICS:** `https://calendar.google.com/calendar/ical/URL_ENCODED_CALENDAR_ID/public/basic.ics`. Verified on Google's public US holidays calendar: HTTP 200, `text/calendar`, 317 `VEVENT`s, 121 KB. This works only when the owner shares the calendar publicly with event details; a calendar that shows only free/busy returns events without titles, and a private calendar returns 404.
- **Secret-address ICS:** `.../ical/ID/private-TOKEN/basic.ics`. A secret address is a credential; a box should not store one it was not given.
- Parse with `node-ical` or `ical.js`; use `recurring-ical-events` (Python) or an RRULE library to expand recurring events inside a date window.

### Google Sheets embeds

- **CSV export:** `https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv&gid=TAB_GID` returned 200 `text/csv` on Google's public sample sheet. Requires "anyone with the link" view access.
- **gviz CSV:** `https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/tq?tqx=out:csv&sheet=TAB_NAME` also returned CSV (with blank padding columns on the sample).
- **`/pubhtml`** returned 401 on the sample because that sheet was not "published to the web". Published sheets use `/d/e/PUBLISHED_ID/pub?output=csv`.
- Finding the id: the embed `<iframe src>` or a link in the page contains `/spreadsheets/d/SHEET_ID/`.

### Eventbrite

- **Organizer and collection pages** (`/o/name-ID`, `/cc/name-ID`): plain `curl` returned 351 KB of HTML with two `application/ld+json` blocks: an `ItemList` of schema.org `Event`s (name, url, `startDate`, `endDate`, description) and a `ProfilePage` for the organizer. No JavaScript rendering needed. Probed on a Vancouver collection page.
- RSSHub's Eventbrite route covers city listings, not organizer pages. Eventbrite's official API needs an account token (not used here).

### Ticketing and registration platforms (desk research; none probed)

- **ActiveNet / Active Communities:** ACTIVE Network documents an Activity Search API with a developer key, and a third-party report puts the key limit at 2 calls per second ([Supergood API report card](https://supergood.ai/api-report-card/active-network)). Public activity-search pages call a JSON endpoint from the browser; the exact path is unverified. A browser-network capture of the site's search page would show it.
- **Eleyo:** each organization has its own subdomain (e.g. `minnetonka.ce.eleyo.com`); I found no public API or feed. Plan on a rendered page read.
- **BoothCentral, EntryThingy:** no API, feed or iCal found. EntryThingy's classic version retired in March 2026 ([notice](https://www.entrythingy.com/94)). Plan on a rendered page read or a human-supplied link.
- General rule for these platforms: open the page in a browser with the network tab, look for a JSON call, and fall back to rendered text.

### Other event-page structures worth a check (unverified)

- Plain HTML pages often carry schema.org `Event` JSON-LD; `extruct` or a regex over `<script type="application/ld+json">` reads it (confirmed on Eventbrite, not tested elsewhere).
- Libraries and parks use CivicPlus, LibCal, Localist or Trumba calendars, which usually offer `.ics` and `.rss` export links on the page. Look for `webcal://`, `.ics` and `RSSFeed` links in the HTML.
- Standard feed autodiscovery: `<link rel="alternate" type="application/rss+xml|atom+xml">` in `<head>` (confirmed on Wix). Libraries: [feedsearch-crawler](https://github.com/DBeath/feedsearch-crawler) (Python, repository not checked) and similar; unverified.

## Social

| Platform | Routes found | Login | Risk |
|---|---|---|---|
| Instagram | RSSHub `/instagram/user`; RSS-Bridge InstagramBridge; gallery-dl; Instaloader; yt-dlp posts and stories | Cookie for stories/highlights and heavier use | Account ban or challenge; datacenter IPs throttled harder |
| Facebook pages | RSSHub `/facebook/page`; RSS-Bridge FacebookBridge; gallery-dl | Public page posts partly work logged out; a login wall appears after a few | Rate limits; cookie account at risk |
| Facebook events | No open-source route found for page event lists | n/a | Use the page's own website or ticketing link |
| X | RSSHub, twscrape, gallery-dl | Account cookie or account pool | Account suspension; Nitter shut down |
| Reddit | Redlib, RSS-Bridge, gallery-dl | Varies | RSS ends 2026-11-13; public API closing by 2027-03 |
| Telegram | RSSHub `/telegram/channel`, RSS-Bridge | No (public preview) | Low |

- **gallery-dl:** the supported-sites table lists Instagram (posts, reels, stories, highlights, tag searches, user info) and Facebook (albums, photos, videos, user profiles) with "Cookies" as the authentication method ([supportedsites](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md)). It downloads media and writes metadata JSON (`--write-metadata`), so it works as a posts-and-captions reader. Cookies from a browser session are the path, which puts the real account at the risk below.
- **Instaloader:** `instaloader --login=NAME profile NAME` stores session cookies. Its troubleshooting page says services with shared IP addresses (cloud, VPN, public proxies) "might be subject to significantly stricter limits for anonymous access", and that logged-in access does not appear to be affected ([docs](https://git.sudo.is/mirrors/Instaloader/src/branch/master/docs/troubleshooting.rst)). That trades a datacenter-IP throttle for account-ban risk.
- **yt-dlp:** the Instagram user extractor is marked "Currently broken" in `supportedsites.md`; single posts and stories extract. Facebook video and reels extract. Its main value here is YouTube (already used for transcripts).
- **Account-ban risk:** every cookie or login route uses an account the platform can restrict. Third-party guides report temporary login blocks from minutes to 24 hours after repeated attempts ([Storrito help](https://storrito.com/help-center/common-error-messages)). A throwaway account carries less loss, but account creation can need a phone number (unverified). Instagram and Facebook terms restrict automated access; legal posture is in [fetch-services.md](fetch-services.md#tos-and-legal-posture).
- **Instagram without any of these:** the oEmbed route in [per-site-services.md](per-site-services.md) returns caption and author for a known post URL with no token. It does not list a profile's posts.
- **Nitter:** X Corp sent cease-and-desist letters on 2026-08-24; nitter.net went offline and the repository was archived ([TechCrunch](https://techcrunch.com/2026/08/25/x-sends-cease-and-desist-to-open-source-project-nitter-over-alleged-scraping/)). A 2026-09-07 report says the developer intends to continue ([Privacy Guides](https://www.privacyguides.org/news/2026/09/07/alternate-x-com-frontend-nitter-announces-it-will-be-continue-despite-the-cease-and-desist/)). The GitHub API still shows `archived: true`. Treat as unavailable.
- **twscrape:** needs an account pool with per-account proxies; the README says it rotates accounts when one hits a rate limit, and its sponsor is a residential-proxy vendor. This is the account-burning model.

## Hard-page fetch

Split by purpose. Evasion items are neutral facts, with no recommendation.

**Rendering without evasion**

- **Playwright** (Node and Python, Apache-2.0): the standard way to render a JS page. The box has no headless browser today ([README.md](README.md)); adding Chromium to the image is the main cost.
- **Crawl4AI:** wraps Playwright, returns Markdown, has a Docker server with a REST endpoint (`curl ... -d '{"url": ...}'` returns `markdown`) and an MCP option. It has proxy, session and hook controls; evasion is not its stated purpose. A hosted cloud also exists (`api.crawl4ai.com`), which would be a vendor seeing every URL.
- **Plain fetch plus structured data** from the section above makes many renders unnecessary.

**Bot-detection evasion (undecided by the boxholder)**

- **TLS/HTTP fingerprint impersonation:** `curl_cffi` (Python), `curl-impersonate` (original unmaintained since 2024-07; the lexiforest fork is active), `wreq` (Rust) and a JS port. They make a plain HTTP request look like a Chrome or Safari handshake. No browser needed; JS pages still do not render.
- **Patched browsers:** Camoufox (Firefox with spoofed fingerprint, beta releases daily, MPL-2.0), patchright (Playwright with leak patches), CloakBrowser (patched Chromium, MIT; its pass-every-test claim is unverified), nodriver and zendriver (AGPL-3.0), puppeteer-extra stealth (stale since 2024-07).
- **Challenge solvers as services:** FlareSolverr (MIT, v3.5.2 on 2026-09-12) and Byparr run a real browser behind a local HTTP API and wait out or solve Cloudflare challenges. FlareSolverr's own README says not to expose it to the internet. Byparr's README says a bypass is not guaranteed and that challenges likely need clean network traffic; that is a statement about IP reputation, which a Hetzner IP lacks. An open FlareSolverr issue from 2025-08 reports failures behind a proxy.
- **Scrapling:** a framework with three fetch tiers. `StealthyFetcher` is the evasion tier (README: Cloudflare Turnstile handled "out of the box"); `Fetcher` and `DynamicFetcher` are plain HTTP and Playwright. The README lists commercial proxy sponsors.
- Effect on Hetzner: none of these change the IP. Datacenter IP blocks stay.

## Newsletters

- **Kill the Newsletter** (MIT, v2.1.3 on 2026-10-03): creates a random email address and an Atom feed per newsletter. The hosted site is `kill-the-newsletter.com`; self-hosting needs an SMTP listener on a public host (deployment guide linked in its README). Subscribing through a hosted instance sends the box's reading list to a third party.
- **Box mailbox:** a Cloudflare Email Worker mailbox is planned for one box. With its own address the box can subscribe to newsletters directly and read the mail, so Kill the Newsletter adds a layer without adding reach. Confirmation emails and sign-up forms still need handling: a form on a studio's site is a page the agent must submit, and a Squarespace or Mailchimp form may use CAPTCHA. Mailchimp "view in browser" archive pages are public HTML and can enter the look-here list as web sources (not probed).

## Probe results

| Probe | Host | Result |
|---|---|---|
| WordPress Tribe REST, `?per_page=2` | baltimoreclayworks.org | 200 JSON, 12 upcoming events, 6 pages |
| | northernclaycenter.org | 200 JSON, 197 upcoming events |
| | archiebray.org | 200 JSON, 4 events |
| | penland.org | 200 JSON, 15 events |
| | mudflat.org | 301, empty |
| | andersonranch.org | 403 HTML |
| | sunvalleycenter.org | 404 |
| | a Worcester craft center | connection error (host guess was wrong) |
| Tribe ICS `/events/?ical=1` | baltimoreclayworks.org | 200 `text/calendar`, 17 events |
| WordPress `/feed/`, `/wp-sitemap.xml` | northernclaycenter.org | 200 RSS 72 KB; sitemap index with `lastmod` |
| Squarespace `?format=json`, `?format=rss`, `?format=ical` | benowenpottery.com | JSON 200 (2 upcoming, 30 past); RSS 200 (22 items); ical returned HTML |
| Wix home, `/sitemap.xml`, `/blog-feed.xml` | wortendykestudio.wixsite.com | 200; ~200 words visible; sitemap index with events sitemap; blog feed 200 (empty) |
| Google Calendar public ICS | calendar.google.com (US holidays) | 200 `text/calendar`, 317 events |
| Google Sheets `export?format=csv`, `gviz`, `pubhtml` | docs.google.com (Google sample sheet) | CSV 200; gviz CSV 200; pubhtml 401 |
| Eventbrite collection page | eventbrite.com `/cc/workshops-4006143` | 200; JSON-LD `ItemList` of `Event`s |
| RSSHub public instance: Instagram, Reddit, Facebook routes | rsshub.app | 403 Cloudflare challenge on all three |
| RSS-Bridge / RSSHub via Docker | local | skipped: no Docker (not installed; not installing) |

Notes: Tribe availability on 4 of 8 tried is a sample of arts organizations found by guessing domains, not a survey. The Baltimore Clayworks `venue` fields came back as empty arrays in the first two events, so location may need the event page. Nothing here used a login, a cookie or an evasion tool.

## Fit for a look-here list

Ranked by value per unit of operating cost.

1. **Platform detection plus data URL per source** (WordPress Tribe REST/ICS, Squarespace JSON, Eventbrite JSON-LD, Google Calendar ICS, Google Sheets CSV, Wix sitemap). No new service; plain HTTP; structured dates; cheap change signals (`modified`, `lastmod`, a content hash). The look-here entry stores `{page, platform, dataUrl}`. A detector runs once when a source is added. Parsers: `node-ical` or `ical.js`; `recurring-ical-events` if Python is used for recurrence.
2. **Plain-fetch change watch with a stored hash**, built in the box. Use changedetection.io only if the boxholder wants a UI, Apprise notifications, or JSON/XPath filtering without code. If run, give it the Playwright container only for sources that need rendering.
3. **A headless render step** (Playwright in the image, or Crawl4AI's server) for sources with no structured data: Wix Events, ActiveNet, Eleyo, BoothCentral, EntryThingy. No evasion needed for most small-business pages.
4. **Own mailbox for newsletters** (the planned Cloudflare Email Worker address). Kill the Newsletter is the fallback when a box has no mailbox.
5. **Self-hosted RSSHub for Telegram, YouTube, Mastodon, Bluesky and Eventbrite city listings**, and RSS-Bridge's CSS/XPath bridges for feedless server-rendered pages. Moderate value; adds a service. Generic CSS-selector feeds can also be done in the box.
6. **Instagram and Facebook:** the open-source routes need cookies and put an account at risk; the paid APIs in [per-site-services.md](per-site-services.md) and Instagram oEmbed for single known posts are the lower-risk routes. The practical flow for a studio: find the studio's own website through search, then watch its website and ticketing page; use social pages as a fallback read, not a feed.
7. **Evasion tools (curl_cffi, Camoufox, Scrapling StealthyFetcher, FlareSolverr, Byparr):** hold until the boxholder decides. None changes the datacenter IP. For this use case the structured routes reach most small-business event sources without them.

Open questions for the boxholder: whether a box may hold a cookie for a throwaway Instagram or Facebook account; whether a second self-hosted service (changedetection.io or RSSHub) is acceptable in the box image; whether the box agent may write the detected platform and data URL into the look-here list itself.

## Unverified items

- RSSHub Facebook page route output without a cookie; RSS-Bridge InstagramBridge anonymous behavior; both were not run.
- urlwatch license text; Tribe REST query parameters beyond `per_page`, `page`, `start_date`, `end_date`; Squarespace per-event `?format=ical`; ActiveNet JSON path; whether `ETag`/`Last-Modified` are sent by these hosts.
- Hosted-service prices; CloakBrowser's detection claims; Nitter's current state beyond the archived flag.
