# AI writing products and their UI: tools that help with the person's own writing

Survey, 2026-10-27. Focus: shipped products and research prototypes where AI helps a person write their own text, and the interface details that decide who writes. It extends [authentic AI-assisted writing](authentic-ai-writing.md), which covers process, provenance formats, and the HCI evidence. This document covers products and interaction design. It does not repeat that evidence.

Labels: **[observed]** means we read the product page, docs, paper, or repository. Some pages were read through a fetch tool that summarizes, and quotes from those are close but may not be exact. **[reported]** means a third party (review, forum, press) said it. **[opinion]** is our reading.

The test applied throughout is the governing rule in [writing practice](../../issues/features/2026-07-05-writing-skill.md): **"Opinionated in conversation and conservative in the artifact."** The survey reports designs that contradict the rule, and says where.

Deep-dive on one product: [Proof (Every)](proof-every.md).

---

## 1. Summary

- **Every's product is Proof** (proofeditor.ai, launched 2026-03-11). It is the same "ProofEditor" that the [questions-as-annotations issue](../../issues/exploration/2026-08-01-questions-as-inline-annotations.md) used as its model. Its draft provenance spec separates *origin* (whose idea), *basis* (why the AI wrote it), *review* (who checked it), and *typed_by* (who typed it). That last field is a name for "the agent typed the person's words". Proof is built for people who read AI-written documents, which is the reverse of the boxholder's case. See [proof-every.md](proof-every.md).
- **Few shipped products make "conservative in the artifact" the default.** Granola (your text black, AI text grey), iA Writer Authorship (AI text colored until you rewrite it), and Sudowrite Feedback (margin notes; text changes only on accept) come closest. Most products put AI text into the document with no lasting mark.
- **The feedback-only design is well studied in prototypes and rare in products.** Textfocals, AnchoredAI, and Writor never write into the document. Marlowe (Authors.ai) is the only commercial product found that refuses to write in every feature.
- **Voice tools mostly rewrite by default.** The conservative designs are Letterly (the transcript stays as version zero), Cleft ("Clean Transcript" style), and Granola's per-line source link. The most useful reception signal in the voice cluster is a heavy Wispr Flow user who asked for "a slider from literal transcription to AI enhancement".
- **Visible and editable AI text does not by itself keep the person's position.** Reactive Writers (CHI 2026) found that writers accept suggestions that agree with their stance, keep the AI's framing, and still feel in control.

---

## 2. Deep dives

### 2.1 Proof (Every)

Full write-up: [proof-every.md](proof-every.md). In brief:

- **Flow.** A shared Markdown editor. Agents connect over HTTP, a skill file, or a CLI. They comment, suggest, and edit. The person accepts, rejects, or replies [observed: [proofeditor.ai](https://proofeditor.ai), [SDK](https://github.com/EveryInc/proof-sdk)].
- **UI.** A left-margin rail colored by author: green for human, purple for AI. Comment threads with Reply and Resolve. An agent presence label ("Reviewing", "thinking") [observed: [launch post](https://every.to/on-every/introducing-proof)].
- **Provenance.** Origin, basis, and review are separate fields. Only a human can set `approved` or `flagged`, and an approval goes stale when the text's hash changes. `typed_by` records a scribe [observed: [spec](https://github.com/EveryInc/proof-sdk/blob/main/docs/PROVENANCE-SPEC-v2.md)].
- **Contradiction.** Agents may also edit directly or create pre-accepted suggestions. The founder says provenance "was less important than I thought" [reported: [podcast](https://every.to/podcast/transcript-how-we-use-proof-a-collaborative-editor-for-humans-and-ai)].

### 2.2 iA Writer Authorship

**Flow** [observed: [support](https://ia.net/writer/support/editor/authorship), [how-to](https://ia.net/writer/how-to/track-authors-and-ai)]:

1. The person writes in iA Writer. iA ships no built-in writing model.
2. To bring in AI text, they use **Paste As** and pick an author, or select text and use **Mark As**.
3. To bring in an AI's edits to their own draft, they copy the AI's version, select their original, and use **Paste Edits From**. iA diffs the two and attributes only the changed words to the chosen author.
4. Copying between documents offers **Paste With Annotations** (keep authorship) or plain Paste (drop it).

**UI** [observed: [See What AI Wrote](https://ia.net/topics/see-what-ai-wrote)]:

- The person's own text is in normal color. AI text first showed in dim grey. iA called that "too subtle to notice" and moved AI text to a colorful gradient. Other human authors each get a color. A "Reference" author dims boilerplate.
- Authorship is a view mode beside Syntax Highlight in the Focus menu (Shift-Cmd-A). The suggested use is Syntax Highlight while writing and Authorship while reviewing.
- **Edit Authorship** shows a character count per author.
- **How AI text becomes yours:** a hands-on review found that the mark clears word by word as the person retypes words. AI words left unchanged stay marked [reported: [Cassinelli](https://matthewcassinelli.com/ia-writer-ai-authorship-markdown-annotations)].
- Storage: a "Markdown Annotations" block at the end of the plain-text file, with a published spec. Export to HTML, PDF, or Word drops it [observed].

**Stance** [observed: [iA Writer 7](https://ia.net/topics/ia-writer-7)]: AI as "dialog partner", "Don't let the machine speak for you", and use AI to point out flaws. The UI backs the claim partly. Every AI word enters through a deliberate paste. Marking depends on the person's honesty: unmarked pasted text counts as theirs [opinion].

**Reception** [reported]: one user liked the look but found it added steps, and "didn't at first understand what it was for" ([cartography](https://cartography.pika.page/posts/dont-lose-yourself-to-the-goblin-using-ia-writers-authorship-to-manage-your-ai-edits)). Auto-detection of pasted ChatGPT transcripts did not work for one reviewer. HN launch threads had no discussion.

### 2.3 Granola (notes built from your jottings)

**Flow** [observed: [launch](https://www.granola.ai/blog/announcement), [help](https://docs.granola.ai/help-center/taking-notes/ai-enhanced-notes)]:

1. During a call the person types rough notes. Granola transcribes in the background.
2. After the call it "enhances" the notes from the jottings, transcript, and calendar entry. A jotted "10K" becomes "Photography budget can go up to 10K" [reported: [TechCrunch](https://techcrunch.com/2024/05/22/granola-debuts-an-ai-notepad-for-meetings)].
3. Templates set the output shape. A regenerate button reruns a template.

**UI:**

- **Color by author.** "Everything from you is in black, everything else is in gray" [observed: launch post]. The current help page mentions only the black. A search summary says editing a grey line turns it black; we could not confirm that [unverified].
- **Source tracing.** A magnifying glass beside each AI line shows "where in the transcript or raw notes the note came from". The launch post calls it "Zoom In": it shows the quotes a note rests on [observed].
- A toggle returns to the raw notes. Chat opens with Cmd-J and can request changes to the notes [observed].

**Stance.** "Granola starts with what you've written, cleans it up and fleshes it out" [observed]. It does not claim the output is in your voice. The color split backs its claim of control. The enhanced note is still mostly AI prose [opinion]. A daily user says what he sends is "informed by the record, not pulled from it verbatim" [reported: [Proser](https://zackproser.com/granola)].

**Reception** [reported]: complaints are about capture (overlapping speakers collapse) and trust (org-visible folders by default). Regenerating can lose direct edits to the enhanced notes. We found no complaint that the color split fails.

**Why it matters** [opinion]: it is the clearest shipped case of "the person's words first, AI additions visibly lesser, each addition traceable to a quote".

### 2.4 Sudowrite Feedback (May 2026)

Sudowrite is mainly a fiction generator. Its Feedback feature is the closest commercial match to a margin editor that does not write unasked.

**Flow** [observed: [docs](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/feedback/7Ew1KgpEwabQSgvijq8QNr), [changelog](https://feedback.sudowrite.com/changelog/your-personal-writing-partner-has-arrived)]:

1. Open a scene, chapter, or the whole book.
2. Pick feedback types (pacing, structure, plot holes, dialogue, developmental edit), or define a custom type.
3. Click Feedback. Comments appear in a collapsible Comments bar in the margin.
4. Each comment holds an observation plus "a rewrite, a question to consider, or a craft note".
5. Accept or ignore each one. Resolved and ignored comments go behind an "Open" dropdown.

**UI:**

- "Feedback doesn't change your text on its own. When a comment includes a proposed edit, accepting it applies that edit." Proposed revisions show the original struck through and the new text in another color [observed].
- Reply "@Sudowrite" on a comment to continue in Chat.
- "Beta Read" offers three named reader personas: Maya (emotional impact), Anton (structure and pacing), Joan (plausibility).
- **Chat has a permission switch:** "Chat only" or "Allow edits". In Allow edits mode a multi-step change arrives as a plan to approve first [observed].
- We found no description of how Sudowrite marks AI prose from its Write and Rewrite tools after acceptance.

**Contradiction.** The same product generates whole chapters. Restraint is a mode the person picks, not a product stance.

**Reception** [reported]: the feature is five months old and has no independent review. A leaving subscriber praised "braindump to prose" and disliked inconsistent instructions ([board](https://feedback.sudowrite.com/p/sorry-to-say-im-leaving-and-heres-why)).

### 2.5 Textfocals, AnchoredAI, and Writor (feedback-only prototypes)

Three research systems where the model never edits the document.

**Textfocals** [observed: [arXiv 2403.01055](https://arxiv.org/abs/2403.01055)]:

- A Microsoft Word task pane. Principle: "the user originates the content".
- Buttons with editable prompts produce cards: Thesis Statement, Important Concepts, "Questions the Writer Was Attempting to Answer", "Questions a Reader Might Have", and Advice. Hovering a card highlights its paragraph.
- Formative study, N=4. Reader questions showed how readers could misread. Advice was too abstract, and one participant copied text into a chatbot to get examples. Yellow highlights were misread as error flags.

**AnchoredAI** [observed: [arXiv 2509.16128](https://arxiv.org/abs/2509.16128)]:

- A Word add-in. AI comments sit in the right margin, joined to their spans by connector lines, and stay attached as the text changes.
- Within-subjects, N=22, against a chat sidebar. On the local revision task, words pasted per paste fell from 199 to 35, and the share of the document changed fell from 22.5% to 6.8%. "I am the main contributor" rose from 2.3 to 4.0 (Likert).
- **The cost is effort.** NASA-TLX mental demand rose from 51.8 to 80.7. One participant on chat: "I kind of just copy-pasted the whole revised essay."

**Writor** [observed: [arXiv 2602.04047](https://arxiv.org/html/2602.04047v1)]:

- The writer states task, audience, and areas to improve. The system proposes five revision goals, and the writer edits them.
- The draft shows colored highlights linked to sidebar cards: up to five critiques and three praise cards. Each critique ends with an open question and has a follow-up chat and a **Find Example** button. That button looks for an example in the writer's own text first.
- A progress bar tracks addressed items.
- **Leakage:** the cards stayed non-directive, but copyable sentences appeared in 5 of 94 chat turns. Experts (n=30) rated specificity lowest (2.77/5).

**Relevance** [opinion]: these three are the evidence base for the margin-editor pattern. Writor shows where the rule leaks (the chat) and what it costs (vague advice). AnchoredAI measures the trade: more ownership, more effort.

### 2.6 Rambler (voice to text by gist)

[observed: [CHI 2024 paper](https://arxiv.org/abs/2401.10838), [diary study](https://arxiv.org/abs/2502.05612), [code](https://github.com/BerkeleyHCI/rambler)]

**Flow:**

1. Press "+ Ramble" and talk. Each Ramble is a separate block for one train of thought.
2. Raw speech-to-text shows live. When the person stops, an LLM replaces it with a cleaned transcript.
3. Keywords are highlighted automatically (RAKE, not an LLM). The person taps words to add or remove keywords, then regenerates summaries that use their keywords.
4. A **Semantic Zoom** slider shows every Ramble at full length or as a 50%, 25%, or 10% summary.
5. Restructure by whole Rambles: drag to reorder, drag onto another to merge, Return to split. LLM versions: Semantic Merge, Semantic Split (scissors icon), and Magic Custom Prompt (wand icon, with an "include keywords as context" option).
6. **Re-speaking** reopens the mic on a Ramble. The old text stays above in grey. New speech gets append, replace, and discard buttons.

**Findings.** Lab study, N=12, against dictation plus ChatGPT: 10 of 12 preferred Rambler, and 10 of 12 said it gave more control. Keyword highlighting and Semantic Zoom were used most. Participants distrusted the LLM merge and split and fell back to manual splitting. Diary study, N=12: two strategies appeared, "outline first" (dictate key points, expand each by prompt) and "free-speaking" (one long ramble, then split). Participants asked to keep the original audio linked to the transcript.

**Contradiction.** The automatic transcript cleanup is an unrequested, unmarked rewrite. Participants did not object. AI-expanded paragraphs are not marked.

**Relevance** [opinion]: the best existing UI for *arranging spoken material by gist*. It has no critic and no provenance.

### 2.7 Patchwork and Upwelling (Ink & Switch)

**Upwelling** [observed: [essay](https://www.inkandswitch.com/upwelling/)]: a document is a stack of layers. Unmerged layers are named, private-by-default drafts. "Show Changes" highlights insertions with a light background and shows deletions as a hover icon, which avoids strikethrough clutter. Each author has a color. Merged layers are read-only. No AI.

**Patchwork bots** [observed: [notebook](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/07/), [Litt](https://buttondown.com/geoffreylitt/archive/towards-universal-version-control-with-patchwork)]:

- A bot is a collaborator. It edits on a branch, and the person can "partially or completely merge—just like you would suggestions from a human coauthor".
- The bot shows as an author in history, so accepted bot edits stay attributable.
- Bots are plain-text prompts stored as documents, so they can be edited and versioned.
- Uses included style-guide passes and voice-transcript cleanup. A variant where the bot comments on each edit with its reason "helped users decide whether to accept a change".
- Litt: "AI tools need a way to stage tentative changes for others to review", but this workflow is "too heavy in many other cases".

**Relevance** [opinion]: the strongest model of "the document changes only when the person merges". Provenance comes from history rather than marks in the text.

### 2.8 HaLLMark and DraftMarks (provenance displays)

**HaLLMark** [observed: [arXiv 2311.13057](https://arxiv.org/abs/2311.13057)]:

- Three panes: editor, GPT-4 prompt pane, provenance view.
- Each prompt becomes a card, classified as Generate (purple border) or Edit (blue border).
- Text pasted from a card is highlighted orange (AI-written) and linked to its prompt. **Editing it removes the highlight** from the edited part. The writer can mark any text "AI-influenced" (green) by hand.
- A timeline of prompt tiles and a pie chart of AI-written, AI-influenced, and writer-written shares.
- Study, 13 published writers: AI-written text in final stories fell from 13.7% to 3.5%, and ownership rose from 3.4 to 4.9 (7-point). Some writers felt over-conscious of readers' judgment.
- Stance: a tool "for writers to measure their own compliance", and the writer may edit the record.

**DraftMarks** (CHI 2026) [observed: [arXiv 2509.23505](https://arxiv.org/abs/2509.23505)]: a *reader*-facing view. Physical metaphors mark process: masking tape over AI passages, smudges for AI tone edits, eraser crumbs for prompts, glue residue where AI text was removed, script font for human text and sans-serif for AI. With 70 readers, comprehension of the writing process was 4.29 vs 2.86 (of 7) against a highlight-plus-chat-log baseline.

**Relevance** [opinion]: these show three different rules for when AI text becomes the person's: on any edit (HaLLMark), word by word (iA Writer), and never fully (DraftMarks keeps residue). The rule is a design choice that no product states openly.

### 2.9 Voice tools that keep the verbatim: Letterly, Cleft, AudioPen

**Letterly** [observed: [app guide](https://letterly.app/blog/your-guide-to-the-letterly-mobile-app/)]: "Each note starts with a transcript of your recording. Tapping Rewrite applies a rewrite option to produce a new version." The person swipes left and right between the original transcript and each rewrite. Rewrites can apply to the original or to an earlier rewrite. Each version can be deleted on its own. Styles include custom ones written as an instruction.

**Cleft** [observed: [cleftnotes.com](https://www.cleftnotes.com)]: on-device transcription. Three built-in styles: Structured (bullets), Structured Prose, and Clean Transcript, described by a reviewer as "your words tidied up but intact" [reported: [MakerStack](https://makerstack.co/reviews/cleft-review/)]. The raw transcript and audio stay available [reported: [Sweet Setup](https://thesweetsetup.com/cleft-notes-is-the-thinking-companion-i-didnt-know-i-needed/)].

**AudioPen** [observed: [voice-to-text page](https://audiopen.ai/voice-to-text-app)]: rewrite by default. The rewrite level has three steps. Low: "Lightly cleaned up, removes filler words and grammatical errors." High: full rewrite "in your style". SuperSummary combines several notes into one [observed: [ahoi.dev](https://ahoi.dev/audiopen-supersummary-styles/)]. Marketing: "everything I write sounds like me, but better" (a testimonial). No sentence-level link from rewrite to transcript.

**Contrast: Wispr Flow and Monologue** rewrite speech in place inside other apps, with no intermediate artifact. Monologue does not keep dictation transcripts on its servers [observed: [monologue.to](https://www.monologue.to)]. A Wispr Flow user with 70,000 dictated words a month says it "often swaps in its own word choices" and asks for "a slider from literal transcription to AI enhancement"; the founder replied they are working on something similar [reported: [Product Hunt](https://www.producthunt.com/p/wisprflow/personalized-styles-make-wispr-flow-sound-more-like-you)].

**Reception across the cluster** [reported]: an AudioPen user dictates for ten minutes, gets five or six paragraphs, and then writes the draft himself: "AI is a great writing partner. It's a horrible writer" (arvidkahl, HN, 2023-08-21). Reviewers of every tool still do a final edit by hand.

### 2.10 Grammarly Authorship (process replay)

[observed: [support](https://support.grammarly.com/hc/en-us/articles/29548735595405)]

- Records typing, pasting (with the source app if allowed), and Grammarly AI use, in Google Docs, Word, and Grammarly's editor. A thumbprint icon shows when it is on.
- Produces analytics, a color-coded report of the full text, and a replay. Recipients see the same report. Data is kept up to ten years.
- Categories changed over time. December 2025: three groups, with "AI-Generated or Rephrased with AI" as one subcategory [reported: [Plagiarism Today](https://www.plagiarismtoday.com/2025/12/11/grammarly-updates-authorship-improves-labeling/)].

**Critic findings** [reported]: output of Grammarly's own "Humanize" feature showed "75% Typed by a Human" in the header while the fine print said 0% typed ([Plagiarism Today](https://www.plagiarismtoday.com/2025/11/06/how-grammarly-launders-ai-generated-content/)). **Voice-typed text was marked as copied from another source** ([Mills](https://annamills.substack.com/p/trying-out-grammarly-authorship-beta)). Retyped AI text counts as human.

**Contradiction** [opinion]: the audience is a teacher, not the writer. Provenance is inferred from behavior for a third party. The voice-typing misfire shows that behavior-based capture fails exactly in the boxholder's workflow.

---

## 3. Catalog of other products and prototypes

Brief entries. "Writes into doc?" means the AI can put text into the document. "Marks AI text?" means that text stays visibly distinct after acceptance.

### Shipped products

| Product | What the AI does | Writes into doc? | Marks AI text? | Notes |
|---|---|---|---|---|
| Spiral (Every) | Interviews you, then writes three drafts side by side in your learned voice | Yes | No | Style cloning; out of scope. 87% of drafts passed a blind lineup by Every's own eval [observed: [v4](https://every.to/on-every/spiral-4-0-goes-agent-native)] |
| Lex | Feedback as comments; rewrite returned as a comment; "Run checks" for clichés | Yes, on request | No | No longer accepting new customers [observed: [lex.page](https://lex.page/pricing)]. A reviewer found its critique more candid than chatbots [reported] |
| Roughdraft (Lex-Inc) | Agent writes Markdown; person reviews with CriticMarkup comments and suggestions; "Done Reviewing" hands the turn back | Agent writes the doc | `by=` on each comment and suggestion | [observed: [repo](https://github.com/Lex-Inc/roughdraft)]. Direction is reversed from the boxholder's case |
| Google Docs + Gemini | Help me write, Refine chips | Yes, as suggestions "only visible to you until you approve them" | No, after acceptance | [observed: [Workspace blog](https://workspaceupdates.googleblog.com/2026/04/new-gemini-capabilities-in-google-docs-help-you-go-from-blank-page-to-brilliance.html)] |
| Word Copilot | Agent in side pane; edits as tracked changes; manages comments | Yes, tracked | Author "Copilot" until accepted | [reported] |
| Notion agents | "Propose changes instead of making them directly"; approve top to bottom | Yes | Only while proposed | Opt-in per request [observed: [3.8 notes](https://www.notion.com/releases/2026-08-28)] |
| ChatGPT Canvas | "Suggest edits" puts comment bubbles on text; other shortcuts rewrite all | Yes | No | Comment-only and rewrite-all in one pane [reported; OpenAI pages blocked] |
| Grammarly Reader Reactions | Predicts how a chosen reader takes the draft; side panel | No, unless accepted | n/a | [observed: [page](https://www.grammarly.com/ai-agents/reader-reactions)] |
| Grammarly Expert Review | Comments framed as from real named experts | No | n/a | Generated comments tied to real people without consent [reported: [eWeek](https://www.eweek.com/news/grammarly-ai-expert-review-backlash/)]. A provenance failure on the AI's side |
| Marlowe (Authors.ai) | Whole-manuscript report: pacing, structure, revision priorities | No | n/a | "Reads and critiques, never writes or rewrites" [observed: [site](https://beta.authors.ai/)]. Report sits outside the manuscript |
| ProWritingAid | Reports and critiques; Rephrase and Sparks generate | On accept | No | "Nothing changes in your text unless you accept a suggestion" [observed: [help](https://help.prowritingaid.com/article/297-does-prowritingaid-use-ai)] |
| Hemingway Editor | Free: colored highlights for hard sentences, passive voice, adverbs. Plus: rewrite popup with cycle-through options | Plus: yes | No | The free tier is the classic inline-marks critic [observed: [Plus](https://hemingwayapp.com/hemingway-editor-plus)] |
| Wordtune | Select a sentence, pick one of several rewrites | Yes | No | Reviews say options can shift meaning [reported] |
| Type.ai | AI commands show inline suggested edits; accept or reject each or all | Yes | No | [reported: [changelog](https://blog.type.ai/post/introducing-a-faster-way-to-edit-with-ai)] |
| NovelCrafter | Expand, Rephrase, Shorten on selection; prose from beats | Yes | Not documented | AI described as optional [observed: [help](https://novelcrafter.com/help/docs/write/text-replacement-prompts)] |
| Jenni AI | Tab-to-accept ghost-text autocomplete for academic writing | Yes | No | [reported] |
| Scrivener | None built in; macOS system Writing Tools appear anyway | n/a | n/a | "Scrivener itself contains no artificial intelligence" [observed: [L&L](https://www.literatureandlatte.com/blog/scrivener-and-ai-why-do-i-see-ai-prompts-in-my-scrivener-projects-on-mac)] |
| Ellipsus | Refuses generative AI | n/a | n/a | Withdrew NaNoWriMo sponsorship [reported] |
| Marker | Word processor with an editor "you can talk to in the margins" | Unknown | Unknown | $13M seed, July 2026; no docs found [reported: [Index](https://www.indexventures.com/perspectives/writing-friction-with-marker/)] |
| Obsidian "AI Editor" plugin | Park a question on a passage; answer appears in a side column; accept or reject | On accept | Unknown | [reported: [plugin](https://community.obsidian.md/plugins/editor-ai-daemons)] |
| Thesify AI Coauthor | Anchored AI comments; text unchanged | No | n/a | [reported: [help](https://www.thesify.ai/help/ai-coauthor/ai-comments)] |
| Khanmigo Writing Coach | Guides outline, draft, revise; teachers see chat history | Claimed no | n/a | Provenance by logging the conversation [reported] |
| Turnitin Clarity, Brisk Inspect Writing, GPTZero Replay, Draftback | Replay of writing history; flags pastes | No | Inferred after the fact | Teacher-facing. r/Teachers: a browser extension can type AI text with pauses and typos to defeat replay [reported] |
| AudioPen, Letterly, Cleft | See 2.9 | Rewrite is a new version | Original kept | |
| Wispr Flow, Monologue, Superwhisper, Aqua Voice | Dictation cleaned or rewritten in place; per-app modes | Yes | No | Superwhisper's "Voice to Text" mode is transcription only [observed: [docs](https://superwhisper.com/docs/modes/super)] |
| Descript | Edit audio by editing transcript; **Correct** mode changes text without changing media (dotted grey underline while it realigns); Overdub synthesizes your voice | Yes | Correct: briefly | Separates "change the record" from "change the words about it" [observed: [help](https://help.descript.com/script-editing/correct-your-transcript.md)] |
| Otter | Click a word to play audio from there; summary and chat panes | n/a | n/a | Word-level text-to-audio link [reported] |
| Tana meeting agent | Summary, tasks, entities "with links to relevant parts of the transcript" | Yes | No | [observed: [Tana](https://outliner.tana.inc/learn/features/tana-meeting-notetaker)] |
| Voicenotes | Audio kept; Create menu turns a note into email, post, list | New note | Original kept | Chat answers cite notes [reported: [review](https://nerdymomocat.github.io/posts/voicenotes-hitting-half-of-the-right-notes)] |
| Limitless / Rewind | Lifelog summaries | n/a | n/a | Acquired by Meta 2025-12-05; recording ended [observed: [limitless.ai](https://www.limitless.ai)] |
| Draft (draftin.com) | Pre-LLM version-based editing with accept/reject | n/a | n/a | Defunct [reported] |
| NaNoWriMo | n/a | n/a | n/a | Shut down 2025-03-31 after an AI-stance controversy [reported: [TechCrunch](https://techcrunch.com/2025/04/01/nanowrimo-shut-down-after-ai-content-moderation-scandals)]. Context for why "no AI" sells to writers |

### Research prototypes and sketches

| Prototype | Pattern | Source |
|---|---|---|
| Daemons and Epi (Appleton) | Background personas (devil's advocate, synthesizer, researcher, elaborator) highlight a sentence, ask you to defend a claim, or suggest a revision. Ignored suggestions **fade**. Epi: right-click to critique, find evidence, list assumptions | [LM sketchbook](https://maggieappleton.com/lm-sketchbook) [observed] |
| Script&Shift (CHI 2025) | Layers on a zoomable canvas; seven named helper personas; AI text colored by persona; the compiled document links back to its layers | [arXiv 2502.10638](https://arxiv.org/abs/2502.10638) [observed] |
| InkSync / Beyond the Chat | Inline executable edits (green insert, red strike) with Accept/Dismiss; **Warn** on edits that add "new unverified information"; Verify step; Audit view highlights system text | [arXiv 2309.15337](https://arxiv.org/abs/2309.15337) [observed] |
| CoAuthor (Lee 2022) | Tab opens five suggestions; replay of every keystroke; 72% acceptance | [arXiv 2201.06796](https://arxiv.org/abs/2201.06796) [observed] |
| Reactive Writers (CHI 2026) | Grey inline opinionated suggestions; writers shift from producing to evaluating; seeing a topic raises odds of writing about it 3.97× | [arXiv 2603.10374](https://arxiv.org/abs/2603.10374) [observed] |
| DiaryMate (CHI 2024) | Five candidate sentences per request; one participant put quotation marks around AI sentences herself because taking one "feels like copying" | [paper](https://lyumanshanye.github.io/lyuye.github.io/publication/chi2024_diarymate_paper) [observed] |
| Wordcraft, Dramatron, Sparks | Generation controls (continue, elaborate, rewrite) and hierarchical generation; writers found output bland and trope-bound | [Ippolito et al.](https://arxiv.org/abs/2211.05030) [observed]; others [reported] |
| ABScribe (CHI 2024) | Variations kept in place in "variation fields" for side-by-side choice | [arXiv 2310.00117](https://arxiv.org/abs/2310.00117) [reported] |
| VISAR (UIST 2023) | Argument-goal canvas synced to the editor | [arXiv 2304.07810](https://arxiv.org/abs/2304.07810) [reported] |
| Thinking Assistants | Chatbot that mixes probing questions with answers; ask-only questions "were often hard to answer and sometimes drifted off-topic" | [arXiv 2312.06024](https://arxiv.org/abs/2312.06024) [observed] |
| Provocations (Drosos et al.) | One short yellow "provocation" beside each AI output; participants called non-actionable ones "fluff" | [arXiv 2501.17247](https://arxiv.org/abs/2501.17247) [observed] |
| Sarkar, "AI Should Challenge, Not Obey" | Position piece: questions beside answers, argument maps, less chat and more notation. No built writing UI | [arXiv 2411.02263](https://arxiv.org/abs/2411.02263) [observed] |
| StorySage, GuideLLM | Interviewer agents that build a memoir across sessions | [arXiv 2506.14159](https://arxiv.org/abs/2506.14159) [reported] |
| Wattenberger, "Why Chatbots Are Not the Future" | Chat has no affordances; AI editing needs a "working buffer"; tutor-style suggestions ("Try smoothing out this transition") | [essay](https://wattenberger.com/thoughts/boo-chatbots) [observed] |

Not found or not relevant: Linus Lee writing editors, Andy Matuschak AI-writing notes, "Inkling", Lodestone's feature set (repository landing page only). Friction (CHI 2025) was blocked.

---

## 4. Taxonomy of interaction patterns

Each pattern names exemplars, the trade-off, and its relation to the governing rule. **Supports**, **mixed**, or **undercuts** refers to "opinionated in conversation, conservative in the artifact".

### 4.1 Where the AI's opinion goes

| Pattern | Exemplars | Trade-off | Rule |
|---|---|---|---|
| **AI as interviewer**: asks questions before any text exists | Spiral v3 interview step, StorySage, GuideLLM, Thinking Assistants | Draws out the person's words. Ask-only questions drift and are hard to answer; questions plus guidance did better. In Spiral the answers feed AI drafts, which ends the benefit | Supports when the answers become the material |
| **AI as margin editor**: anchored comments, text untouched | Sudowrite Feedback, Lex, AnchoredAI, Writor, Thesify, Proof threads, Canvas "Suggest edits" | Higher ownership and much higher effort (AnchoredAI). Advice tends to be vague without examples (Textfocals, Writor) | Supports |
| **Observation views**: summaries, reader questions, thesis extraction beside the text | Textfocals, Grammarly Reader Reactions, Rambler keyword highlights | Shows the person their own text from outside. Highlight color can read as error marking | Supports |
| **Separate report**: critique outside the manuscript | Marlowe | No in-text noise. Hard to act on point by point | Supports; weak on location |
| **Personas**: named critics with one job each | Daemons, Script&Shift, Sudowrite beta readers | Makes the kind of feedback legible. Risk of anthropomorphism; a persona tied to a real named person is a provenance failure (Grammarly Expert Review) | Supports if fictional and labeled |
| **Fade if ignored** | Daemons | Makes non-response free. Nothing persists; addressed and declined look the same | Supports; loses state |
| **Goals before critique** | Writor | The person steers what the critic looks for. People struggle to state goals | Supports |
| **Conversation on the comment** | Sudowrite "@Sudowrite" replies, Writor per-card chat, Proof threads | Discussion stays tied to the place. **Chat is where ready-made sentences leak** (Writor 5 of 94 turns) | Supports with a leak |
| **Warn at acceptance** | InkSync Warn and Verify, Provocations | Flags new facts the person did not supply. Warnings that cannot be acted on get ignored | Supports |

### 4.2 How text gets into the artifact

| Pattern | Exemplars | Trade-off | Rule |
|---|---|---|---|
| **Suggestion with accept**: inline tracked change | Gemini in Docs, Word Copilot, Notion agents, Type.ai, InkSync, Sudowrite accept, Proof suggestions | Familiar and precise. After acceptance most products drop the mark | Mixed: conservative until accepted, unmarked after |
| **Comment carrying a proposed edit** | Sudowrite Feedback, Lex rewrite-as-comment, Patchwork bot with reasons | The reason and the edit travel together; the person can take the point and skip the wording | Supports |
| **Alternatives picker** | Wordtune, Hemingway Plus, CoAuthor, DiaryMate, ABScribe, Spiral's three drafts | Choice feels like control. Picking among AI phrasings is the "reactive writing" mode | Undercuts in practice |
| **Branch and merge** | Patchwork, Upwelling | Strongest guarantee; history attributes every merged edit. Heavy for small edits | Supports |
| **Review handoff turn** | Roughdraft "Done Reviewing" | Clear turn-taking between person and agent | Neutral; direction is a choice |
| **Permission switch** | Sudowrite Chat-only vs Allow edits, Notion propose vs direct, Proof agent permissions | Makes the rule a setting the person sees | Supports when the default is the conservative side |
| **Plan then approve** | Sudowrite Chat multi-step plan | Approves the intent before text changes | Supports |
| **Inline ghost text** | Jenni, CoAuthor, Reactive Writers platform | Fast. Strongest anchoring and stance drift | Undercuts |
| **Rewrite in place / in your voice** | Wispr Flow, Monologue, AudioPen High, Hemingway Plus, Spiral | No artifact boundary at all | Undercuts; style cloning is out of scope |

### 4.3 Provenance displays

| Pattern | Exemplars | Trade-off | Rule |
|---|---|---|---|
| **Color by author, recorded at write time** | Granola (black/grey), iA Writer (gradient), Proof (rail), HaLLMark (orange) | Readable at a glance. Each product picks a different rule for when AI text becomes the person's: on any edit (HaLLMark), word by word (iA), per line (Granola, unverified), or unspecified (Proof) | Supports; the conversion rule needs a decision |
| **Origin separate from review** | Proof spec | Says both "who wrote this" and "did the person check it" | Supports |
| **Scribe attribution** | Proof `typed_by` | Names the case where the agent types the person's words | Supports |
| **Source tracing to the quote** | Granola "Zoom In", Tana transcript links, Otter and Descript word-to-audio | Lets the person check that a line rests on what was said | Supports |
| **Diff attribution on import** | iA "Paste Edits From" | Attributes only changed words when edits come from elsewhere | Supports |
| **Behavior replay, inferred after** | Grammarly Authorship, Brisk, GPTZero, Draftback, DraftMarks | For a third-party audience. Spoofable; misreads voice typing | Neutral to undercuts: surveillance orientation |
| **Person-assigned marks** | iA Mark As, HaLLMark "AI-influenced", DiaryMate user's quotation marks | Captures influence that no capture can see. Relies on honesty | Supports |

### 4.4 Arranging the person's own words

| Pattern | Exemplars | Trade-off | Rule |
|---|---|---|---|
| **Arranger of your words**: chunk, reorder, merge by gist | Rambler, AudioPen SuperSummary, Script&Shift layers | Structure work without new words. LLM merge and split were distrusted; manual moves were preferred | Supports if merges do not reword |
| **Semantic zoom** | Rambler | Reviews a lot of spoken material quickly | Supports |
| **Verbatim as version zero** | Letterly, Cleft, Voicenotes, Descript | The original is always one swipe away. No sentence-level link between versions | Supports |
| **Fidelity control** | AudioPen three levels, Cleft named styles, Superwhisper modes; requested by a Wispr user | Makes distance-from-verbatim a choice. Set per note, not per span | Supports |
| **Edit the record vs edit the text** | Descript Correct mode | Separates fixing a transcription error from changing what was said | Supports |
| **Silent cleanup** | Rambler transcript cleanup, Wispr Smart Formatting | Users like it. It is an unrequested, unmarked change | Undercuts, mildly |

---

## 5. Which patterns fit the governing rule

**Fit well** [opinion]:

- Margin comments that carry a reason and, at most, an example edit (Sudowrite Feedback, Writor, AnchoredAI). The opinion stays in the margin, and the text changes on accept.
- Observation views and reader questions (Textfocals). They are opinionated about the text without proposing wording.
- Branch and merge, and permission switches with the conservative default (Patchwork, Sudowrite Chat-only). They make "changes only on instruction" structural.
- Color by author recorded at write time, plus source tracing (Granola, iA Writer, Proof). These cover "anything of the AI's that lands is marked".
- Proof's origin/review/`typed_by` split. It is the only schema found that says "the agent typed this, and the words are the person's".
- Verbatim as version zero and fidelity controls (Letterly, Cleft). They keep the person's words reachable whatever the output.

**Undercut it** [opinion]:

- Inline ghost text and alternatives pickers. Reactive Writers and Jakesch show the person moves from saying to choosing.
- Accept-then-unmarked suggestion flows (Gemini in Docs, Type.ai, Hemingway Plus). They are conservative until the click and then lose provenance.
- Rewrite-in-place dictation (Wispr Flow, Monologue). There is no artifact boundary.
- Chat panes that also write (Canvas, Sudowrite Allow-edits, Proof agents with full permission). The rule holds only by setting.
- Behavior replay (Grammarly Authorship and the classroom tools). It treats provenance as evidence for someone else, and it misclassifies voice-typed text.

**Evidence that complicates the rule** [observed in sources above]:

- Keeping the artifact conservative costs effort (AnchoredAI mental demand 52 → 81).
- Feedback-only systems leak wording through their chat (Writor).
- Unrequested cleanup of speech was welcome (Rambler). A strict "no change without instruction" may be stricter than people want for filler and punctuation. The oral-history "intelligent verbatim" level in the writing-practice issue already allows this.
- Questions can be resented or ignored when they are not actionable (Provocations).

---

## 6. Gaps: what no product or prototype does

1. **Voice capture plus margin critique.** Rambler has voice and gist but no critic. AnchoredAI and Textfocals have critique but no voice. Nothing anchors AI questions to spans of the person's spoken words.
2. **Sentence-to-utterance provenance in the output.** Granola links a note to a transcript passage. Nothing links a sentence in a finished essay to the voice memo or chat message it came from. Rambler participants asked for it.
3. **Gap marks in the artifact.** No tool puts "this paragraph does not say why" into the document as a visible placeholder. Gaps appear only as sidebar advice.
4. **Persistent critique state.** No tool tracks which AI points the person addressed, declined, or deferred, across drafts. Daemons fade; Textfocals regenerates; Sudowrite hides resolved comments.
5. **A stated rule for when AI text becomes the person's.** Each product picks one silently (any edit, per word, per line, never). None lets the person see or choose it.
6. **Per-span fidelity.** Fidelity controls work per note or per mode. None lets one passage stay verbatim while the next is cleaned.
7. **Protection against agreement-driven acceptance.** Reactive Writers names the mechanism. No UI hides AI wording until the person has said their own version first.
8. **Scribe attribution outside Proof.** Only Proof's `typed_by` names "the agent typed the person's words". Grammarly marks voice typing as copied text.
9. **Arrangement provenance.** Selection can mislead without changing a word (see [authentic-ai-writing §3.1](authentic-ai-writing.md)). No tool shows which arrangement choices were the AI's.

---

## 7. Dispositions

Dispositions are about patterns and ideas. Traces point to [writing practice](../../issues/features/2026-07-05-writing-skill.md) (WP), [suggested edits](../../issues/features/2026-10-13-suggested-edits-tracked-changes.md) (SE), and [questions as inline annotations](../../issues/exploration/2026-08-01-questions-as-inline-annotations.md) (QA).

| Pattern or idea | Disposition | Trace and reason |
|---|---|---|
| Margin comment with a reason and at most one example edit; accept applies the edit (Sudowrite Feedback, Writor) | **adopt** | WP §9 "name the problem, offer an example, let them resolve it"; SE "each suggestion carries a short reason". The IPEd rule in product form. |
| Reader-question and observation views (Textfocals) | **adopt** | WP §8 editorial review and §9. Opinionated about the text without proposing wording. |
| Reply on the comment as the conversation channel | **adopt** | QA thread model; SE "comment and re-propose". Writor's leak means chat replies need the same no-ready-made-prose discipline as the cards. |
| Origin / review / `typed_by` split (Proof) | **adapt** | WP governing rule ("marked") and the quote law. See [proof-every.md](proof-every.md). |
| Source tracing from an output line to its quote (Granola "Zoom In") | **adopt** | WP stage 2 and `{% quote %}`/`{% source %}`. Every assembled line should open its source utterance. |
| Verbatim as version zero (Letterly, Cleft, Descript) | **adopt** | WP "archive the raw". Matches the Veterans History Project rule already adopted. |
| Fidelity as named presets plus a dial | **adapt** | WP fidelity spectrum. Extends AudioPen's dial with Cleft's names; gap 6 suggests per-span setting. |
| Color by author, with a stated conversion rule | **investigate** | WP "anything of the agent's that lands is marked". Products disagree on when AI text becomes the person's (gap 5); the boxholder should pick the rule. |
| Permission switch with conservative default (Sudowrite Chat-only, Notion propose) | **adapt** | WP governing rule. A visible setting makes the rule inspectable. |
| Plan then approve for multi-step changes | **adapt** | WP §3 assembly; SE batch alternates. |
| Gist arrangement and semantic zoom (Rambler) | **investigate** | WP stage 2 "presenting what was collected" and the outline mode. Users distrusted LLM merges; manual moves with AI summaries worked. |
| Goals before critique (Writor) | **adapt** | WP §8. The person picks which tier of editing they want. |
| Warn on new unverified information (InkSync) | **adapt** | WP §6–7: a fact the person did not supply gets marked as not theirs. |
| Edit-the-record vs edit-the-text (Descript Correct) | **investigate** | WP quote law: fixing a mis-transcription differs from revising what was said. |
| Fade-if-ignored suggestions (Daemons) | **investigate** | QA "the agent resolves". Weigh against gap 4 (persistent critique state). |
| Persistent addressed/declined/deferred critique state | **investigate** | Gap 4; QA resolution step. |
| Hide AI wording until the person states their own (Reactive Writers' missing UI) | **investigate** | WP outline mode and §9; gap 7. Would also produce the missing questions-vs-drafts data. |
| Branch and merge for agent edits (Patchwork) | **later** | SE storage. Strongest guarantee; heavy for paragraph edits, per Litt. |
| Review handoff turn and CriticMarkup with `by=` (Roughdraft) | **investigate** | SE storage. SE ruled out inline annotation as noisy; Roughdraft is a working counter-example worth a look. |
| Diff attribution on import (iA "Paste Edits From") | **adapt** | SE: an external edit enters as a suggestion with its changed words attributed. |
| Reader-facing process marks (DraftMarks) | **later** | Useful only if the box publishes with a disclosure layer. |
| Inline ghost-text completion | **reject** | Undercuts the rule (Reactive Writers, Jakesch). |
| Alternatives picker as the main mode | **reject** | Moves the person from saying to choosing. Alternates inside one reasoned suggestion (SE) are a different case. |
| Rewrite-in-place dictation and "sounds like you" output (Wispr Flow, Spiral, AudioPen High) | **reject** | Out of scope by boxholder direction; no artifact boundary. |
| Behavior replay for a third party (Grammarly Authorship, Brisk) | **reject** | Wrong audience, spoofable, and misreads voice typing. WP prefers process capture by the system that does the work. |
| Personas named after real people | **reject** | Grammarly Expert Review shows the failure. Fictional, labeled personas stay open. |

---

## 8. Sources that could not be read

OpenAI help and launch pages (403), Brisk help center (403), Type.ai features (404), Ellipsus stance page (404), Khanmigo writing-coach page (404), Otter docs (403), CHI 2025 "Friction" (403), Lodestone README. Reddit reception came only from r/Teachers and r/writing through Arctic Shift; other subreddits were rate-limited or removed. Most Sudowrite Feedback, Proof, and Marker reception is from the vendors or their staff, since the features are recent.
