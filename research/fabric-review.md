# Fabric vs Bee Box

*Reviewed 2026-10-17 from public material only: fabric.so feature, guide, pricing, privacy, terms, connections and changelog pages; `fabric.so/llms.txt`; exabase.io; the iOS App Store listing; TechCrunch's 2023 launch article; two 2026 third-party reviews (one affiliate, one by a competitor). No account was created and nothing was signed into, so every claim about behavior is the vendor's description. Method: one web-research subagent (Sonnet) drafted a fact sheet; the driver re-fetched the agents, privacy, terms, email, MCP, search, home, connections, App Store and Exabase pages before relying on them. A dated snapshot; not maintained as either system changes. Research gets no cross-model review ([AGENTS.md](AGENTS.md)).*

## What it is

Fabric (fabric.so) is a hosted "AI workspace" sold as "your second brain": "a home for your files, photos, videos, notes and meetings, with an AI that knows all of it." It puts several products in one account: a cloud drive that mounts on the desktop, notes and docs, bookmarks, an infinite canvas, tasks and Kanban, a meeting recorder, semantic search, a chat assistant, scheduled agents, publishing, and an MCP server. It targets "prosumers" and small teams; the nav lists students, researchers, founders, agencies, law firms and "ADHD".

Company: founded 2022 by Jonathan Bree with two co-founders, $1M pre-seed led by Seedcamp, launched publicly November 2023 ([TechCrunch](https://techcrunch.com/2023/11/07/fabric-introduces-an-ai-powered-workspace-and-home-for-all-your-information/)). The terms name WFHLAND, Inc.; `llms.txt` names "Interlace, Inc., founded in 2025, solo founder Jonathan Bree". The App Store listing has 250 ratings at 4.6; the iOS app is still at version 0.8.x.

**The recent turn.** On 2026-10-11 Bree published "The data layer for AI that persists" on exabase.io; Fabric's old developer-platform blog URL now 308-redirects there. Exabase describes itself as "the infrastructure layer behind Fabric": a Memory API ("Store facts, preferences, events"), resources with "full CRUD, semantic search, folders, tags", a CLI and MCP. Its memory is "self-organizing" and "resolves contradictions as new information arrives". `llms.txt` positions Fabric itself as "memory for AI and storage for apps". The company is moving from a consumer workspace toward selling memory to other people's agents.

## Organization model

Items (files, notes, links, emails, recordings, tasks, memories) live in folders and spaces and can carry tags. The pitch is that none of that structure is needed: "No tagging. No manual organization." and "All automatically extracted and enriched by Fabric's intelligence." No page explains the mechanism. The home page names a "Memory Engine", "a living, addressable network that interconnects concepts", that "maps the deep relationships between everything you save". The only user-visible form found is "explore similar content" in search. A competitor's review reports the "smart collections" as unreliable. Treat automatic organization as marketing until someone tests it.

"Memories" are a separate object type: discrete facts that the assistant and MCP clients create, edit, list and search. They are undefined in the docs but match Exabase's Memory API.

## Capture

| Path | What Fabric documents |
|---|---|
| Web clipper | Chrome extension, ~10K users; sticky notes on web pages. A June 2026 reviewer: no merging snippets, formatting lost |
| Mobile | iOS and Android apps with a share sheet (App Store notes from 2025 mention share-sheet fixes); since 2026-10-08, 1-way sync of chosen photos and files, previously screenshots only |
| Email | One generated address per account. "Only accepts emails from your verified Fabric account email address" by default, other senders can be allowed. Plain text becomes a note, forwards stay emails, attachments become files; ~25MB |
| Upload and drive | Desktop drive for macOS, Windows, Linux that "streams" files on demand, 2-way; 50MB per file on Plus |
| Voice and meetings | No bot; detects a meeting starting and offers to record; records offline, transcribes after reconnect; seven languages |
| Images | Handwriting scanner (iOS 0.8.13, September 2026); screenshot text searchable |
| Imports | Evernote, Notion, Raindrop, browser bookmarks; Zapier; Raycast; Slack and Discord bots |

## Connections: two different things under one list

The [connections page](https://fabric.so/marketplace/connections) lists 19 entries. Its labels show two kinds, which the marketing does not separate:

- **Synced and indexed** ("1-way" or "2-way sync", "AI search"): desktop drive, Google Drive deep sync, iOS and Android device sync, GitHub stars. Content is copied into Fabric and searched.
- **Live tools for the assistant** ("Assistant, Basic search"): Google Drive, Dropbox, Google Sheets, Notion, Trello, Discord, Clay, Stripe, GitHub, custom MCP. The descriptions are verbs ("create, move, and update cards"; "create invoices and payment links"). Nothing is indexed; the assistant calls the app.

Gmail and calendars are absent from the list, although the home page shows the assistant leaving "the client reply … in Gmail drafts".

Google Drive appears twice, once in each kind, and the two detail pages explain the split (fetched 2026-10-17):

- **Google Drive (Deep sync)**, [page](https://fabric.so/marketplace/connections/google-drive-deep-sync/x52cHqan): "reads the full contents of every Drive file", including scanned PDFs and images, for search by meaning. Two-way: edits made in Fabric "sync back to Drive". "Your files stay in Google Drive"; Fabric keeps them "synced and searchable rather than relocating them". Capped at 5,000 files ("Files beyond that limit are not synced"), so the page advises connecting "the accounts or folders that matter most for search". Pro and Team only. Delete propagation is not described.
- **Google Drive**, [page](https://fabric.so/marketplace/connections/google-drive/LZk0fHn6): "hands that work to Fabric's assistant": find, create, upload, copy, move, rename, export, share, change permissions, delete, plus a beta raw "API Request" tool. It adds keyword search over Drive to Fabric's search. The assistant "acts only when you ask it to" and "confirms with you before it goes ahead" on delete, replace or removing access. For recurring work, a scheduled job, but "destructive one-off actions still require your approval". "The two do different jobs and can be used together."
- **Notion**, [page](https://fabric.so/marketplace/connections/notion/Kzy7f46n), is the live kind only: find and query pages and databases, create, update, archive. "Finding, reading, and querying never change anything." The assistant confirms changes "unless you've told it not to for a particular task". A scheduled job can respond to Notion events "while you keep approval over anything that modifies your workspace". How its keyword search gets data (live query or a shallow index) is not stated.
- **iOS device sync**, [page](https://fabric.so/marketplace/connections/ios-device-sync/EPILUm2R): 1-way, read-only copies; "sync your whole camera roll and files and let them flow in automatically, or choose the ones worth keeping"; Fabric reads text in images and recognizes what photos show; it "never alters or removes anything on your device". Pro and above. Until iOS 0.8.14 (2026-10-08) it synced screenshots only.

Fabric published no design writing on this split that the survey found; the reasoning above is read from the page structure. The pattern: per service, **knowing** (content copied, indexed, searchable by meaning, metered by a file cap and a plan tier) and **doing** (a verb list the assistant calls live, confirm-before-destructive by default, a per-task opt-out for scheduled jobs) are separate connections with separate permission stories, and the person can enable either or both.

## AI

- **Search.** "Based on meaning"; text inside PDFs and notes with jump-between-hits; reverse image search and "similar images"; a color picker that finds images and documents containing a color; transcript search across audio, video and YouTube that jumps to the moment. "Smart indexing that happens on our servers."
- **Assistant.** Chat over a chosen file, folder or selection, with citations ("one click to verify"). Model picker over Gemini, OpenAI, Claude, DeepSeek, xAI, Z.ai, Kimi, MiniMax, Qwen and open models in one subscription; web search on Pro.
- **Agents.** "Personal AIs that work while you sleep", each with a name, personality and schedule (daily, weekly, monthly, custom). "Every AI gets their own email inbox … Send an email to your AI's email address, and your AI will answer." Scope is chosen files, folders or sources; an agent can be read-only; "require confirmation before certain actions" such as deleting or moving. Examples on the page: tidy notes, compile a Monday brief, research the web, check Reddit for mentions daily. Pro and Team only.
- **Recap.** An emailed summary of "everything you've saved, created or captured".
- **MCP.** `https://mcp.api.fabric.so/mcp`, OAuth discovered through `.well-known/oauth-authorization-server`, no API keys, all plans. Nineteen tools, including create, edit, move, rename and delete items; no documented scopes. Some calls spend AI credits.

## Privacy, data and price

Everything is cloud: indexing and inference run on Fabric's servers and its model vendors. TLS in transit, AES-256 at rest, no end-to-end encryption. The privacy page lists one AI subprocessor, OpenAI ("GPT4 … to expand responses from our internal search system"), with Cloudflare, AWS, Bunny, Liveblocks, Mixpanel, Customer.io, Google and Meta (ads). It does not list the other model vendors that the assistant page offers. The terms (§3.5.1) let Fabric use "anonymized and aggregated data … including from the content of non-opted-out Customer Materials" to develop its services "in collaboration with third-party partners"; enterprise plans are opted out by default, everyone else opts out in settings. §3.6 gives Fabric sole ownership of what it derives. §7.2: "we make no guarantees around data retention or preservation." Export is a whole-account ZIP; the format inside is not documented. No compliance standard is named.

Pricing (fabric.so, yearly): Free; Plus $8/month, 50GB; Pro $18/month, 250GB, background agents and "premium connections"; Max $54/month, 1TB; Teams unpriced. AI use is metered as "5x/15x/45x" with no stated unit, plus top-ups. App Store and third-party prices disagree with each other and with the site; no refunds.

## Reception, non-obvious signal

- The extension and the quick-capture hotkey get the most consistent praise; the AI answers and the "smart" organization get the complaints (wrong answers, features breaking after months, smart collections unreliable).
- "The app is stuck ten years back": the feature list grows faster than the interface. Support is a Discord where the founder answers.
- AI credits run out; the meter has no unit a buyer can reason about.
- Weaker than Notion for structured data and manual control (affiliate review).

## Bee Box, for contrast

- **Organization is explicit and inspectable.** Cards in directories with git history; landmarks mark places; the intake, triage, handle pipeline routes inbox items by rules written on landmark cards, each stage visible in the filesystem (`beebox/docs/triage.md`). Fabric's "no organization required" is the implicit end of the axis the boxholder named in [explicit but rich](../issues/exploration/2026-09-11-explicit-but-rich.md).
- **One agent per box, with the whole box.** The agent is Claude Code or Codex with a shell, procedures and schedules (`beebox/docs/chat/schedules.md`). Fabric has several named agents, each scoped to folders.
- **Capture.** Clerk Chrome extension with a frozen HTML snapshot (`beebox-clerk/src/platform/extract-readable.ts`), iOS app with share sheet and transcription, chat attachments, Telegram, Gmail and Drive connectors, scans through Docling with OCR. The open gaps are the entry points ([quick drop](../issues/features/2026-09-25-quick-drop-entry-points.md)), an inert share-sheet stub ([bug](../issues/bugs/2026-09-21-share-sheet-webpage-stub-never-completed.md)), a shared image or link with no words that is saved and never read ([bug](../issues/bugs/2026-10-17-captures-without-words-are-never-processed.md)), and email without OAuth ([Gmail forwarding](../issues/features/2026-10-08-gmail-forwarding-as-the-read-path.md), [box mailbox](../issues/features/2026-09-25-cloudflare-email-inbox-connector.md)).
- **Connectors cover more than copying.** Gmail, Calendar and Drive copy content into cards and commit it (`beebox/docs/connectors.md`). Writing back exists: Calendar and Drive sync two-way, and Gmail uploads drafts. Gmail also has a live read mode: `bbx connector gmail gws --` searches and reads untracked mail through the Google Workspace CLI, get and list only, with nothing kept in the box (`beebox/docs/connectors/gmail.md`, "Search and read untracked Gmail"). Drive has pointer cards: `bbx drive link` makes a `glink` card that records an item and its purpose without copying it (`beebox/docs/connectors/drive.md`). So Bee Box has copy, write-back, pointer and live-read modes. What it does not have is Fabric's live action list on an outside app (create, move, share, delete) behind a confirm-by-default rule.
- **Search.** Orama BM25 over cards split by heading; embeddings only over each card's one-line `contains` (`beebox/src/core/search/refresh/embed-pass.ts`); a search card (`beebox/src/schemas/search.ts`). No image or transcript-moment search.
- **Data and cost.** Plain files on the person's host, git, `bbx`; the person's own model subscription and keys (`beebox/docs/model-policy.md`). Nothing to export because nothing is held elsewhere.

## Dispositions

| Idea from Fabric | Disposition | Trace |
|---|---|---|
| Email-in accepts only the account's verified address by default; other senders are allowed one by one | **Adopt** as the default for any box mailbox. It matches the capture rule that material is evidence and only the person's own words may request work | [box mailbox](../issues/features/2026-09-25-cloudflare-email-inbox-connector.md), [Gmail forwarding](../issues/features/2026-10-08-gmail-forwarding-as-the-read-path.md); [iOS capture research](ios-quick-capture-2026-10-12.md) |
| Email the agent and it answers: the mailbox is also a request channel | **Reject.** The boxholder (2026-10-17): the mailbox is intake, with sending asymmetric or absent | [box mailbox](../issues/features/2026-09-25-cloudflare-email-inbox-connector.md) |
| Name the two kinds of connector: content copied into the box and indexed, against a live tool the agent calls | **Discuss** (boxholder interested, 2026-10-17). At minimum, vocabulary in connector docs and the future plugin manifest. Bee Box has copy, write-back, pointer and live-read modes already (see "Bee Box, for contrast"), but no connector declares which it offers. Fabric's permission rule (reads free, changes confirmed by default, per-task waiver for schedules) is a template if live actions are ever added | [connectors as plugins](../issues/features/2026-10-15-connectors-as-plugins.md); `beebox/docs/connectors.md` |
| A weekly recap of what came into the box | **Later**, as an instance of the today-view procedure, not a feature | [today view](../issues/features/2026-05-11-today-view.md) |
| Record offline, transcribe on reconnect | **Confirms** an open bug: the local recording should not depend on the live channel | [live transcription failure](../issues/bugs/2026-09-10-live-transcription-failure-loses-the-hq-pass.md) |
| MCP server with OAuth discovery, so a client needs only a URL | **Later.** Reference for the box MCP server's connect step. Fabric's unscoped write and delete tools are the part not to copy | [box as MCP server](../issues/features/2026-09-17-box-as-mcp-server-hands-out-tasks.md); [Life OS client hardening](lifeos-review.md#the-mcp-server) |
| Transcript search that jumps to the moment; image similarity and color search | **Later.** Transcript moments are cheap once audio has timed transcripts; image and color search have no household use found yet | [YouTube and audio as sources](../issues/features/2026-10-09-youtube-and-audio-files-as-sources.md); candidate issue below |
| Automatic 1-way sync of phone screenshots and photos | **Discuss.** Fast, but every screenshot enters the box and goes to a vision vendor. A middle path: sync one chosen album, so adding a photo to it is the deliberate act. First, a word-less capture must be read at all | [quick drop](../issues/features/2026-09-25-quick-drop-entry-points.md); [word-less captures ignored](../issues/bugs/2026-10-17-captures-without-words-are-never-processed.md) |
| Per-agent read-only mode and confirm-before-delete/move | **Reject** the confirmation gate: git makes a move or delete reversible, and an unattended schedule cannot answer a prompt. A read-only schedule is already a procedure that writes nothing | [unattended schedules and prompts](../issues/code-quality/2026-09-02-unattended-schedules-permission-prompts-none.md); [grant requests](../issues/features/2026-10-08-agent-files-a-grant-request.md) |
| Several named agents with personalities per account | **Reject.** One box, one agent, one personality is deliberate; scoping is by landmark and procedure | `beebox/docs/architecture/01-what-is-this.md` |
| "No organization required"; self-organizing memory that "resolves contradictions" | **Reject.** Bee Box records a superseded claim with both sources instead of resolving it silently; triage rules are written on landmarks where the person can read them | [contradicted and superseded claims](../issues/features/2026-10-06-cards-record-contradicted-and-superseded-claims.md); `beebox/docs/triage.md` |
| Streaming desktop drive, canvas, Kanban, client portals with link analytics | **Reject.** The box is already files on the host; publishing is static by design | `beebox/docs/box/publishing.md` |
| One subscription over many model vendors, metered in unitless credits | **Reject.** The person's own keys and subscription are the cost model | `beebox/docs/model-policy.md` |
| Subprocessor list that names one vendor while the product offers ten; training on content unless the person opts out | **Adopt as upkeep.** Bee Box already discloses (the `llms.txt` preamble, `beebox/docs/development/technologies.md`, page 10); the list has drifted from the code in four places and nothing checks it | [provider list drift](../issues/docs-and-chores/2026-10-17-public-provider-list-drifts-from-code.md); [Rowboat review, tier 3](rowboat-review.md) |

## Filed

- [Captures without words are never processed](../issues/bugs/2026-10-17-captures-without-words-are-never-processed.md), with a settle window for items that trickle in.
- [Public provider list drifts from code](../issues/docs-and-chores/2026-10-17-public-provider-list-drifts-from-code.md).

## Candidate issues (not filed)

1. **Box mailbox: sender allowlist.** Default to the boxholder's addresses only; all mail is material. Better as a section appended to the [box mailbox issue](../issues/features/2026-09-25-cloudflare-email-inbox-connector.md) than a new issue.
2. **Each connector declares its modes (copy, write-back, pointer, live read, live action).** Could ride on the plugin manifest work.
3. **Timed transcripts on audio cards and search hits that open at the moment.** Fold into the YouTube and audio sources issue.

## Hands-on testing

Whether automatic organization, recaps and the "Memory Engine" do anything visible would need a free account, an email address and acceptance of the terms. Not done; ask before doing it. The public pages do not settle it.
