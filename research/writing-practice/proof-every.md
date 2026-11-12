# Proof (Every): an editor that records who wrote what

Deep-dive, 2026-10-27. Companion to [AI writing products and their UI](ai-writing-products-ui.md).

Labels: **[observed]** means we read the product page, repository, or docs. **[reported]** means a third party said it. **[opinion]** is our reading.

## Which Every product this is

The boxholder remembered that Every (every.to) has a product for authentic AI-assisted writing. Every's [product list](https://every.to/products) has several writing tools [observed]:

| Product | What it does | Fit with the boxholder's framing |
|---|---|---|
| **Proof** | "A shared editor where humans and AI agents can write and edit documents together". The experiments list describes it as "Writing and editing with AI agents, with a record of who wrote what". | **Best fit.** It is the only Every product that records which words are whose. |
| **Spiral** | "A writing partner for you and your AI agent." Ghostwrites in a learned voice. | Opposite. Style cloning, with no marking of AI text. |
| **Monologue** | Voice dictation and voice notes. Cleans speech into text. | A scribe tool. It does not keep the verbatim on Every's servers. |
| **Machcast** | "Guided prompts that help you explore your interests and draft shareable thoughts". | Unclear; no source found beyond the listing. |
| Cora, Sparkle | Email and file organizing. | Not writing tools. |

**Lex is not an Every product today.** Nathan Baschez co-founded Every and later spun Lex out [reported: [yespress](https://yespress.io/dan-shipper-nathan-baschez)]. Lex now says it is "no longer accepting new customers" [observed: [lex.page/pricing](https://lex.page/pricing)].

**Proof is the "ProofEditor" in [questions as inline annotations](../../issues/exploration/2026-08-01-questions-as-inline-annotations.md).** That issue took ProofEditor's anchored threads as its model without naming the maker. The maker is Every.

## What it is

- Dan Shipper announced it on 2026-01-11 as an "agent-native markdown editor with provenance tracking" [observed: [tweet](https://x.com/danshipper/status/2010411900861813233), read via a proxy].
- It launched publicly on 2026-03-11, free and without login [observed: [launch post](https://every.to/on-every/introducing-proof), [proofeditor.ai](https://proofeditor.ai)].
- The editor core is open source (MIT) as the [Proof SDK](https://github.com/EveryInc/proof-sdk) [observed].
- It began as a Mac app to show the provenance of AI-written text. A web rebuild with real-time collaboration (Yjs) followed. The launch had repeated outages [reported: [The Neuron](https://www.theneuron.ai/the-neuron-ai-explained-podcast/how-to-become-agent-native-dan-shipper-built-a-viral-app-between-meetings-then-it-broke-heres-what-he-learned/)].

## What the person does

1. A person or an agent creates a Markdown document, in the web editor or over HTTP.
2. The person types in a live collaborative editor.
3. Agents connect through an HTTP bridge, a skill file, or a CLI. Each agent write carries a `by` value such as `ai:codex` [observed: [proof.SKILL.md](https://github.com/EveryInc/proof-sdk/blob/main/docs/proof.SKILL.md)].
4. Agents can comment, reply, and resolve; add, accept, or reject suggestions; apply rewrites; and make block edits (`replace_block`, `insert_after`) [observed: [AGENT_CONTRACT.md](https://github.com/EveryInc/proof-sdk/blob/main/AGENT_CONTRACT.md)].
5. The owner accepts, rejects, or replies. The marketing line is "Agents propose changes. You accept, reject, or reply." [observed]

The SDK also lets an agent create a suggestion already in the accepted state. So "the document changes only on the person's instruction" holds only if the person limits what the agent may do [observed: agent docs]. The launch post says "Anything you can do in Proof, your agent can do just as easily" [observed].

## UI

- **Author rail.** A colored rail runs down the left margin. Green marks human text, and purple marks AI text [observed: launch post].
- **The January design merged authorship and review.** Shipper's first post used three colors for AI text: "red = written by AI, no review. yellow = i've skimmed it. green = i endorse this / i wrote this" [observed]. The March design shows origin on the rail and keeps review state in the data model.
- **Comment threads** with Reply and Resolve [observed: proofeditor.ai].
- **Agent presence.** A label such as "Claude Code Reviewing" at the top of the page, driven by an `X-Agent-Id` header and a presence status such as "thinking" [observed].
- **Suggestions** show inline, and the owner reviews them [reported: [podcast transcript](https://every.to/podcast/transcript-how-we-use-proof-a-collaborative-editor-for-humans-and-ai)]. We could not confirm how a suggestion looks on screen.
- **Not shipped:** Shipper suggested a hover label such as "from monologue", so dictated text shows its source [reported: same transcript].

## The provenance model

The most useful part for the boxholder is the draft [PROVENANCE-SPEC-v2](https://github.com/EveryInc/proof-sdk/blob/main/docs/PROVENANCE-SPEC-v2.md), dated 2026-01-11. We read it directly [observed].

**Principle:** "Attestation follows meaning, not bytes." A span is found by a selector, with a cached offset and content hash for speed. Selector types: quote (exact or fuzzy text), structural anchor (`heading:Authentication > paragraph:first`), natural-language description, pattern, and composites (`all`, `any`, `not`). A hash mismatch marks the span stale and re-resolves it.

**Three separate fields:**

| Field | Values | Meaning |
|---|---|---|
| `origin` | `human`, `ai` | "Whose intellectual contribution" the text is. |
| `basis` | `described`, `inferred`, `suggested` | Why the AI wrote it. "Basis is ONLY for AI-origin content. Human content never has a basis." |
| `review` | a stack of records: `skimmed`, `flagged`, `approved` | Who checked it, and how closely. |

**Scribe attribution.** `meta.typed_by` applies "when the physical typist differs from the intellectual origin". If the person dictates and the AI types, the record is `origin: human, typed_by: ai:claude`. The agent's decision tree starts with: "Did user provide exact text to insert? → origin: human, typed_by: ai:claude (you're the scribe)" [observed via the SDK summary].

**Review rules:**

- An AI can add only `skimmed`. "AI cannot approve its own content."
- `flagged` and `approved` are human-only.
- A review goes stale when the content hash changes. So an edit after approval removes the approval.
- Displayed levels: Unreviewed, Skimmed, Needs Review (any flag wins), Approved, Verified (three or more approvals).

**Sources.** A `sources` field names where content came from: `user_input`, `url`, `file`, or `reference`. The spec prefers a hash over raw content when the source is sensitive.

**Storage.** A YAML block inside an HTML comment (`<!-- PROVENANCE ... -->`) at the end of the Markdown file, with a legacy JSON form. The hosted app also appears to wrap authored text in inline `<span data-proof="authored">` tags, which agents strip before searching [observed: agent docs].

**Open in the spec.** It has no rule for what happens to `origin` when a person edits AI text [observed]. iA Writer clears the AI mark word by word as the person retypes. HaLLMark clears it on any edit. Proof leaves this undecided. One small detail: the spec file's own trailing provenance block lists 158 spans, all AI-origin and unreviewed.

## Stance, and where it differs from the boxholder's framing

- **The target user reads AI-written documents.** The launch post frames Proof against word processors that assume "a human is doing the writing and AI is helping at the margins". Its examples are PRDs, plans, and memos that agents write [observed]. The rail exists so a person can see what the AI wrote and how closely someone checked it. The boxholder's case is the reverse: the person's words are the substance, and AI text is the exception.
- **The founder says provenance mattered less than he expected.** In the podcast, Shipper says provenance "was less important than I thought", though "it matters", and "I read AI writing all the time" [reported: transcript]. He also says personal and narrative writing stays human.
- **Users inside Every wanted the boxholder's thing.** A teammate valued seeing "what it wrote versus what I wrote", which Google Docs could not show. He worried "am I taking a line the AI added in?" and wanted text he dictated marked as his own [reported: transcript].
- **The founder wants a canonical document that changes only on his approval**, with agents working in other versions [reported]. That is "conservative in the artifact", stated as a wish. The shipped agent API lets agents edit directly.
- **Agent damage is the main complaint.** "One agent who does one bad thing can pollute the entire document." Agents have "a ton of power and zero responsibility". In one test, agents "kept duplicating and then triplicating the page" [reported].

## Reception

There is no independent critique. The [HN link post](https://news.ycombinator.com/item?id=47564621) has no comments. The signal comes from Every staff: agents that damage documents, no index of documents (one person wants an inbox), and outages at launch [reported].

## Related: Roughdraft (Lex-Inc)

Baschez's later company publishes [Roughdraft](https://github.com/Lex-Inc/roughdraft), a local-first Markdown editor for reviewing a document with an agent [observed]. Its file format is a useful contrast to Proof's:

- Comments and suggestions are stored in the file as **CriticMarkup**, with ids such as `{#c1}`. Metadata goes in a YAML endmatter block under `comments:` and `suggestions:`, and each item has `by`, `at` (timestamp), and `re` (reply parent).
- The person clicks **Done Reviewing**. `roughdraft open <path>` blocks until a `review.completed` event arrives, with feedback counts and an optional overall comment. The agent then replies or revises.
- An experimental MCP server lists pending feedback, appends replies, and resolves items.

Roughdraft's direction is the reverse of the boxholder's: the agent writes and the person reviews. Its turn structure (an explicit "I am done; your move" handoff) fits either direction [opinion].

## Dispositions

| Idea | Disposition | Traced to |
|---|---|---|
| Separate **origin**, **basis**, and **review** as three fields | **adapt** | [Writing practice](../../issues/features/2026-07-05-writing-skill.md), governing rule: "anything of the agent's that lands is marked". Origin is the mark. Basis says why the agent added it. Review records that the boxholder saw it. |
| `typed_by`: the agent as scribe of the person's words | **adopt** | Writing practice, "the instruction is the provenance". A dictated or quoted span is human-origin even when the agent typed it. This is the same distinction the `{% quote %}` mechanic carries. |
| Human-only approval that goes stale when the text changes | **adapt** | [Suggested edits](../../issues/features/2026-10-13-suggested-edits-tracked-changes.md), "durable" suggestions and stale detection. |
| Selector plus content hash for anchoring | **investigate** | Suggested edits stores old text and new text, and stale detection is "old text no longer matches". Proof's quote selector is the same idea with a fallback. |
| One traffic-light color for both authorship and review (January design) | **reject** | Proof itself split them. Merging "who wrote it" and "who checked it" hides the first. |
| Agent permission to create already-accepted suggestions | **reject** | Contradicts "the document changes only on instruction". |
| Roughdraft's explicit "Done Reviewing" handoff | **investigate** | Suggested edits, "comment and re-propose". The handoff gives the agent a clear point to re-propose against the accepted state. |
