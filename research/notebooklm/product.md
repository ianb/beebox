# Gemini Notebook (NotebookLM): the product in October 2026

*Snapshot dated 2026-10-09, from public material only: Google help pages, Google blog and Workspace Updates posts, Google Cloud docs, and press. No account was used. Facts marked **(3p)** rest only on third-party blogs or press; everything else is from a Google page fetched on the snapshot date. The product changes monthly; treat every limit here as "as of this date".*

Part of the [NotebookLM research corpus](README.md).

## Name and lineage

- Started as Project Tailwind at Google I/O in May 2023; became NotebookLM in 2024; "experimental" label removed 2024-10-17 (3p timeline).
- Renamed **Gemini Notebook** on 2026-07-16. Google's post calls it "the same standalone product with deeper Google integration and a secure cloud computer", and gives 30 million users and 600,000 organizations. Help pages now carry the new name; URLs and the mobile app still say `notebooklm` in places. The enterprise edition became Gemini Notebook Enterprise the same day.
- Sits beside "notebooks in the Gemini app" (April 2026), which sync both ways with Gemini Notebook. Shared notebooks do not appear in the Gemini app sidebar. Notebooks are also coming to AI Mode in Search (announced July 2026; live for English, non-EEA by August per 3p).

## The notebook

A notebook is a container with three columns: **Sources** (left), **Chat** (middle), **Studio** (right; notes and generated outputs). A notebook cannot use another notebook as a source. Deleting a notebook deletes its sources and chats. There is no search across notebooks (3p, a recurring complaint).

**Notes** are text saved by the user or saved from a chat answer ("Save to note"). Notes are not part of the chat's grounding unless selected. "Convert to source" turns one note, or all notes as one combined source, into a citable source; the combined source does not update when notes change.

Per-plan structural limits (Google help, "subject to change"):

| Plan | Notebooks per user | Sources per notebook |
|---|---|---|
| Standard (free) | 100 | 50 |
| Google AI Plus | 200 | 100 |
| Google AI Pro | 500 | 300 |
| Google AI Ultra (20 TB / 30 TB) | 500 | 500 / 600 |

Every source is capped at 500,000 words or 200 MB on all plans. Sharing a notebook does not raise a collaborator's limits.

## Sources

Supported: PDF, DOCX, PPTX, TXT, Markdown, CSV, ePub (since 2026-03-20), images (PNG, JPEG, WebP, HEIC), audio with speech (MP3, WAV and others), pasted text, Google Docs, Slides (max 100 slides), Sheets (about 100k tokens read), Drive URLs, web URLs, public YouTube URLs, Google Play Books, and Gemini chats. Not supported: web page images, embedded video, nested pages, paywalled pages, password-protected PDFs, audio without speech, YouTube without captions or speech.

Ingestion details that matter for comparison:

- **Drive files sync** every few minutes and on demand (since May 2026). Lost access or a deleted file leaves an inaccessible source that still counts against the cap. Footnotes and comments are dropped; multiple tabs merge into one source.
- **Web pages and uploads are frozen at import.** Nothing documents a refresh for them.
- **YouTube** needs captions or speech; a source from a deleted or private video is removed within 30 days.
- **Retrieval internals are not documented.** Third-party descriptions conflict; a 2025-10 announcement put a 1M-token context on all plans (3p). Only sources with their checkbox on are used in chat.
- **Auto-generated outputs on first add.** When sources are added, Notebook can generate a report, flashcards, infographic, slide deck, audio and video automatically; those do not count against usage limits.

**Finding sources.** "Fast Research" searches the web or Drive from the Sources panel and lets the user pick results to import. "Deep Research" (2025-11-13) runs in the background for several minutes, plans, browses, writes a cited report, and lists cited and uncited sources for import; the report itself can be imported. Since the June 2026 upgrade the chat can also guide a user from "loose ideas or questions" to a source set, using Google Search for web sources including non-English primary sources.

**Mobile capture (September 2026).** The mobile app records lectures and spoken notes; recordings save beside the sources and can be chatted with, cited and edited. Under-18 accounts get English output only.

## Grounded chat

- Answers draw only on the selected sources plus the conversation; Google's FAQ states that when the answer is not in the sources "it won't provide a response". Notes join the grounding only when selected.
- Inline numbered citations open the passage in the source viewer. The FAQ adds two limits: citations are not always included, and a short source is cited as a whole document.
- Chat history is saved, private to each user even in a shared notebook, resumable and deletable (2026-03-20). Before that, chats did not persist.
- "Configure chat" (3p for the details): presets Default, Learning Guide (asks questions rather than answering, a tutor stance; announced 2025-09), and Custom with a persona or goal text up to 10,000 characters; response length Default, Longer, Shorter. The persona also steers Studio outputs including Audio Overviews.
- Chat can produce Studio artifacts directly (2026-03-20).
- Model: Gemini 3.5 "and Antigravity" since 2026-06-08 (Google blog). The same post reports a 65% average win rate over the prior system across five evaluation dimensions, with "groundedness against user-uploaded sources" one of the accuracy measures.
- **Cloud computer** (2026-06-08; Ultra and Workspace AI Expanded Access first, Pro over the following weeks): each notebook gets a sandbox that writes and runs code over the sources, with "more than 100 curated software skills", producing downloadable charts (PNG, SVG), documents (PDF, DOCX, Markdown, text), images, structured data (CSV, JSON), spreadsheets (XLSX) and presentations (PPTX). Outputs can be edited after generation by further instruction.
- **Live voice** (2026-09-15): real-time spoken conversation with a notebook in the mobile app, nearly 100 languages, interruptible, grounded in sources. Ultra 18+ first, Pro following.

## Usage limits

From 2026-09-02 consumer accounts moved from fixed daily counts (3p: 50/200/500 chats and 3/6/20 audio generations per day on free/Plus/Pro) to a **compute quota**: usage depends on prompt complexity, models and features used, chat length and source count; it refreshes every five hours up to a weekly cap; Plus is 2x standard, Pro 4x, Ultra 5x or 20x of Pro. Google does not publish absolute numbers. Settings > Usage shows the balance, chat shows the reset time, and Studio shows an expected-cost bar before generating. "Generate later" (web only) queues an output when the quota is spent and notifies when it is ready, "a couple of hours" later.

Enterprise limits (Google Cloud docs, 2026-10-07): 500 notebooks per user, 300 sources per notebook, 500 MB or 500,000 words per source, 500 queries per user per day.

## Tiers, price, privacy

- Consumer tiers are the Google AI plans; there is no standalone NotebookLM subscription any more. Prices (3p): AI Plus $4.99, AI Pro $19.99, AI Ultra from $99.99 a month. US college students get a year of AI Pro free until 2026-12-31; other markets get AI Plus.
- Enterprise: sold standalone or inside Gemini Enterprise; about $9 per license per month (3p). Data stays in the customer's Cloud project; CMEK, VPC Service Controls, and us/eu/global residency. Enterprise notebooks cannot be shared outside the project.
- Personal accounts: sources are not used for training unless the user sends feedback, after which Google may review the whole interaction. Workspace and Education accounts: no human review and no training, feedback included.
- Age: consumers 13+ (since 2025-08-04); Education accounts any age with stricter content policy; several features (Cinematic video, new infographic styles, live voice, Deep Research) are 18+.

## Sharing and collaboration

- Roles: Viewer (chat, copy, read sources and generated outputs) and Editor (add and remove sources and notes, generate and delete outputs, share further). Personal accounts: up to 50 users, no Google Groups.
- Public link ("Anyone with a link", since 2025-06-03) needs a Google account to open. "Copy link to chat view" hides sources and artifacts, with Google's own warning that viewers "may still find the hidden materials". Individual artifacts (an audio file) can be shared by link to signed-out viewers.
- Analytics for a shared notebook: paid owners, four or more users, chat activity in the last seven days; users and queries per day.
- Featured notebooks (2025-07-14, with The Atlantic, The Economist and others): consumer accounts only; readers chat and use pre-made outputs but cannot add sources or generate.
- Classroom: teachers assign notebooks to students of any age (2025-09); higher-education students 18+ create their own class notebooks (2026-04-27).

## Mobile apps

iOS and Android since 2025-05-19. Audio Overview playback with background play and in-app offline download (not saved as a file); add sources from the OS share sheet (web pages, PDFs, YouTube, copied text, audio). Launch-era help lists chat configuration, analytics, notes, mind maps, reports and data tables as web-only; the September 2026 release added live voice and the audio recorder. "Generate later" is web-only.

## API and integrations

- **No consumer API.** Google's only API is the enterprise one: Discovery Engine `v1alpha`, marked Pre-GA, with notebook create, get, list recently viewed, batch delete and share (Owner, Writer, Reader), plus separate guides for adding sources and generating audio overviews. Chat or query through the API is not documented. A separate Podcast API is deprecated.
- **Unofficial clients** drive the web app's internal RPCs with browser cookies. The most maintained is notebooklm-py (0.8.4, 2026-10-01); its troubleshooting guide says cookies expire every few weeks, Google rotates method IDs without warning, and rate limits are strict. Several unrelated projects use the name "notebooklm-mcp". No official Chrome extension exists.
- Integrations run through Google's own surfaces: Drive sync, the Gemini app, Classroom, Search AI Mode, and export to Docs, Sheets and the downloadable formats above.

## Timeline

| Date | Event |
|---|---|
| 2023-05 | Project Tailwind at I/O |
| 2024-09 | Audio Overviews |
| 2024-12 | Interactive audio; NotebookLM Plus for enterprise |
| 2025-02-10 | Plus for individuals via Google One AI Premium |
| 2025-05-19 | iOS and Android apps |
| 2025-06-03 | Public links |
| 2025-07-14 | Featured notebooks |
| 2025-08-04 | Opened to 13+ and all-ages Education |
| 2025-09-08 | Flashcards, quizzes, reports redesign, Learning Guide, audio formats (Brief, Critique, Debate) |
| 2025-11-13 | Deep Research; Sheets, DOCX, images, Drive PDFs as sources |
| 2025-12-19 | Gemini 3; data tables (3p) |
| 2026-03-04 | Cinematic Video Overviews (Ultra) |
| 2026-03-20 | Saved chat history, ePub, chat-created artifacts, slide revision and PPTX, quiz progress, ten infographic styles |
| 2026-04-08 | Notebooks in the Gemini app |
| 2026-05-26 | Drive auto-sync |
| 2026-06-08 | Gemini 3.5 and Antigravity; per-notebook cloud computer; downloadable file outputs |
| 2026-07-16 | Renamed Gemini Notebook |
| 2026-08-28 | Compute-based usage limits announced (effective 2026-09-02) |
| 2026-09-15 | Live voice, mobile recorder, interactive learning overviews, new quiz formats, short videos |

## Sources

Google pages fetched 2026-10-09: help FAQ (`support.google.com/notebooklm/answer/16269187`), sources help (`.../16215270`), plan limits (`.../16213268`), usage limits (`support.google.com/gemininotebook/answer/17670842`), privacy (`.../notebooklm/answer/16164461`), sharing (`.../16206563`), public and featured notebooks (`support.google.com/gemininotebook/answer/16322204`), Gemini app notebooks (`support.google.com/gemini/answer/16972047`); blog posts "Do better research with NotebookLM" (2026-06-08), "NotebookLM is now Gemini Notebook" (2026-07-16), "flexible usage limits" (2026-08-28), "Sharpen your study routine" (2026-09-15), Workspace Updates 2026-03-20 and 2026-07-16; Google Cloud enterprise overview, sharing and API pages (2026-10-07). Third-party: 9to5google and Chrome Unboxed on the June upgrade; fast.io, geminiomniprompts and glasp limit tables (checked 2026-09); notebooklm-py docs and PyPI; Hacker News via the Algolia API; Wikipedia for the timeline.
