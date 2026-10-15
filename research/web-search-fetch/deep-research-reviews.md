# Deep research services: third-party reviews and evaluations

Date: 2026-10-15. Desk research only. No signups, no spend, no API calls. Companion to [search-services.md](search-services.md) ("Deep research loops" section).

Question: should an agent dispatch a whole research project to a hosted "deep research" service? The boxholder leans toward Perplexity Sonar Deep Research (on OpenRouter as `perplexity/sonar-deep-research`). This note collects evidence from people other than the vendors.

How to read the evidence:

- Most published benchmark numbers come from vendors (Perplexity DRACO, Parallel, You.com, Valyu, CellCog). They are marked "vendor".
- Independent sources are few: the DeepResearch Bench authors (USTC), DeepTRACE (academic), the Tow Center, a Penn preprint on URL hallucination, FutureSearch, and forum threads.
- Many benchmark rows test the consumer product (for example "Perplexity Research", "OpenAI Deep Research"), not the API. Where the API runs the same engine, that is stated. Where unknown, it is marked unverified.
- Web search snippets and page summaries produced several of the figures below. Numbers that came from a single secondary page are marked unverified.

## Summary table

| Service | API access and price per task | Independent eval results | Main praise | Main complaints |
|---|---|---|---|---|
| Perplexity Sonar Deep Research | Perplexity API and OpenRouter. $2/M input, $8/M output, $2/M citation tokens, $3/M reasoning tokens, $5 per 1k searches; no per-request fee. Perplexity calculator default of 18 searches and about 97k tokens gives about $0.36 per call. Third-party range $0.41 to $1.32 (unverified). | DeepResearch Bench (USTC, Apr 2025 runs): RACE 42.25, rank 3 of 4 agents; citation accuracy 90.24%, highest of the four; 31 effective citations per task. DeepTRACE (academic, Aug 2025): citation accuracy 58.0%, 97.5% of statements unsupported by listed sources, 7.7 sources per answer. Vendor DRACO (Feb 2026): 70.5, first. | Fast (about 4 to 8 minutes in DRACO). High per-citation accuracy on DeepResearch Bench. Low cost. | Claims not found in the cited source. Few sources. Async job and timeout bugs on the Perplexity API, Oct 2025 to May 2026. Weak first-hand reviews of source quality. Litigation and crawler dispute. |
| Gemini Deep Research (API agent, preview) | Gemini Interactions API, background only, paid tiers. Agents `deep-research-preview-04-2026` and `deep-research-max-preview-04-2026`. Google estimate $1 to $3 standard, $3 to $7 Max; search fees are about $1.12 of the standard figure. | DeepResearch Bench: RACE 48.88, best of the four agents; 111 effective citations (165 in the later CSV); citation accuracy 78 to 81%. DeepTRACE: citation accuracy 50.3%, 53.6% unsupported, 33 sources. Vendor DRACO: 59.0, second. | Broad source coverage. Editable research plan. Highest RACE among the big three in 2025 tests. | Cannot reach paywalled sources. Surface-level. Most broken or made-up URLs in one vendor-written roundup (unverified). Stuck `in_progress` and HTTP 500 threads on the Google forum into Sep 2026. Preview status. |
| OpenAI deep research | `o3-deep-research` and `o4-mini-deep-research` shut down 2026-07-23. Replacement per OpenAI docs: `gpt-5.6-sol` via Responses API with web search, background mode, `max_tool_calls`. No price on the docs page. | DeepResearch Bench: RACE 46.98, 40.8 effective citations, 78% citation accuracy. DeepTRACE (GPT-5 DR): 79.1% citation accuracy, 12.5% unsupported, 87.5% source necessity; best of six agents. Vendor DRACO: o3 52.1, o4-mini 41.9. | Best DeepTRACE grounding. Strong first-hand reports from users in 2025. | Slow (about 30 minutes average in DRACO). Background mode keeps data about 10 minutes and conflicts with ZDR. No independent test of the replacement path found. |
| Parallel Task API | Parallel API. Processors priced per 1,000 requests: Pro $100, Ultra $300, Ultra2x $600, Ultra4x $1,200, Ultra8x $2,400. | No independent eval found. Vendor: BrowseComp 34% (Pro) to 58% (Ultra8x) on a 100-question subset, vs 6% for Perplexity and 14% for Exa. A broad third-party agent test is said to favor Parallel (unverified; one aggregator snippet). | Cheapest per accuracy point in its own benchmark. Structured output. | Evidence is vendor-run. |
| Exa Research | Exa. Legacy `/research/v1` deprecated 2026-05-01 in favor of `/search` with `type: "deep-reasoning"`, per competitor pages (unverified). | None independent. Vendor (Parallel): 27% on DeepSearchQA. | Fast retrieval. | No independent review of the deep modes. Product churn. |
| You.com Research API | You.com. Price not collected. | DeepTRACE (YouChat DR): 72.3% citation accuracy, 74.6% unsupported, 57 sources. Vendor: 83.67% DeepSearchQA. Valyu (competitor) DRACO 52.9% (unverified). | Many sources. | Many unsupported statements (DeepTRACE). Product status unclear. |
| Tavily Research | Tavily. Price not collected. | DeepResearch Bench CSV: overall 52.44, highest row in the file, no citation columns (entry appears submitted by the vendor; unverified). Valyu (competitor) DRACO: 38.8%. | Strong RACE score. | Two benchmarks disagree. No hands-on reviews found. |
| Kimi Researcher, Grok DeepSearch, Claude research | Consumer products. API equivalence unverified. | DeepResearch Bench: Kimi 44.64, Claude research 45.00, Grok 38.22 to 40.24 (Grok effective citations 8). | | Grok output is thin in hands-on tests (2025). |
| Open source (LangChain open_deep_research, GPT Researcher) | Self-run; cost is model plus search API. | DeepResearch Bench CSV: open_deep_research 43.44 (49.33 with GPT-5), citation accuracy 35 to 49%. No GPT Researcher data found. | Configurable. | Low citation accuracy on the benchmark. The repo shows as archived on 2026-08-21 in one source and active in another (unresolved). |

## Benchmarks

### DeepResearch Bench (USTC and Metastone, arXiv 2506.11763)

Source: https://arxiv.org/html/2506.11763v1. Data collected April to May 2025. RACE is a rubric score judged against reference reports. FACT measures citation accuracy (C. Acc.) and effective citations per task (E. Cit.).

| Agent | RACE | C. Acc. | E. Cit. |
|---|---|---|---|
| Gemini-2.5-Pro Deep Research | 48.88 | 81.44% | 111.21 |
| OpenAI Deep Research | 46.98 | 77.96% | 40.79 |
| Perplexity Deep Research | 42.25 | 90.24% | 31.26 |
| Grok Deeper Search | 40.24 | 83.59% | 8.15 |
| Claude-3.7-Sonnet with search | 40.67 | 93.68% | 32.48 |

Reading: Perplexity has the most accurate individual citations and about a quarter of Gemini's citation volume. The paper states Perplexity is better at recalling relevant content from retrieved text. "Citation accuracy" here measures whether a cited claim matches the cited page, on the citations the system chose to include. Systems that cite less can score higher on this metric.

The live leaderboard CSV (https://huggingface.co/spaces/muset-ai/DeepResearch-Bench-Leaderboard/blob/main/data/leaderboard.csv, undated, fetched 2026-10-15) shows: Tavily research 52.44, Gemini 2.5 Pro deepresearch 49.71, open_deep_research with GPT-5 49.33, OpenAI 46.45, Claude research 45.00, Kimi 44.64, Perplexity 40.46, Grok 38.22. A CellCog page (vendor, which ranks itself first) copies a GPT-5.5-judged snapshot dated 2026-08-07: Gemini 49.98, OpenAI 47.84, Perplexity 43.05, Grok 41.22 (https://cellcog.ai/benchmarks). The Perplexity row is the consumer "Perplexity Research" product, not necessarily `sonar-deep-research` (unverified). The top of the 2026 leaderboard is filled by small vendors and independents, and none of the big-three rows reflect 2026 product versions.

### DeepTRACE (academic, arXiv 2509.04499, evaluation 2025-08-27)

Source: https://arxiv.org/html/2509.04499. 303 questions, 168 of them debate questions. Claim-level checks of statements against the sources the system lists.

| Deep research agent | Sources | One-sided (debate) | Unsupported statements | Source necessity | Citation accuracy |
|---|---|---|---|---|---|
| GPT-5 (DR) | 18.3 | 54.7% | 12.5% | 87.5% | 79.1% |
| YouChat (DR) | 57.2 | 63.1% | 74.6% | 63.2% | 72.3% |
| Copilot (Think Deeper) | 3.6 | 94.8% | 90.2% | 31.2% | 62.1% |
| Perplexity (DR) | 7.7 | 63.1% | 97.5% | 5.5% | 58.0% |
| Gemini (DR) | 33.2 | 80.1% | 53.6% | 33.1% | 50.3% |

The paper text gives Gemini 40.3% where the table gives 50.3% (flagged by the page reader; check the PDF). Perplexity's 97.5% unsupported figure means almost every statement lacks support in its listed sources, while individual citations that do exist are mostly accurate (58%). The two benchmarks conflict in emphasis. Possible reasons: Perplexity DR cites few sources (7.7) and writes long synthesis not tied to them; DeepResearch Bench scores only the citations present. This is an inference, not a finding in either paper.

### DRACO (Perplexity authors plus one Harvard author, arXiv 2602.11685, Feb 2026)

Source: https://arxiv.org/html/2602.11685v1. Vendor-run. 100 tasks drawn from Perplexity's own de-identified query logs. Judge Gemini-3-Pro.

| System | Normalized score | Avg latency | Avg output tokens |
|---|---|---|---|
| Perplexity Deep Research (Opus 4.6) | 70.5 | 245 s | 8.8k |
| Perplexity Deep Research (Opus 4.5) | 67.2 | 460 s | 14.3k |
| Gemini Deep Research | 59.0 | 592 s | 22.1k |
| OpenAI Deep Research (o3) | 52.1 | 1,808 s | 24.9k |
| OpenAI Deep Research (o4-mini) | 41.9 | 1,424 s | 12.6k |

Caveats from the paper: absolute scores shift with the judge (Perplexity 70.5 under Gemini-3-Pro, 50.4 under GPT-5.2, 75.5 under Sonnet-4.5); rubrics were revised when a model scored above 90%; the Opus rows are standard models with search, not research modes. The Perplexity product here runs Claude Opus 4.6 underneath. That is the consumer deep research. Whether `sonar-deep-research` on the API matches it is unverified. The API model is priced as a Sonar model, and Perplexity also exposes deep-research presets in its Agent API (one community post names Gemini, Opus 4.6 and GPT 5.4 as options; https://community.perplexity.ai/t/gemini-output-in-agent-api-response/4374).

Valyu (competitor) reports DRACO results for others: Tavily Research pro 38.8%, You.com 52.9%, Valyu 72.7% (secondary report; unverified).

### ResearchRubrics (Scale AI, arXiv 2511.07685, ICLR 2026)

Source: https://alphaxiv.org/abs/2511.07685. 2,500+ expert rubrics, 2,800+ hours of labor. Authors report that Gemini Deep Research and OpenAI Deep Research score under 68% rubric compliance. The search results did not show a Perplexity row; check the paper (unverified for Perplexity).

### Parallel's benchmarks (vendor)

Source: https://parallel.ai/blog/deep-research-benchmarks. Run Aug 2025 on a 100-question BrowseComp subset and 50 DeepResearch Bench tasks. Parallel Ultra 45% vs Perplexity 6% and Exa 14% on BrowseComp; RACE win rate vs human reference 82% for Ultra vs 6% for Perplexity. Treat the gaps as vendor claims; the Perplexity API model tested is not named on the page.

### FutureSearch (independent)

Sources: https://drb.futuresearch.ai, https://evals.futuresearch.ai/. Their Deep Research Bench (updated 2026-06-10, 169 tasks) tests base models inside a research loop, not hosted services. Scores: Opus 4.6 (high) 0.553 at $0.53 per task; GPT-5.5 (high) 0.540 at $0.36; Gemini 3 Flash (low) 0.498 at $0.10; Gemini 3.1 Pro (high) 0.478 at $0.23. Perplexity, Parallel, Exa and Tavily are absent. The useful signal: a frontier model with a good loop costs $0.10 to $0.55 per task, in the same range as hosted services.

### Artificial Analysis Search Index (launched 2026-08-18)

Reported by a crypto news site only (https://cryptobriefing.com/perplexity-tops-artificial-analysis-search-index/; unverified against Artificial Analysis). It ranks search APIs with a fixed model: Perplexity Search API (medium) 80, Parallel Search 75, Exa Search 74. This tests search endpoints, not Sonar Deep Research. No Artificial Analysis entry for Sonar Deep Research was found.

### Search-depth finding (arXiv 2605.06635, May 2026)

Source: https://arxiv.org/html/2605.06635v1. Tests 14 models, not hosted services. Link validity stayed above 94% while factual accuracy of cited claims was 39 to 77%. Raising tool calls from 2 to 150 cut fact-check accuracy by about 42% on average (GPT-5.4 from 79% to 17%). Relevance to a deep research service: more searching does not give more accurate citations. A service that runs 80 to 150 searches (Gemini: about 80 standard, about 160 Max) may carry this risk. The paper did not test those services.

## Per-service notes

### Perplexity Sonar Deep Research

Access and cost:

- Rates: https://docs.perplexity.ai/getting-started/pricing. OpenRouter lists the same rates and a separate $3/M reasoning token charge (secondary pages). OpenRouter activity data shows about 130M reasoning tokens against 3.2M completion tokens in one day, so reasoning dominates volume (https://openrouter.ai/perplexity/sonar-deep-research/activity via search snippet; unverified).
- Perplexity's own calculator example: 18 searches, 74k reasoning tokens, 20k citation tokens, about $0.36 per call. The reasoning term is the largest.
- OpenRouter forwards to a single provider, so there is no failover (OpenRouter model page, per search snippet). OpenRouter docs say failed (502) generations are not billed (https://openrouter.ai/perplexity/sonar-deep-research docs page).
- Latency: one aggregator gives a median of 106 s over 22 requests in Oct 2025 and an average of about 225 s from another review site (https://langdb.ai/app/models/analytics/openrouter/sonar-deep-research; unverified). DRACO measured 245 to 460 s for the consumer product.

API reliability (first-hand, Perplexity community forum):

- Oct 2025: requests to `sonar-deep-research` closed after about 60 s with a socket or "Headers Timeout Error"; credit was deducted and no output returned. Lowering `max_tokens`, streaming and keep-alive headers did not help. A poster reported a fix on Oct 25; no staff reply in the thread (https://community.perplexity.ai/t/perplexity-sonar-deep-research-model-timeout-issue-seeking-solution/2094).
- Jan to Feb 2026: async jobs stayed `IN_PROGRESS` for 20 to 40 minutes after `completed_at` was set; the list endpoint showed COMPLETED while the get endpoint showed IN_PROGRESS. Users reported no Perplexity response after two weeks (https://community.perplexity.ai/t/sonar-deep-research-taking-longer-than-expected/3599).
- Further threads on stuck jobs, lost results and requests stopping mid-run run through 2026-05-18 (list shown on https://community.perplexity.ai/t/the-perplexity-sonar-deep-research-model-is-repeatedly-staying-in-in-progress-and-timing-out/3663).
- No OpenRouter-specific streaming complaint was found in search. Whether OpenRouter adds its own timeout is not documented in what was read. A direct test is the only way to settle it.

Quality, first-hand (all early 2025, product likely changed since):

- Andrea Freund, 2025-03-11: all 13 cited links were real pages. Statistics in the answers were absent from the cited pages (10 of 10 hard numbers in the first test). Sources were marketing pages and small blogs; no journals in the first test (https://andreafreund.substack.com/p/experimenting-with-perplexitys-deep).
- Craig Van Slyke, 2025-02-18: titled "disappoints, for now". Commenters report hallucinations and Reddit or personal-blog sources when vetted sources were wanted (https://aigoestocollege.substack.com/p/perplexitys-deep-research-disappoints/comments). Only the first paragraph and comments were readable.
- These are small samples. They agree with the DeepTRACE finding on unsupported statements.

### Gemini Deep Research

- Cost: Google's estimate is about 250k input tokens, 60k output tokens and 80 searches for standard; 900k, 80k and 160 for Max. Search is the largest line at $14 per 1k queries. The estimate assumes 50 to 70% cache hits. There is no per-task query cap in the preview. Source: https://tokencost.app/blog/gemini-deep-research-agent-cost (as of 2026-04-24, quotes Google's figures; no independent measurement existed yet).
- Latency: 5 to 15 minutes standard per the same sources; 592 s average in DRACO (vendor-run).
- Forum (Dec 2025): background runs can be concurrent; results kept 1 day free and 55 days paid; Paid Tier 1 users got 404 until they used the Interactions API; streaming delivered thinking summaries in batches; usage metadata was missing until a fix on 2025-12-31 (https://discuss.ai.google.dev/t/deep-research-agent-api-questions-for-rate-limitsand-costs/111904). The thread's related-topics list shows later threads on stuck `in_progress` jobs and HTTP 500 errors through Sep 2026 (contents not read).
- Source quality: an April 2025 hands-on (Cottrill Research) found Gemini reaches only open-access pages, misses transcripts, video and minutes, shows access dates but not publication dates, and had a few citations that did not match claims (https://cottrillresearch.com/assessing-gemini-deep-research-with-2-5-pro-focus-on-source-transparency-and-relevancy/). An arXiv evaluation of Google's and OpenAI's tools found both include Facebook and Reddit links and that Gemini summarizes heavily and omits many sources it visited (https://arxiv.org/pdf/2510.01283; via search snippet).
- Note on identifiers: sources disagree on agent IDs and launch dates (April 21 vs July 7, 2026). The IDs in search-services.md come from Google's docs and are the ones to trust.

### OpenAI deep research

- Docs page (fetched): `o3-deep-research` and `o4-mini-deep-research` shut down 2026-07-23; `gpt-5.6-sol` is the replacement; use the Responses API with web search, file search or remote MCP; background mode for tens-of-minute runs with a webhook; `max_tool_calls` limits cost and latency; background mode keeps data about 10 minutes and conflicts with ZDR. Source: https://developers.openai.com/api/docs/guides/deep-research. The page says changing the model ID is not a full migration.
- No independent evaluation of the post-shutdown path was found. All benchmark rows above test the older o3 and o4-mini products. For this reason the 2025 scores do not predict the 2026 API.
- Best DeepTRACE grounding of any agent (12.5% unsupported). Slowest in DRACO (about 30 minutes).

### Parallel Task API

- Only vendor-run numbers found. The cost claim that matters: Parallel's CPM figures run $100 (Pro) to $2,400 (Ultra8x) per 1,000 tasks, so $0.10 to $2.40 per task.
- A third-party roundup (Keenable, via snippet) says Parallel leads the broad controlled agent test while Firecrawl, Brave and Tavily each win other tests (https://select.keenable.ai/r/ai-web-search-api-benchmarks/OaFKKMHeqBfx3jQKy9nI-w; unverified, methodology not read).
- Eden AI warns that a vendor winning its own benchmark is marketing evidence (https://www.edenai.co/post/best-deep-research-apis).

### Exa, You.com, Tavily

- Exa: deprecation of the Research API is stated by competitors; confirm in Exa docs before building on it. No independent evaluation found.
- You.com: DeepTRACE shows many sources and many unsupported statements. Its DeepSearchQA claim is self-published (https://about.you.com/resources/research-api-by-you-com).
- Tavily: the DeepResearch Bench CSV and Valyu's DRACO run disagree by a wide margin (52.44 on a different scale vs 38.8%). The scores are not comparable and neither is independent. No hands-on review found.

### Kimi, Grok, Manus, Claude research

- Grok DeepSearch: a hands-on in 2025 found it polished but thin; an AIMultiple test counted over 100 pages indexed in about 2 minutes, with reference count as a rough proxy (https://research.aimultiple.com/ai-deep-research). On DeepResearch Bench Grok cites about 8 sources per task.
- Kimi Researcher and Claude research appear on the DeepResearch Bench with no citation columns.
- Manus: no independent test found.

### Open-source loops

- LangChain `open_deep_research`: its changelog claims rank 6 on the Deep Research Bench (FutureSearch version, 0.4344, 2025-08-02); that leaderboard space may be offline (https://github.com/langchain-ai/open_deep_research). On the USTC bench it scores 43.44, or 49.33 with GPT-5, with citation accuracy 35 to 49%, the lowest in the file.
- GPT Researcher: no independent benchmark found.
- FutureSearch's results suggest the model matters more than the harness. A box that already has an agent loop can reproduce much of this at $0.10 to $0.55 per task (see FutureSearch section).

## Citation accuracy evidence

| Study | Date | What it measured | Result |
|---|---|---|---|
| Tow Center for Digital Journalism, Columbia (CJR) | tests Feb 2025, published Mar 2025 | 8 AI search tools, 1,600 queries (200 articles from 20 publishers), identify headline, publisher, date, URL | Over 60% of answers wrong overall. Perplexity 37% wrong (lowest of the eight); Grok 3 94%. Perplexity Pro answered more correctly than free Perplexity but with a higher error rate because it rarely declined. Perplexity Pro identified nearly a third of excerpts from publishers that had blocked its crawlers. More than half of Gemini and Grok 3 citations were fabricated or broken URLs. Tools often cited syndicated copies (Yahoo, AOL) rather than originals. Only OpenAI and Microsoft responded. Source: https://www.cjr.org/tow_center/we-compared-eight-ai-search-engines-theyre-all-bad-at-citing-news.php |
| DeepTRACE | 2025-08-27 | Claim-level support in deep research agents | See the table above. Perplexity DR 97.5% of statements unsupported by its listed sources; GPT-5 DR 12.5%. |
| Rao, Wong, Callison-Burch (Penn), arXiv 2604.03173 | 2026-04-03 | Whether citation URLs resolve or appear in the Wayback Machine | 3 to 13% of citation URLs hallucinated, 5 to 18% non-resolving, across 10 models and agents on DRBench. Deep research agents give more citations per query and hallucinate URLs at higher rates than search-augmented LLMs. A URL-check tool cut non-resolving URLs by 6 to 79 times. Systems are not named in the abstract. Source: https://arxiv.org/abs/2604.03173 |
| arXiv 2605.06635 | 2026-05-07 | Fact check of cited claims as search calls increase | Link validity above 94% but fact-check accuracy 39 to 77%; accuracy fell about 42% with 2 to 150 tool calls. Source: https://arxiv.org/html/2605.06635v1 |
| DeepResearch Bench FACT | 2025 | Citation accuracy on cited claims | Perplexity 90.2%, OpenAI 78.0%, Gemini 81.4%. See above. |

What this means:

- Fabricated URLs are the smaller problem for the deep research services: 3 to 13% in the Penn study.
- Real URLs attached to claims the page does not support is the larger problem. Freund's 2025 test and DeepTRACE agree on this for Perplexity.
- Two benchmarks rank Perplexity at opposite ends of citation quality (best on DeepResearch Bench FACT, near worst on DeepTRACE support). Each measures a different thing, and neither measures `sonar-deep-research` on the API specifically.
- Checking cited URLs and sampling claim support after the fact is cheap. The Penn tool `urlhealth` is open source.

Source quality evidence is thin:

- Semrush analysis of 230,000 prompts (Oct 2025) found Reddit, LinkedIn, Wikipedia, Medium and YouTube among the most-cited domains, about a third of citations together (reported in https://infotoday.com/cilmag/jul26/Weiss--AI-Deep-Research-and-Why-the-Old-School-Has-Closed.shtml; Semrush study not read directly).
- Gemini and OpenAI tools include Reddit and Facebook links (arXiv 2510.01283, small sample).
- No per-service study of Reddit or SEO spam share across Perplexity, Gemini and OpenAI deep research was found.
- A recurring argument, repeated in the Cottrill piece, is that high-authority sites block AI crawlers, so what gets cited skews toward lower-authority pages. No measurement found.
- Recency: no independent test of freshness for the deep research services was found.
- Depth vs breadth: DeepResearch Bench and DRACO give Gemini the most sources and Perplexity the fewest per task. DRACO scores Perplexity highest on Breadth & Depth (vendor-run).
- Length: DRACO shows Gemini and OpenAI producing 22k to 25k output tokens per task against Perplexity's 9k to 14k. No complaint about Perplexity verbosity was found; the first-hand complaints concern unsupported content.

## Perplexity legal and ethical posture (as of 2026-10-15)

Status comes mostly from a case tracker (https://ailawsuittracker.com/companies/perplexity/) and news summaries. Dockets were not read. Treat dates as unverified unless a primary source is named.

| Case | Filed | Court | Status |
|---|---|---|---|
| Dow Jones and NY Post v. Perplexity | Oct 2024 | S.D.N.Y. | 2025-08-21: Judge Failla denied Perplexity's motions to dismiss for jurisdiction and venue and to transfer to California, and denied the failure-to-state-a-claim motion in full (Loeb summary: https://www.loeb.com/en/insights/publications/2025/08/dow-jones-and-company-inc-v-perplexity-ai-inc; Bloomberg Law). Fact discovery was set to close 2026-06-04. No later ruling found. |
| Encyclopaedia Britannica and Merriam-Webster | Sep 2025 | S.D.N.Y. | Perplexity moved 2025-11-03 to dismiss the output-based direct infringement claims. No ruling found. Case management plan 2025-12-17 with fact discovery to 2026-10-16. Same court declined to transfer the case. |
| Reddit v. SerpApi, Perplexity and others | Oct 2025 | S.D.N.Y. (25-cv-8736) | 2026-07-31: judge largely denied the motions to dismiss; court held Reddit plausibly alleged a conspiracy to circumvent Google's access controls (DMCA 1201), with Perplexity paying a scraper. Some claims (1201(b) trafficking against SerpApi, unfair competition, unjust enrichment) dismissed. Details differ across secondary sources. Sources: https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc, https://rightstech.com/2026/08/reddit-keeps-its-strange-dmca-fight-over-google-search-results-alive/ |
| New York Times v. Perplexity | Dec 2025 | S.D.N.Y. | Perplexity moved to dismiss counts II to V of the amended complaint (2026-04-17). No ruling seen. The Times' 10-Q for the quarter ended 2026-06-30 reports $4.6M of generative AI litigation costs without naming defendants (https://www.sec.gov/Archives/edgar/data/0000071691/000007169126000034/nyt-20260630.htm). |
| Chicago Tribune and seven other dailies | Dec 2025 | S.D.N.Y. | Partial motion to dismiss 2026-04-17; no ruling seen. |
| CNN v. Perplexity | May 2026 | S.D.N.Y. | Alleges over 17,000 items used. Partial motion to dismiss 2026-08-21. |
| Amazon v. Perplexity (Comet shopping agent) | Nov 2025 | N.D. Cal. | Preliminary injunction granted Mar 2026; Ninth Circuit vacated it 2026-08-04, reasoning that the user accesses Amazon, not Perplexity; rehearing en banc denied 2026-09-10 (tracker only; unverified). |
| RTI and Medusa Film | Dec 2025 | Rome | Pending. |
| Other | 2026 | N.D. Cal. | Individual privacy suits: one dismissed voluntarily 2026-05-01; another filed Jun 2026. |

No case has reached judgment. The tracker lists about ten cases; Press Gazette reports seven publishers suing (title only seen; https://pressgazette.co.uk/platforms/news-publisher-ai-deals-lawsuits-openai-google/).

Crawler dispute:

- Cloudflare, 2025-08-04: Perplexity used undeclared crawlers with a Chrome-on-macOS user agent and rotating IPs to reach sites that blocked it; test domains with a robots.txt disallow still returned detailed answers. Scale given: 20 to 25 million daily requests from the declared agent and 3 to 6 million daily from the undeclared one. Cloudflare delisted Perplexity as a verified bot and added blocking rules. ChatGPT-User stopped when blocked in the same test. Source: https://blog.cloudflare.com/perplexity-is-using-stealth-undeclared-crawlers-to-evade-website-no-crawl-directives/
- Perplexity's reply (via news coverage; its own statement not read): the analysis was technically flawed, the fetches are user-driven and not stored or used for training, and the identified bots were not Perplexity's (https://tech.co/news/cloudflare-perplexity-bots-ignore-no-crawl-directives).
- The Tow Center study (Mar 2025) independently found Perplexity answering accurately about blocked publishers.
- No resolution of the dispute was found.

Why it matters for a dependency:

- The service is not at risk of shutdown from these suits on the evidence found. Remedies sought are damages and injunctions; none has been ordered against the API.
- The Reddit and Dow Jones rulings let discovery proceed on how Perplexity gets content. An adverse ruling could change what the service can retrieve. Sites that block it (Cloudflare customers) already return thinner content to it.
- The Amazon ruling favors Perplexity's user-agent theory for agent browsing. It does not decide copyright claims.
- A box that sends private content in prompts to any of these vendors has the privacy questions in search-services.md; none of the lawsuits found concerns that.

## Gaps

- No independent evaluation of `sonar-deep-research` as an API model exists in what was found. Benchmarks test the consumer "Perplexity Research" product. The two may differ (model underneath, reasoning effort, search budget). Unverified.
- No independent benchmark of OpenAI's post-shutdown deep research path (`gpt-5.6-sol` plus Responses API).
- No independent evaluation of Gemini's April 2026 API agents. All Gemini rows are Gemini 2.5 Pro Deep Research from 2025.
- No independent evaluation of Parallel Task, Exa deep modes, You.com Research, or Tavily Research. All numbers are vendor or competitor numbers.
- No Reddit or Hacker News thread with first-hand deep research API experience was located by search. Searches returned blogs and vendor pages. A manual search of HN and r/LocalLLaMA / r/perplexity_ai is the next step.
- No OpenRouter-specific report of streaming, truncation, or missing citations for `sonar-deep-research`. A direct test with a long query is the only way to answer this.
- No study of Reddit or SEO-spam share by service, and no recency test.
- Several figures came from search summaries of vendor and aggregator pages (Artificial Analysis Search Index, Keenable, Eden AI, NewsCatcher roundups) and were not checked at the source.
- Court status comes from a tracker and news summaries. Check PACER or CourtListener for S.D.N.Y. cases before relying on dates.
- FutureSearch's table and the Tow Center study are the only independent cost or accuracy numbers and neither tests a hosted deep research API.
- The DeepResearch Bench citation-accuracy numbers for Perplexity differ between the paper (90.24%) and the leaderboard CSV (82.63%). Both are from 2025 runs.
