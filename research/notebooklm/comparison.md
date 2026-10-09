# Gemini Notebook against Bee Box

*Dated 2026-10-09. Bee Box as read at `cbffca9a9` on `worktree-notebooklm-research`; the Notebook side is [product.md](product.md), [studio-outputs.md](studio-outputs.md) and [reception.md](reception.md). Paths use `S/` for `beebox/src/` and `F/` for `beebox/src/frontend/src/`. Part of the [NotebookLM research corpus](README.md); dispositions are collected in the index.*

## The shapes

**Notebook:** a bounded set of sources, a chat that answers only from them, and a studio that renders them into other forms. Everything is derived from the sources; the sources are frozen unless they are Google Drive files; the notebook is the unit of sharing, quota and search. There is no agent: the user asks, the model answers; the June 2026 cloud computer runs code inside a request but nothing runs on a schedule or acts for the user.

**Box:** a filesystem of cards with git history, an agent (Claude Code or Codex) that reads, writes, searches and runs code over it, schedules, connectors, and a chat that is one of several ways in. Nothing is derived automatically; the agent decides what to search and whether to cite. A landmark marks a directory as a place; a chat started there is scoped by a prompt note, and the agent can still read the whole box (`beebox/docs/box/what-you-could-do.md:194-200`).

The two overlap on exactly one thing: a person brings documents and wants to understand them with help. They differ on where the documents come from (a Google account against a household's files, scans, mail and captures), who else is in the room (collaborators on one notebook against members of one box), and what happens when nobody is asking (nothing against schedules).

## Source grounding and citations

| | Notebook | Box |
|---|---|---|
| Grounding | Only selected sources plus the conversation; the FAQ says it does not answer when the answer is not in the sources | The agent decides; THE_LAW_OF_CHECKING in the agent guide says run `bbx search` first and "say where you checked" (`S/core/agent-guide/guide.md:124-133`) |
| Citation form | Numbered inline citations, always generated, open the passage in the source viewer; sometimes missing, whole-document for short sources | `{% source ref= pos= %}` plus `{% quote %}`, rendered as a chip that scrolls to the quoted span in a sibling pane (`F/…/Source.tsx:55-106`); plain box-path links open the card; PDF pages address as `?page=N`; nothing numbers or footnotes |
| Provenance over time | None for uploads and web pages; Drive sources re-sync | `version: sha256:` and `git:` on a source anchor, `retrieved` on an external `href` (`beebox/box-docs/provenance.md`) |
| Index | Undocumented; "1M-token context" on all plans (3p) | Orama BM25 over cards split by heading, embeddings only over each card's one-line `contains` (`S/core/search/refresh/embed-pass.ts`), index refresh lazy at query time; chat transcripts in a separate index the agent cannot reach |
| Source types | PDF, Office, text, Markdown, ePub, images, audio with speech, Docs, Slides, Sheets, web URLs, YouTube, Play Books, Gemini chats | Docling PDF intake with OCR by text-layer quality (`S/services/docling/core.ts`), vision over photos and scans, Chrome clerk web clipping with a frozen HTML snapshot, Gmail, Drive, Telegram, captures with transcription; no YouTube transcript and no general "upload an audio file as a source" path |
| Finding sources | Fast Research (web or Drive) and Deep Research (background agent, cited report, pick sources to import) | The agent's own WebSearch and WebFetch; no server-side page capture ([issue](../../issues/features/2026-09-11-server-side-webpage-capture.md)) |

**Reading.** Notebook's one durable advantage is that the citation is not optional: every answer cites or refuses. Box has the richer citation (a span with a content hash) and the richer sources (OCR'd paper, mail, captures), but the citation appears only when the agent follows the rule. The reception note shows what people value: "grounded to the source material" is the praise, and the hard wall is the complaint (no cross-notebook search, nothing refreshes, no export). Box has the opposite defaults on every one of those complaints. A hard source wall for landmark chats would trade the thing people like about a box for the thing people dislike about Notebook; the scope hint stays soft.

One narrow gap worth closing: a YouTube link in a box is embedded for display only (`S/lib/video-url.ts`), and audio files reach the box only through capture or a chat attachment. For a household (a recipe video, a recorded lecture, a voice memo from a relative) these are ordinary sources.

## Generated artifacts and the Studio

| Notebook output | Box equivalent | Verdict |
|---|---|---|
| Report (study guide, briefing doc, FAQ, blog post, custom) | A `doc` card the agent writes with `{% source %}` anchors; "research write-ups are a card with sources" | Covered; the agent writes a better-cited document on request. No "format gallery", and none is needed: a format is a sentence in chat |
| Mind map | `concept-map` card with typed edges and Bloom depth (`S/schemas/concept-map.ts`) | Box is ahead in structure; Notebook's map is a navigation device that opens a scoped chat per node, which a concept map could also do |
| Data table with citations on a second sheet | A `record` or a Markdown table in a `doc`; `gsheet` connector | Covered by the agent; the "citations beside the table" convention is a nice touch and `{% source %}` inside a table cell already works |
| Infographic, slide deck, cinematic video | `figure` cards (interactive widgets), `pandoc` from a doc, the cloud-computer-equivalent is Claude Code itself | Box is ahead on anything that is code; it has no image-generation path and no reason to add one for a household |
| Flashcards and quizzes with progress and cited "Explain" | None; `progress` card with evidence-based levels; retrieval practice named for courseware Phase 2 (`beebox/docs/implemented-plans/courseware-phase1.md:512`) | See Learning below |
| Audio Overview (two hosts), Brief, Critique, Debate; interactive join | None; TTS only reads chat replies aloud (`S/webapp/routes/chat/audio-routes.ts`) | See Audio below |
| Auto-generated outputs when sources are added | `intake-job` and the clerk's `.commentary.card`; `contains` one-line summaries; daily `MAP.md`; nightly `chat-review` (off by default) | Covered in spirit; Box's versions are for navigation and the agent, Notebook's are for the person |
| Cloud computer: run code, export PDF, DOCX, XLSX, PPTX, CSV, JSON, charts | The agent is a coding agent with a shell; `figure` for live charts; `pandoc` for Office formats | Box is ahead and has been since day one; Notebook arrived here in June 2026 |

**Reading.** The Studio is a menu of things a coding agent can already do on request. What Notebook adds is not the outputs but their placement: the outputs sit in a column beside the sources, each one a tile with a name, and the first ones appear without being asked. Box's closest surface is the landmark place page ("Start something", "Start here", "Main cards"); a landmark whose place page showed "what the box made from this" would be the same affordance, and the [place-page tiles issue](../../issues/features/2026-10-09-place-page-tiles-omit-the-card-summary.md) is already in that direction. No new card types are needed for reports, FAQs or timelines; a `doc` is one, and the box's "briefing" is a different thing (the person's context for the agent, `S/schemas/briefing.tsx`), so the name should not be reused.

## Audio

Notebook's Audio Overview is the feature most people name, and its failures are specific: one tone for everything, glitches in interactive mode, TeX read aloud, nothing cites back to a passage. Its value is listening while doing something else.

Box today: two TTS backends; the Gemini one calls `gemini-3.8-flash-lite-tts` on the Interactions API with `speech_config: [{voice}]` (`S/services/tts.ts:326-370`). Only chat replies are spoken; nothing is saved as audio; `<speech name="Bob" voice="onyx">` switches voice per segment but each segment is a separate single-voice request (`S/core/chat/voice-doc.ts:55`). The personality card already carries a voice and a speaking style, so a box has a voice of its own, which is the thing Notebook's audio lacks.

What a "listen to this" feature would take, checked against Google's speech docs on 2026-10-09:

- **Single voice, v1.** A `bbx` command or procedure that takes a card (or a landmark's main cards), has the agent write a spoken script as a `doc` card with `{% source %}` anchors, renders it through the existing TTS service, and files the MP3 as an `audio` card beside the script. Every piece exists; the new code is the command and the audio-card write. The transcript cites, which Notebook's audio does not.
- **Two voices, v2.** The same model Box already calls accepts up to two prebuilt-voice speakers in one request: each turn carries `speech_metadata: {speaker, style}` and `speech_config` becomes `{speakers: [{speaker, voice}, …], mode: "conversational"}`. That is a change inside `createGeminiTts`, not a new backend. The script becomes a dialogue in the box's own voice plus one guest.
- **Interactive join** (ask the hosts a question mid-playback) is already what a box chat with voice in and voice out is; Notebook's version is the one its help page warns about.

The reasons to do it are the chemistry learner (a recap to listen to on the way home), scanned paper ("read me this letter"), and Box's existing voice identity. The reason to wait is that nothing in the journeys asked for it. Filed as [spoken overview of a card or landmark](../../issues/features/2026-10-09-spoken-overview-of-a-card-or-landmark.md) with `needs: [design]`.

## Notebooks and landmarks

A notebook is sources plus the conversation about them, and the conversation is private per user even in a shared notebook. A landmark is a directory with a place page; chats started there are stored under `_content/chat/web/` with a `context-dir` and grouped by exact match (`S/webapp/trpc/routers/chat/router.ts:186`), visible to every member. The course manifest (`S/schemas/course.ts`) is the box's one real "sources plus the work about them" container.

What a landmark lacks that a notebook has: a list of the sources it is "about" (derived from `entry-point` and `primary` cards, plus hand-curated `links:`; the [saved card sets issue](../../issues/features/2026-09-08-saved-card-sets-cross-landmark.md) and the collections notes cover this), per-person recent conversation ([issue](../../issues/features/2026-09-12-most-recent-conversation-should-be-per-person.md)), and the generated-things column above. What a notebook lacks that a landmark has: nesting, the agent walking in and out, files that are also the record, and schedules that act on the place.

The honest comparison is that a landmark is a place in a house and a notebook is a reading room with one table. Nothing to adopt beyond the two issues already open.

## Learning

Notebook's September 2026 release is aimed entirely at study: live voice tutoring, a lecture recorder, learning overviews that bundle a summary, quiz and flashcards, more quiz formats, "ask the chat about your quiz performance", and a free year of AI Pro for US college students. Its Learning Guide preset asks questions instead of answering.

The chemistry journey (`beebox/test/user-stories/journeys/D-chemistry/`) is this use case without the sources: a learner with no textbook upload and no photographs, who wants continuity across evenings. Box's courseware answers with a concept map, a lesson plan, an exposition plan, and a progress card whose levels carry a basis (observed, inferred, self-report) and keep the wrong first model visible after correction (`S/schemas/progress.ts`). Spaced review and numeric mastery were rejected on purpose; retrieval practice is named for Phase 2.

| | Notebook | Box |
|---|---|---|
| Probing | Quiz generated from sources, difficulty settable | Piagetian interview, "not a quiz" (`build-course` skill) |
| Progress | Per-card Got it / Missed it, persists; chat can discuss performance (since 2026-09) | Per-concept level with basis and evidence; `next-probe`, `misconception` |
| Wrong answers | "Explain" with a cited explanation | Correction in chat; evidence stays on the progress card |
| Continuity | Chat history saved; study notebooks in the Gemini app | Landmark chat, recap on return worked in the 2026-10-09 walk; the learner-facing study home is [open](../../issues/features/2026-09-21-course-study-home-last-next-uncertain.md) |
| Sources | Required | Optional; the skill says to bring material into the box and cite it |

Two things to take. First, Notebook's "Explain" on a missed item is a cited explanation; Box's tutor can do that today through `{% source %}` and the skill already demands it for answer keys (`S/core/box/guidance-sync/skills-content.ts:134`), so this is a check in the journey reader, not a feature. Second, "ask the chat about my quiz performance" is exactly what the progress card is for, and the Phase 2 retrieval-practice item should make the progress card the thing that practice updates, with no new `quiz` card type; filed as [retrieval practice updates the progress card](../../issues/features/2026-10-09-retrieval-practice-updates-the-progress-card.md).

## Sharing, tiers, mobile, API

- **Sharing.** Notebook: Viewer and Editor, public links behind a Google account, a chat-only link that Google itself says does not hide the sources, analytics for paid owners. Box: owner and member in one circle, invite links, static snapshot publishing with a leak scan and a human approval, never yet deployed live. A "chat with my published collection" for outsiders would mean an agent running for strangers at the owner's cost; nothing in the box's egress design allows it and nothing here argues for it. Reject.
- **Tiers.** Notebook's quota became compute-based with unpublished numbers in September 2026; Box's cost is the person's own Claude subscription and keys, visible in `_bookkeeping/usage/`. Box is ahead on legibility; it is also the thing the soft-launch decision uses as a filter.
- **Mobile.** Notebook's apps add live voice and a recorder as of September 2026. Box's iOS companion has native capture, live and on-device HQ transcription, and TTS playback. Equal for the purposes here.
- **API.** Notebook has no consumer API; the enterprise one is v1alpha with no chat endpoint; the unofficial clients break on cookie expiry and rotated method IDs. Box is files, git, `bbx`, tRPC and an iOS wire contract. Nothing to take, and this is the clearest "where Box is ahead".

## Positioning

Notebook is one narrow verb ("understand these sources") with one obvious first step (add a source) and outputs that appear before the person asks for anything. It reached 30 million users and 600,000 organizations on that, then widened (cloud computer, Gemini app sync, Search) once the narrow thing was established. The use-case decision ([2026-10-05](../../issues/decisions/2026-10-05-target-specific-underserved-use-cases.md)) asks for "real and underserved" uses with "an easy way to start". Three readings:

1. **"Study your documents" is not underserved any more.** It is Google's current focus for this product, free for students, with a lecture recorder and live voice tutoring. The chemistry journey's distinct ground is continuity across weeks and learning without a textbook; that is a tutoring relationship, which the courseware already models and Notebook does not (its progress is per card, not per concept with evidence). If learning is picked as a starter, it should be framed as "keep studying with me", not "chat with your notes".
2. **The start is the product.** Notebook's empty state is one button ("Add source") and the first output is free and automatic. Box's empty state is a chat with two openers and a page that says "Nothing here yet". The [starter manifest issue](../../issues/features/2026-10-08-starter-manifest-and-scripted-first-turn.md) already says the first turn should be scripted; Notebook adds the rule that the first input should produce a visible artifact without a second ask. Appended to the decision issue as a dated note.
3. **Household sources are the moat, not the format gallery.** Scanned paper, mail, captures, photos, and a shared box are things Notebook cannot ingest at all or only through Drive. The use cases that fit Box best are the ones whose sources never pass through a browser upload.

## Where each is ahead

**Notebook ahead:** citations that are never optional; a sources-and-outputs layout a non-technical person reads at a glance; audio and video renderings; auto-generated first outputs; study loop polish (quiz formats, persistent progress, "explain"); YouTube and audio-file sources; Deep Research as a source finder; a mobile recorder; scale and price (free tier, student year).

**Box ahead:** sources of a household (paper, mail, captures, photos, messages) rather than uploads; citations that carry a content hash and a span; search across everything with history; an agent that runs code, writes files, and works on a schedule; a tutor that keeps evidence per concept; a voice identity per box; files, git and a CLI instead of a lock-in complaint list; cost legibility; per-user data that never leaves the host.

## Dispositions

See the [index](README.md#dispositions).
