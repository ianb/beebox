# Studio outputs

*Snapshot dated 2026-10-09; public material only. **(3p)** marks third-party-only facts. Part of the [NotebookLM research corpus](README.md); the product overview is [product.md](product.md).*

The Studio column is where a notebook's generated artifacts live. The help page lists: notes, Audio Overviews, Video Overviews, mind maps, reports, data tables, flashcards, quizzes, slide decks, infographics. Since June 2026 the cloud computer adds arbitrary downloadable files (charts, PDF, DOCX, Markdown, XLSX, PPTX, CSV, JSON, images). Edits made in an exported Doc or Sheet do not sync back. Several outputs can be auto-generated when sources are first added, free of quota.

## Audio Overviews

- Formats (since 2025-09): **Deep Dive** (default, two hosts), **Brief** (one speaker, under about two minutes), **Critique** (two hosts give feedback on the user's own material), **Debate** (two hosts take opposing views). A single-host ~30-minute "Lecture" format was seen in testing (3p) with no launch found.
- Controls: a focus prompt (topics, expertise level of the listener), language (80+), length Shorter / Default / Longer (English only). The chat persona, when set, also steers the audio. No voice selection is documented.
- Generation runs in the background for "a couple of minutes" (Google); 3p guides report 3–8 minutes for an 8–20 minute result.
- **Interactive mode**: the listener joins mid-playback and asks the hosts questions by voice. English only; only on newly generated overviews; voice and transcript are not stored; link viewers cannot interact. Google's help page itself warns of speaker switches, a stray third voice, glitches, and a delay after joining.
- Output: in-app player, audio download, share link (notebook must be shared or public), or notebook share. Editors generate and delete; deleting breaks share links. Play Books sources may block download. Mobile: playback with background play; offline copy stays inside the app.
- No documentation says the audio links back to source passages. Only the chat and the text outputs carry citations.

## Video Overviews

- Formats: **Explainer** (structured, connects ideas across sources), **Short** (about 60 seconds, 80+ languages, since 2026-06-30), **Cinematic** (18+, English only, Ultra first from 2026-03-04).
- Visual styles for Explainer (18+): Classic, Whiteboard, Watercolor, Retro Print, Heritage, Paper-craft, Kawaii, Anime, auto, or a free-text custom style. Plus language, custom instructions and a steering prompt. Duration is fixed by format.
- Generation "can take a while, sometimes more than 30 minutes" (Google). Output: in-app player with rating, file download, link share. No post-generation editing; re-prompt to regenerate (3p).

## Mind maps

Created from a chat chip, saved as a note. Zoom, expand and collapse branches, click a node to open chat on that topic, download. Regenerate by deleting the note. Not on mobile. Whether a prompt can steer the structure is contradicted between 3p guides; the help page documents no prompt control.

## Reports

The 2025-09 redesign folded the older study guide, briefing document and FAQ into **Reports**, which also offers Blog Post, formats the model suggests from the sources, and "Create your own" (objective, audience, tone as free text). Whether a named Timeline option remains is unconfirmed. Reports are saved as notes, cite sources (3p), export to Docs, and tables within them export to Sheets. The September 2026 "interactive learning overview" is a report that embeds an infographic, quiz and flashcards.

## Flashcards and quizzes

Generated from the sources with a topic and difficulty; shareable as a study set; "Explain" gives a cited explanation for a card or a wrong answer. Since 2026-03-20: progress persists across sessions, Got it / Missed it, shuffle, rerun missed, delete individual items, web and mobile. September 2026 added short-answer, multiple-select and fill-in-the-blank, and the chat can discuss the user's quiz performance and edit or add questions. 3p reports that automatic questions sometimes dwell on peripheral details. No Anki export; copy to CSV (3p, contradicted by one source).

The **Learning Guide** chat preset is the tutor stance: it asks probing questions instead of answering. Study notebooks in the Gemini app (2026-06-25, 18+ first) sync with Notebook.

## Data tables, infographics, slide decks

- **Data table**: describe the rows and columns and language; export to Sheets puts the table on tab one and citations on tab two.
- **Infographic**: ten styles (Sketch Note, Kawaii, Professional, Scientific, Anime, Clay, Editorial, Instructional, Bento Grid, Bricks), detail level Concise / Standard / Detailed, orientation and language. Output is an image.
- **Slide deck**: Detailed Deck (reads standalone) or Presenter Slides (talking points); per-slide revision by prompt (2026-03-20); PPTX with editable text boxes, or PDF. 3p: 60–90 seconds, longer with 30+ sources; unfocused sources give weak decks.

## Citations across outputs

| Output | Cites sources? |
|---|---|
| Chat answer | Yes, inline, opens the passage |
| Report, FAQ, study guide | Yes (3p); fidelity after Docs export unverified |
| Flashcard / quiz "Explain" | Yes |
| Data table | Yes, on the Sheets export's second tab |
| Mind map | Indirect: node click opens a grounded chat |
| Audio, video, infographic, slides | Nothing documented |

## Old daily caps (3p, superseded 2026-09-02 by the compute quota in [product.md](product.md#usage-limits))

| Output | Free | Plus | Pro | Ultra |
|---|---|---|---|---|
| Audio per day | 3 | 6 | 20 | 100–200 |
| Video per day | 3 | 6 | 20 | 100–200 |
| Reports, flashcards, quizzes, mind maps per day | 10 | 20 | 100 | 500–1,000 |

## What only hands-on use would settle

Audio voice choices and whether Longer changes duration; typical report and mind map generation times; mind map export format; report citation fidelity after export; quiz question counts; infographic text rendering quality; the rate of ungrounded claims in audio and slides.

## Sources

Google help pages fetched 2026-10-09: Audio Overviews (`support.google.com/notebooklm/answer/16212820`), Video Overviews (`.../16454555`), Studio panel (`.../16206563`), mind maps (`.../16212283`); blog posts 2025-09-08 (student features), 2026-03-20 (Workspace Updates), 2026-06-08 (research upgrade), 2026-09-15 (study tools). Third-party: notebooklm-guide.com (studio guide, limits table, updates log), 9to5google on audio formats, review snippets from thebusinessdive.com and notebooktools.com.
