# Will real sites work in a box's embedded browser? (2026-10-29)

Question: a box runs a headful Chromium that the agent (Claude Code or Codex CLI) and the person share in one live session. The person logs into real accounts there and the agent then drives those sessions. How many real sites accept that browser, from a Hetzner datacenter IP and from a Mac at home?

This note is a dated snapshot. Companion: [security.md](security.md). The earlier fetch survey ([fetch-services.md](../web-search-fetch/fetch-services.md)) covers logged-out fetching and hosted unblockers; this note does not repeat it. That survey ran every probe from a residential IP, so it gives an upper bound for a Hetzner box.

Evidence tags used below:

- **[test]** an independent or reproducible published test, with method stated.
- **[doc]** a primary vendor or project document describing its own behavior.
- **[claim]** vendor marketing, a vendor-run benchmark, or a blog with a product to sell.
- **[unverified]** not found in any source in this pass.

No probe was run from a Hetzner IP for this note. Nothing here comes from first-hand testing.

## 1. What detectors look at

A detector combines four layers. A session can pass three and fail on the fourth.

| Layer | Signals | Notes |
|---|---|---|
| Network | IP ASN and reputation, TLS fingerprint (JA3/JA4), HTTP/2 settings, header order | Fixed by the host and the browser build, not by page JavaScript |
| Browser surface | `navigator.webdriver`, headless user-agent string, missing plugins, WebGL/canvas values, window and screen sizes, fonts | Patched by stealth tools; weaker signal than it was |
| Automation protocol | CDP side effects, notably `Runtime.enable` | Strongest differentiator in the one multi-tool test found ([below](#2-the-protocol-signal-runtimeenable)) |
| Behavior | Mouse and keyboard timing, navigation pattern, request rate | A person at the keyboard supplies this for free |

Cloudflare documents that its Bot Management stacks several detection engines and returns a bot score from 1 to 99, with low values meaning automated. It keeps a separate IP "threat score" ([Cloudflare docs](https://developers.cloudflare.com/bots/reference/bot-management-variables), [doc]). Cloudflare does not publish how much weight the ASN carries.

Vendor positioning, all [claim]: DataDome leans on behavior, Akamai on TLS/JA4 and network fingerprints, and HUMAN on a cross-site device graph ([third-party summary](https://signalcensus.pages.dev/articles/human-security-device-graph-third-architecture)). No independent study of detection rates for these three vendors was found. A 2026 vendor-run claim says traditional tools missed AI agents 81 of 100 times ([cside](https://cside.com/en/blog/best-tools-for-ai-agent-detection-to-prevent-website-fraud), [claim]).

## 2. The protocol signal: `Runtime.enable`

Playwright and Puppeteer call the CDP method `Runtime.enable` on every page. That call makes Chrome emit `Runtime.executionContextCreated` events, and page scripts can observe a side effect of it. Detection vendors use this as an automation flag ([rebrowser write-up mirror](https://backiee.wasmer.app/https_rebrowser_net/blog/how-to-fix-runtime-enable-cdp-detection-of-puppeteer-playwright-and-other-automation-libraries-61740), [doc] for the mechanism, from a patch vendor).

The one multi-tool test found ([Paterson, 2026](https://dev.to/ianlpaterson/anti-detect-browser-benchmark-2026-7-stealth-tools-31-cloudflare-targets-651-verdicts-4361), [test]) ran seven tools, three sweeps each, against 31 targets (panels, TLS endpoints, Cloudflare and other anti-bot production sites, content sites), from one residential IP, headed only:

| Tool | ok / gated / blocked |
|---|---|
| nodriver (direct CDP to system Chrome) | 28 / 3 / 0 |
| CloakBrowser (patched Chromium) | 26 / 3 / 2 |
| curl_cffi (no browser) | 26 / 3 / 2 |
| Patchright (system Chrome) | 25 / 3 / 3 |
| Camoufox | 25 / 3 / 3 |
| Vanilla Playwright | 24 / 2 / 5 |
| rebrowser-playwright | 24 / 2 / 5 |

The author's reading: automation-protocol fingerprinting drove most of the differences, and tools that drove Chrome without Playwright passed gates that Playwright-based tools failed. Limits of the test: one residential IP, one night, headed only, 31 targets, a single author. The spread between best and vanilla is four targets.

Implication for beebox: the Playwright-style libraries that Claude Code and Codex tool integrations use attach with CDP and call `Runtime.enable`. A person who is present and driving the same browser reduces the exposure, but any page that fingerprints the protocol while the agent acts can still flag the session.

## 3. Headless and headful in a container

- Chrome's "new headless" (`--headless=new`, Chrome 112) shares code with headful Chrome. The old headless implementation left the main binary at Chrome 132 and survives as `chrome-headless-shell` ([Chrome for Developers](https://developer.chrome.com/blog/chrome-headless-shell), [doc]). Playwright's default headless Chromium uses the shell build, which differs from regular Chrome in features and behavior.
- One cross-vendor figure: a rotating-proxy benchmark cited by Paterson scored CloakBrowser 83.3% headed and 50.0% headless ([techinz/browsers-benchmark via Paterson](https://dev.to/ianlpaterson/anti-detect-browser-benchmark-2026-7-stealth-tools-31-cloudflare-targets-651-verdicts-4361), second-hand, [test] by a third party, not re-checked).
- Headful on a server needs a display. Options are Xvfb or a virtual Wayland compositor. Both give a software-rendered GPU (SwiftShader), which anti-bot scripts can read through WebGL renderer strings ([unverified] for any specific vendor acting on it in 2026).
- For beebox the person must see and click in the browser, so headful with a screencast or VNC-style view is already the design. Headless detection results matter less.

Playwright's own Chrome-channel path (`channel="chrome"`, `headless=False`, persistent context) is the setup Patchright's README shows ([Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), [doc]).

## 4. IP reputation: Hetzner and datacenter ranges

What is published:

- Cloudflare's docs describe a separate IP threat score and layered bot scoring ([doc](https://developers.cloudflare.com/bots/reference/bot-management-variables)). They do not name datacenter ASNs as a class or Hetzner specifically.
- Vendor blogs say datacenter ranges (AWS, GCP, Azure, DigitalOcean, OVH) start with a low reputation and that Bot Fight Mode can block them at the edge ([Scrappey](https://scrappey.com/qa/web-automation/how-cloudflare-detects-bots), [claim]; [Decodo](https://decodo.com/blog/how-to-bypass-cloudflare), [claim]). Both sell proxies.
- A LowEndTalk thread shows a site owner blocking Hetzner's ASN (AS24940) through a Cloudflare WAF rule after a crawler on Hetzner IPs kept hitting the site ([thread](https://lowendtalk.com/discussion/comment/3470095/), anecdote). That shows a site operator can block the ASN on one domain. It does not show a Cloudflare-wide block.
- A commenter in the same thread says Cloudflare does not block all datacenter IPs.
- `youtube-transcript-api` documents that YouTube blocks most cloud-provider IPs ([repo](https://github.com/jdepoix/youtube-transcript-api), [doc], quoted in [fetch-services](../web-search-fetch/fetch-services.md)). That is the clearest published case of a large site treating cloud IPs worse, and it is about one site's transcript endpoint.
- No published test of Hetzner IPs against Cloudflare Turnstile, Akamai, DataDome or HUMAN was found. [unverified]

Practical reading: the penalty varies per site owner's configuration. Sites with strict bot rules (ticketing, retail, airline, some banks, social networks) are the likely failures. A site with default settings often serves a datacenter IP a managed challenge, which a present person can click through.

A shared box server adds a second risk. Every box on the server shares one egress IP. A flag raised by one box's browsing applies to all boxes. A box that logs into accounts from a datacenter IP also looks like an account takeover to some sites (login from a new ASN and country), and triggers email or SMS verification more often ([unverified] as a rate; plausible from how risk engines work).

## 5. Residential IPs, proxies, and the Mac path

### Running the browser at the person's home

The experimental Mac app runs the beebox image in a VM on the person's Mac. Browser traffic leaves through the person's ISP address:

- ASN and reputation: a consumer ISP range, the same one the person's own logins already use. Account risk engines see a familiar IP.
- Time zone, language and locale match the person's real values if the VM follows the host.
- TLS and HTTP/2 fingerprints still come from the Chromium build in the VM, not from a Mac Chrome. Paterson's test argues that a mismatch between a Linux host's network fingerprint and a residential IP still shows ([test](https://dev.to/ianlpaterson/anti-detect-browser-benchmark-2026-7-stealth-tools-31-cloudflare-targets-651-verdicts-4361): a Linux VPS behind a residential proxy was blocked more on Cloudflare targets than the unproxied Mac). A Chromium built for Linux in a VM presents a Linux user agent and platform. Match the user agent to the real platform or leave Chromium's defaults.
- The first-party benefit is the part that matters for logins: the person's accounts see one home IP and a real person, as they do from the person's normal browser.

### Residential proxies for the server path

Prices below are vendor and affiliate figures, directional only:

| Type | Price seen | Source |
|---|---|---|
| Pay-as-you-go residential | about $1 to $2 per GB at budget vendors; about $5 per GB at Bright Data; IPRoyal $7 per GB at 1 GB down to $1.75 per GB in bulk | [DataImpulse comparison](https://dataimpulse.com/blog/residential-proxy-pricing-comparison/), [AIMultiple](https://aimultiple.com/proxy-pricing) [claim] |
| City or ASN targeting | 10 to 30% extra | same [claim] |
| ISP (static residential) | from about $2.40 per proxy per month at IPRoyal | [AIMultiple](https://aimultiple.com/proxy-pricing) [claim] |

A browsing agent with a screencast uses meaningful bandwidth. Pages with video or large scripts reach tens of MB each. A per-GB plan can run out in days. An ISP proxy (static IP from a consumer ISP block, flat monthly price) fits a logged-in account better than a rotating pool, because the account sees one stable IP.

Supply and ethics:

- Rotating residential pools come from consumer devices whose owners may not know. In January 2026 Google disrupted IPIDEA, a network it called one of the largest, with at least 13 proxy brands and a device pool reduced by millions. Google tied it to botnets such as BADBOX2.0, Kimwolf and Aisuru ([Hacker News coverage](https://thehackernews.com/2026/01/google-disrupts-ipidea-one-of-worlds.html), [Proxyway](https://proxyway.com/news/google-disrupts-10-ipidea-related-chinese-proxy-providers)). A Cloud Security Alliance note links NetNut to the Popa botnet and an FBI domain seizure in July 2026 ([CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-residential-proxy-economy-systemic-risk-20/), secondary, not re-checked).
- Consequence for beebox: a rotating residential vendor sees the traffic, including logged-in sessions, and the exit device belongs to a stranger who did not agree to carry it. The boxholder's earlier line against residential-proxy fetchers ([README](../web-search-fetch/README.md#the-no-stealth-or-proxy-line)) covers this. An ISP proxy from a vendor that owns the address block avoids the stranger's-device issue but keeps the vendor-sees-everything issue, since TLS ends at the browser and the proxy sees only encrypted traffic plus hostnames.
- Cheaper and simpler: the person's own home connection. A home-run relay (the Mac app, or a small always-on device the person owns) as a SOCKS or WireGuard exit for the server path moves the egress to the person's ISP with no vendor in the loop. This is a design option, not tested here.

## 6. Stealth projects

| Project | What it is | Playwright/CDP compatibility | Status and licence |
|---|---|---|---|
| Patchright | Playwright fork for Chromium; avoids `Runtime.enable` by running scripts in isolated worlds; disables Console API | Drop-in Playwright API over CDP; console messages do not work | Apache-2.0; Chromium only; README gives no version/date ([repo](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), [doc]) |
| rebrowser-patches | Source patches for Puppeteer and Playwright with several `Runtime.enable` workaround modes | Keeps Playwright over CDP; Chrome only | In Paterson's test its block set equalled vanilla Playwright's ([test]) |
| nodriver | Python library, drives Chrome directly over CDP, no Playwright layer | Not Playwright; has its own API | AGPL-3.0, alpha ([overview](https://scrappey.com/qa/web-automation/what-is-nodriver), [claim]) |
| zendriver | Community fork of nodriver under the cdpdriver org | Not Playwright | AGPL-3.0, alpha |
| undetected-chromedriver | Patched ChromeDriver for Selenium | Selenium only | Snyk rates maintenance as inactive; author points to nodriver ([Snyk](https://snyk.io/advisor/python/undetected-chromedriver)) |
| Camoufox | Firefox fork with fingerprint spoofing | Playwright over Juggler, not CDP; a Firefox base does not suit Chrome-specific extensions or CDP tools | MPL-2.0 browser, MIT packages. README says "under development" and "may not be suitable for stable production use" ([repo](https://github.com/daijro/camoufox), [doc]) |
| Chrome's own headless | `--headless=new` | Normal CDP | Part of Chrome |

Camoufox maintainer status: the original developer posted that they stepped down as primary maintainer after time away; the repository points to active work at `CloverLabsAI/camoufox` and `VulpineOS/VulpineOS`, and a `cloverlabs-camoufox` wrapper released 0.6.0 on 2026-05-13 ([search summary of the repo notice and PyPI](https://www.ruby-toolbox.com/projects/camoufox), second-hand). A reported year-long gap and an unverified claim about the maintainer's health appear in forum posts only. Treat the project as a fork-in-progress with no single steward. In Paterson's test it passed Google Search where several Chromium tools were blocked, and it was blocked on dev.to ([test]).

Fit with beebox:

- The agent and the person share one Chromium. The agent attaches over CDP. Patchright-style patches change how the client talks to that browser (isolated worlds instead of `Runtime.enable`), so they apply only if beebox's own agent client uses them. A Claude Code or Codex integration that uses stock Playwright or DevTools MCP will not.
- A different browser engine (Camoufox) means a second code path and no CDP for the agent tools in use.
- Stealth patches are a maintenance and licence burden (AGPL for nodriver) with a gain of a few targets in the one test. A present person plus a residential egress changes more than the client library does.
- Chrome 136 changed `--remote-debugging-port` and `--remote-debugging-pipe` so they are ignored for the default user data directory; a custom `--user-data-dir` is required. Google gives cookie theft as the reason and recommends Chrome for Testing for automation ([Chrome for Developers](https://developer.chrome.com/blog/remote-debugging-port), [doc]). Chromium itself is not named in the post. beebox uses a dedicated profile directory per box, which satisfies the rule.

## 7. Google sign-in and banks

- Google shows "This browser or app may not be secure" when it detects an automated or embedded browser. Reports tie it to browsers launched by Playwright, Puppeteer, Selenium and to debugger-launched Chrome ([VS Code js-debug report](https://lightrun.com/answers/microsoft-vscode-js-debug-after-switching-to-the-vscode-js-debug-preview-google-warns-that-this-browser-or-app-may-not-be-se), [Stably docs](https://docs.stably.ai/stably2/auth/auth-with-google)). No Google document describing the exact trigger was found. [unverified]
- Workaround reported by several community sources: launch Chrome normally with a dedicated profile, sign in by hand, then attach over CDP afterward ([skill guide](https://sunwood-ai-labs.github.io/logged-in-google-chrome-skill/guide/troubleshooting), [claim]). In beebox terms: the person logs in first in the shared browser, before the agent attaches or before the first agent action. If the agent's CDP client connects before the login page loads, Google may see the automation flags.
- Banks and payment sites often add device binding and step-up checks (SMS, push). A datacenter IP raises step-up frequency. A bank that binds a session to IP and device can invalidate it when the egress changes between a person's Mac and a box server. [unverified]; reasoned from how risk engines work.
- Cookie reuse on another IP is risky. A session cookie created from the person's phone IP and replayed from a Hetzner IP can trigger a logout or a challenge. The shared-browser design avoids it when the person logs in inside the box browser itself, so the cookie belongs to the box's IP from the start.

## 8. Captchas

- Human handoff is the answer: the screencast shows the challenge and the person clicks. This matches beebox's shared-session design and works on any IP.
- Solver services exist: 2Captcha (human workers plus ML), CapSolver (ML), Anti-Captcha. Published comparisons conflict on accuracy for Turnstile and are affiliate-adjacent ([AIMultiple](https://research.aimultiple.com/captcha-solving-services), [Browserless](https://www.browserless.io/blog/best-captcha-solver), [claim]). Named here for completeness. Using them circumvents a site's control; the fetch survey's legal section applies ([fetch-services](../web-search-fetch/fetch-services.md#tos-and-legal-posture)).
- A Turnstile challenge that appears because of IP reputation often clears once a person completes it, and the clearance cookie lasts for a period the site sets. A persistent profile keeps it ([unverified] duration; forum reports only).

## 9. Agent identification: signed agents and Web Bot Auth

- Cloudflare's "signed agents" class covers agents "generally directed by an end user" whose platform signs requests with Web Bot Auth, validated by Cloudflare. Site owners can allow or block them as a group. Launch partners included ChatGPT agent, Goose, Browserbase and Anchor Browser ([Cloudflare blog](https://blog.cloudflare.com/signed-agents), [doc]).
- Web Bot Auth is an IETF draft (`draft-ietf-webbotauth-httpsig-protocol-00`, September 2026; authors from Cloudflare and Google). Bots sign requests with HTTP Message Signatures, and a `Signature-Agent` header points to a key directory. The draft allows replay and suggests nonces ([IETF datatracker](https://datatracker.ietf.org/doc/html/draft-ietf-webbotauth-httpsig-protocol), [doc]). Whether OpenAI's agent signs this way was not confirmed in this pass; Cloudflare names ChatGPT agent as a launch partner.
- Cloudflare Browser Run (see [fetch-services](../web-search-fetch/fetch-services.md)) sends signature headers that cannot be removed and always receives bot score 1 ([doc]).
- Relevance for beebox: a signed identity belongs to a platform that signs for many users. A self-hosted box has no such identity and would need to register a key with Cloudflare's verified-bot or signed-agent program. [unverified] that Cloudflare accepts individual self-hosted deployments. With a person present and the browser a normal Chromium, signing does not apply and the session is judged by the usual signals. Signing would help a headless box fetching alone, which is out of scope here.
- Cloudflare accused Perplexity in August 2025 of fetching with a Chrome user agent and undeclared IPs after being blocked, and de-listed it as a verified bot; Perplexity disputed the account ([Neowin](https://www.neowin.net/news/perplexitys-stealth-crawlers-exposed-in-new-cloudflare-report/), noted in [fetch-services](../web-search-fetch/fetch-services.md)).

## 10. Terms-of-service posture

- Sites' terms commonly forbid automated access, and some forbid sharing credentials or sessions with third-party tools. beebox's case is a person using their own account through their own tool, with the person present at login.
- Amazon sued Perplexity in November 2025 over Comet shopping in logged-in accounts. A district court granted a preliminary injunction on 2026-03-06, finding strong evidence that Comet accessed password-protected accounts with user permission but without Amazon's authorization. The Ninth Circuit vacated the injunction in early August 2026, reasoning that the Comet user, not Perplexity, accessed Amazon's computers because Comet acts on user direction. The panel limited its holding to the record and sent the case back ([Bloomberg Law](https://news.bloomberglaw.com/ip-law/amazon-wins-court-order-blocking-perplexitys-ai-shopping-bots), [Northeast Times](https://northeasttimes.com/2026/08/06/appeals-court-sides-with-perplexity-ai-in-amazon-shopping-dispute/), press coverage; the opinion was not read).
- Reading: the one appellate signal so far treats a user-directed agent as the user. It decides a preliminary injunction on a computer-access claim, not a contract claim under a site's terms. Accounts can still be suspended under terms of service without any court being involved. The risk lands on the person's account, as noted in the fetch survey.
- Anthropic's guidance for its Chrome extension recommends starting with trusted sites and avoiding financial, legal and medical content ([claude.com](https://claude.com/resources/articles/claude-for-chrome)).
- Not legal advice. A lawyer is needed for any real exposure.

## Summary: Hetzner IP, headful Chromium, person present

Verification key as above. "Probably" means inferred, not tested from Hetzner.

**Probably works**

- Sites with default or no bot protection: blogs, docs, most SaaS dashboards, email webmail with the person logging in first. [unverified from Hetzner; consistent with fetch survey results from a residential IP]
- Cloudflare managed challenge or Turnstile on sites where a person can click through, with the clearance kept in a persistent profile. [claim, forum reports]
- Logins where the person types credentials in the shared browser before the agent attaches. [claim, community guides; no Google statement]
- Sites that treat a headful Chromium with a human-like first request well, since new headless and headful share code. [doc for shared code; detection outcome unverified]

**Probably fails or degrades**

- Sites that block or heavily challenge datacenter ASNs: ticketing, retail checkout, airlines, some banks, social networks. [claim for the class; a site operator blocking AS24940 is anecdotal]
- YouTube-style endpoints that block cloud IPs outright. [doc: youtube-transcript-api]
- Pages that fingerprint CDP while the agent drives with stock Playwright. [test: seven-tool benchmark, residential IP, 31 targets, one author]
- Google sign-in if the browser is started with automation flags or if CDP attaches before login. [community reports]
- Any account whose risk engine reacts to a new ASN or country: extra verification, locked sessions. [unverified]
- Several boxes sharing one egress IP: one box's behavior counts against all. [reasoned]

**What the residential path (Mac app) changes**

- ASN and geolocation match the person's normal logins, so account risk engines see a known IP. [reasoned; matches the proxy-vendor and Paterson observations about IP layer]
- Datacenter-only blocks drop out. Challenges that depend on IP reputation become rarer. [claim]
- It does not change the Chromium TLS fingerprint, CDP signals, or Linux platform strings from the VM. [test: Paterson's proxied-VPS result]
- It removes vendor exposure from the egress path. Residential proxy vendors see logged-in traffic and carry supply-chain problems (IPIDEA, NetNut). [doc/press]
- The server path can borrow the same benefit by relaying through the person's home connection. [design option, untested]

## Dispositions

| Item | Disposition | Trace |
|---|---|---|
| Shared headful Chromium, person logs in first, agent attaches after | adopt | Matches the design and the only reported workaround for Google sign-in |
| Dedicated per-box profile directory with a custom `--user-data-dir` | adopt | Required by Chrome 136 for CDP; also keeps cookies per box |
| Patchright-style client patches | later | Gain of one target in one test; revisit if a specific site the boxholder uses fails on `Runtime.enable` |
| nodriver / zendriver / undetected-chromedriver | reject | Not Playwright; AGPL or inactive |
| Camoufox | later | Firefox, no CDP, no single maintainer |
| Rotating residential proxy vendors | reject | Supply and ethics record above; a vendor sees logged-in traffic |
| ISP proxy or a home relay for the server path | investigate | Probe a few real sites from Hetzner with and without it before building |
| Captcha solver services | reject | Human handoff is the design; solvers circumvent the site's control |
| Web Bot Auth signing | later | Applies to headless fetching, not to a person-present session |
| Probe plan | do next | Run 10 to 15 real sites (the boxholder's own bank, email, shops) from a Hetzner IP and from the Mac, record challenge type per site, and add the numbers to this corpus |
