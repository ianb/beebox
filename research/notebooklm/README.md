# Google NotebookLM (Gemini Notebook) review

*2026-10-09. A snapshot of Google's Gemini Notebook, renamed from NotebookLM on 2026-07-16, from public material only: Google help pages, blog and Workspace Updates posts, Cloud docs, press, Hacker News, and third-party guides. No account was used and none was created. The Bee Box side was read from `worktree-notebooklm-research` at `cbffca9a9`. Method: three web-research subagents (Sonnet) and one code-reading subagent (Opus), with the rename, the June 2026 upgrade, the usage-limit change, the enterprise API and the Gemini multi-speaker TTS contract re-checked against Google's own pages by the driver. Research corpora get no cross-model review ([research/CLAUDE.md](../CLAUDE.md)).*

| Doc | Question | Outcome |
|---|---|---|
| [product.md](product.md) | What is Gemini Notebook in October 2026: sources, chat, notebooks, limits, tiers, sharing, mobile, API, timeline | A bounded-sources chat with a studio beside it; 30M users; compute-based quota since September; no consumer API |
| [studio-outputs.md](studio-outputs.md) | What the Studio generates, with what controls, and which outputs cite | Audio, video, mind map, reports, flashcards, quizzes, tables, infographics, decks, and since June arbitrary files; only text outputs cite |
| [reception.md](reception.md) | What people use it for and where it falls short | Study, listening, close reading, onboarding; complaints are the wall (no cross-notebook search, frozen sources, no export, no API) and audio sameness |
| [comparison.md](comparison.md) | Feature by feature against Bee Box, with code references | One overlap (documents plus help); Box ahead on sources, agent, provenance, cost legibility; Notebook ahead on mandatory citations, layout, audio, study polish |
| [citations.md](citations.md) | How Notebook stores sources and citations (from the unofficial client's decoding), against `{% source %}` | Notebook: one offset-addressed document per source, citations as mechanical retrieval records with an answer-side anchor. Box: a text anchor in a plain file with a drift hash. Three separable gaps listed for discussion, none filed |

## Dispositions

| Idea | Disposition | Traced to |
|---|---|---|
| Spoken overview of a card or landmark: v1 single voice from a cited script, v2 two speakers in one Gemini request | **adapt** | [issues/features/2026-10-09-spoken-overview-of-a-card-or-landmark.md](../../issues/features/2026-10-09-spoken-overview-of-a-card-or-landmark.md); `S/services/tts.ts:326-370` already calls a model that accepts two speakers |
| Retrieval practice whose results update the progress card; cited "Explain" on a miss | **adapt** into courseware Phase 2 | [issues/features/2026-10-09-retrieval-practice-updates-the-progress-card.md](../../issues/features/2026-10-09-retrieval-practice-updates-the-progress-card.md); `beebox/docs/implemented-plans/courseware-phase1.md:512` |
| The first input produces a visible artifact without a second ask; "study your documents" is served, "keep studying with me" is not | **adapt** as input to the use-case decision | dated note in [issues/decisions/2026-10-05-target-specific-underserved-use-cases.md](../../issues/decisions/2026-10-05-target-specific-underserved-use-cases.md) |
| YouTube transcripts and audio files as sources | **later** | [issues/features/2026-10-09-youtube-and-audio-files-as-sources.md](../../issues/features/2026-10-09-youtube-and-audio-files-as-sources.md); `S/lib/video-url.ts` embeds only |
| A place page that shows what was made from the place (the Studio column) | **later**, folds into existing work | [place-page tiles](../../issues/features/2026-10-09-place-page-tiles-omit-the-card-summary.md), [saved card sets](../../issues/features/2026-09-08-saved-card-sets-cross-landmark.md); not filed again |
| Mechanical citation from search hits; a compact chat reference form; a text-fragment locator for exact spans | **discuss** | [citations.md](citations.md#what-this-suggests-for-bee-box); `F/lib/selection/quote-anchor.ts`, `S/core/search/extract/core.ts` |
| Citations beside a data table (second sheet) | **reference** | `{% source %}` works inside a table cell already; a convention, not a feature |
| Hard source wall for a landmark chat ("answer only from these") | **reject** | the complaint list in [reception.md](reception.md); `what-you-could-do.md:194-200` keeps the scope soft on purpose |
| Report, FAQ, study guide, timeline, briefing-doc as card types | **reject** | a `doc` with `{% source %}` is each of these; Box's `briefing` card is a different thing (`S/schemas/briefing.tsx`) |
| Infographic, slide deck, cinematic video generation | **reject** | no household need; `figure` and `pandoc` cover the code-shaped cases |
| Public "chat with my collection" links, featured notebooks, analytics | **reject** | an agent running for strangers at the owner's cost; publishing is static by design (`beebox/docs/box/publishing.md`) |
| Compute-based quota, tiers | **reject** | the person's own subscription and keys are the cost model ([soft-launch posture](../../issues/decisions/2026-07-20-soft-launch-posture.md)) |
| Unofficial API clients, MCP servers | **reject** | nothing to integrate with; a box has no reason to push into a notebook |

## Where Bee Box is ahead

Household sources (paper through Docling with OCR, mail, captures, photos, messages) instead of browser uploads; citations with a span and a content hash; search across everything, with git history; an agent that runs code, writes files and works on a schedule; per-concept progress with evidence; a voice identity per box; files, git, `bbx`, tRPC and a versioned mobile contract instead of a lock-in list; cost that the person can read. Recorded so the survey is not read as a gap list only.

## What only hands-on use would settle

Audio voice quality and whether length controls work; how often citations are missing in practice; mind map prompt control; quiz question counts; the rate of ungrounded claims in audio and decks; the Gemini app sync in daily use. See the "could not confirm" lists in [studio-outputs.md](studio-outputs.md#what-only-hands-on-use-would-settle).
