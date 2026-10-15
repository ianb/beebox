# Bee Box product features by month, 2026

Star (*) marks the top two per month. Hashes are short commit hashes in this repo. The product was called `<old-package>` until 2026-08-30. Where a feature spans many commits, the hash is the first commit that made it usable; "(plan)" means the hash is the commit that added the completed plan doc. Many implemented-plan files carry the bulk-move date 2026-08-30, so dates here come from the feature commits instead.

## 2026-01 (first commit 01-27)
- 2026-01-28 23e23d783 * Notes are stored as structured text files ("cards") with typed fields, links between cards, and validation, in a git repository.
- 2026-01-31 0ae6c8d3d * First web app: browse the box in a browser, with the same actions as the command line.
- 2026-01-30 e5cc933ad The project becomes a "box": one folder of cards that a person and agents both work in.
- 2026-01-31 e350ce079 RSS connector: feeds flow into the box and an agent can be run on what arrives.

## 2026-02
- 2026-02-01 9dbc41fe2 * Daily news brief: an agent reads feeds and writes a curated edition with excerpts and sources.
- 2026-02-07 83c6a9435 * Chrome extension: popup and side panel to save the current page into the box (save-to-brief and page capture followed 02-11 and 02-15).
- 2026-02-01 022c3f4b1 Voice feedback: record a spoken reaction to a brief and have it transcribed.
- 2026-02-17 a6d5001c0 Gmail connector: email threads become cards. Google Calendar sync followed the same day (75035f51e) and later gained two-way edits.
- 2026-02-14 925347816 Recipe cards with scaling, with a view that renders amounts as proper fractions (4601cffad).
- 2026-02-24 544610d5b Talk to the box: live speech-to-text in chat, then spoken replies and turn-taking (e17211559, 890b12893).
- 2026-02-21 b49e118e4 Background jobs: the box works through inbox items, calendar changes and questions on its own.
- 2026-02-25 687f2c4d2 Installable on a phone as a web app.

## 2026-03
- 2026-03-05 f0e5d5e62 * Share a link to the box from the phone share sheet.
- 2026-03-06 10369917b * Capture page: record audio and take photos straight into the box (full-resolution photos 03-16, retries 03-18).
- 2026-03-19 41b7cd3bb Views: agents write small interface pages the person can open in the app.
- 2026-03-09 958ea7945 Several people can chat with one box (profile menu d9f03edaa), and a to-do list card type arrived 03-10 (bba15a36c).
- 2026-02-28 b15d6adb7 Cloud hosting: sign in with Google, run on a server (Google sign-in d6a0ea053).
- 2026-03-16 2bf2c8b65 Image zoom (lightbox) in cards and chat; chat shows images (03-18).
- 2026-03-30 cbb57a10c Google Drive connector with spreadsheets rendered as sheets.

## 2026-04
- 2026-04-19 6deac8479 * Activities: guided, reusable sessions (a language-practice activity shipped first, 215a507db) with their own chat screen (04-24).
- 2026-04-14 4e6aae12e * Paste or drop images into chat, upload files into capture (c15e568a4), and into chat (04-27, 9f8182fa2).
- 2026-04-19 810dcc5ee Pick the chat model and compact long conversations.
- 2026-04-27 68247a544 Gmail connector rebuilt on Google's API, with a filter screen.
- 2026-04-28 ec7b74eea Batch photo import: a command to scan in and upload a folder of photos.

## 2026-05
- 2026-05-04 ee3bf65b9 * Landmarks: a curated set of entry points to the box, each with its own linked chats (landmark chats 32524a34d, 05-05).
- 2026-05-13 0fdfa4403 * Narration mode: dictate to the box while it listens and answers with short acknowledgments; higher-accuracy transcription is swapped in afterward (d09ce68b6, 05-15; Deepgram live captions 1d594577d, 05-01).
- 2026-05-19 a245996d9 Inbox triage pipeline: new items are sorted, matched to destinations, then handled (three stages, 05-19 to 05-20).
- 2026-05-04 c084beab6 Daily maps: each folder gets a generated summary page.
- 2026-05-12 60cf016d5 Chats picker page to find and resume earlier conversations.
- 2026-05-22 b2fd640db Cards are now readable Markdown with a header block instead of XML (migration started 05-21, news subsystem removed 05-22, 33bb72dc6).
- 2026-05-27 abe022f99 New app icon; uptime health endpoint (5a8b42235, 05-26).

## 2026-06
- 2026-06-09 d0111e452 * Full-text search across the whole box (CLI first; Cmd-K quick search came later).
- 2026-06-15 4a867dee2 * Web clipper keeps a frozen copy of the page; the Chrome extension saves pages with the person's own commentary attached, and a chip jumps to the quoted passage (f8ff05fd2).
- 2026-06-11 5530085ad Chrome extension rebuilt: pick which box it talks to, save actions wired to the box.
- 2026-06-18 ed92e412f External files: cards that mirror documents living outside the box.
- 2026-06-23 503224586 Figure cards: interactive diagrams and sketches (p5, three.js, D3) embedded in notes and chat (embeds ee44c04fe).
- 2026-06-23 1136162a4 Courseware: concept maps, lesson plans, and a skill that builds a course (build-course 959b8e809, 06-24).
- 2026-06-29 dfc41b8b0 Phone and desktop push notifications (subscribe flow 6112c5bcd).

## 2026-07
- 2026-07-06 f5bcd2fc5 * Native iOS companion app (authenticated pairing d197e465c, 07-07); durable offline capture and background uploads followed 07-17 (91e165735, 19827e339); device-auth lock for a box 07-20 (1496f52c1).
- 2026-07-15 59c262e69 * Publishing: put selected cards on the web as a static site, with a leak scan and account tiers (leak scan 150550f5c, submissions drop-box 4da46a5a5).
- 2026-07-19 b561377d2 Password login and first-run setup, with authentication on by default; invites came in August.
- 2026-07-04 df558b9b5 One server hosting many boxes behind a login and box picker (hub); boxes become installable packages with upgrade (50e0b40d9).
- 2026-07-09 d8f87ae8d Search understands meaning, not only words (hybrid keyword plus embeddings).
- 2026-07-11 ca400ed9a The agent can ask for a screenshot of what you see; the extension relays captures (4e4c2c520, 0bcc1e4a3).
- 2026-07-28 01307f987 To-dos anywhere: any card can carry to-dos, collected into one list (b5aa63783).

## 2026-08
- 2026-08-30 dab834811 * The product is renamed Bee Box.
- 2026-08-17 4942d9be4 * Secrets manager: API keys and credentials held in one machine-level store, with an Admin section and per-agent grants (7e536a38e).
- 2026-08-26 f1dcda365 Drive folder mounts: a Drive folder mirrors into the box as a folder card, with a mount manager in Settings (615392823).
- 2026-08-13 d2c84a865 Codex support alongside Claude; pick engine and model per chat (79dac0af3, 08-25); sign in to Codex through Admin (c5b01aaf9, 08-31).
- 2026-08-06 a9d4a9f5a Invite other people to a box, and manage invites and passwords in the app (c012f7099).
- 2026-08-01 39fb9bfa6 Laptop scan uploader: a small program that sends scanned documents to the box, with pairing (scan routes 90227935f).
- 2026-08-02 f477285b4 New top bar: a place chip with switch and "here" menus; landmarks merge with chat activity (ea4ae2835).
- 2026-08-23 9ce149356 First-run suggested questions on an empty chat; the agent can point at controls in the interface (178207e67, 0bb8f3acb).

## 2026-09
- 2026-09-08 33a55a7ab * Card themes: paper surfaces, themed card workspaces in chat (98bc0aacb), return cues.
- 2026-09-10 2eaf6fc17 * Resilient voice recording: recordings are staged and uploaded in pieces, survive disconnects, and get a late high-accuracy correction (1b084ccb3, 980514622).
- 2026-09-06 d64d435d3 Card prominence: important cards show in browse and landmark lists, the rest fold away (7964059a9).
- 2026-09-12 ba98d9678 Browser-task card: a page of instructions plus form that the Chrome extension fills with scraped records (5188429af).
- 2026-09-15 aec22079d Search card with Cmd-K quick search from any place.
- 2026-09-21 e04dbc65f Quick chat: a fast, lightweight capture-and-route path (Jev model) for short thoughts; document triage with follow-up questions (5844a1024, 2e7bf35df).
- 2026-09-24 28ec4fd00 Managed static-site publishing with custom hostnames (b4e97f062, 09-25) and Cloudflare setup guidance.
- 2026-09-14 21b137dd2 Large media stored with git-annex, replacing Git LFS (switch began 07-30, ccdef9f83).

## 2026-10 (through 10-12)
- 2026-10-08 7593281a4 * Themes expand: seven material-inspired collections plus three expressive collections with composition and material controls (9e10a86e7).
- 2026-10-06 542675d50 * Box screen: a home page for each box on web (and native, 958bc35a7), with iOS quick chat outbox (743391f52).
- 2026-10-05 70fe47f69 Spoken replies stream to the browser as they are generated, with clear errors when speech fails (794204cae).
- 2026-10-09 a90dd8715 Capture a thought on iOS from a shortcut, with no app launch (App Intents).
- 2026-10-02 45ade80ac Mark chats done; Recent chats shows only current ones, done and expired chats are behind "All chats" (d164be818).
- 2026-10-02 db822652d Published sites render Markdown pages automatically, and omit redacted text (058ab8a32).
- 2026-10-10 0ae81a468 Plugins: installable extensions for a box (plan; slice 2 67fb439a6).

## The arc

January to March the product was a card store with a web view, fed by connectors (feeds, Gmail, Calendar, Drive) and by voice, with a news brief as the first real workflow; chat and capture arrived in February and March. April and May turned it into something a person navigates and talks to: landmarks, landmark chats, narration-style dictation, an inbox triage pipeline, and the shift from XML cards to readable Markdown cards. June added the Chrome clipper with commentary, full-text search, figures, courseware, and push notifications. July took it off one laptop: iOS app, Docker and multi-box hosting, password login, publishing, semantic search, to-dos. August was the hardening and widening month: secrets, invites, Codex alongside Claude, Drive mounts, scan uploader, a new top bar, and the rename to Bee Box on 08-30. September polished how it looks and what it keeps: card themes and symbols, prominence, resilient voice recording, quick chat, managed publishing, annex storage, OpenRouter models. October leans on presentation and reach: material and expressive themes, a per-box home screen, streamed speech, iOS App Intents, mark-done chats, and plugins. The focus moved from "an agent that files things into a repository" to "a personal assistant a person talks to from a phone, with the repository kept underneath".
