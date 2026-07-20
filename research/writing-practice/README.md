# Writing practice — how people turn a person's words into finished text

Research corpus for the writing work tracked in
[writing skill](../../issues/features/2026-07-05-writing-skill.md): a practice
where the box helps turn the boxholder's **oral presentation of an idea** into
some other form (a post, an email, a doc), with their own words kept primary.

Unlike the rest of `research/`, these aren't reviews of competing *systems* —
they're research into external *practice*: oral history, ghostwriting,
journalism, thesis editing, and the screenwriting tools that handle cut
material. The premise is that several professions have worked this exact problem
for decades and we should steal from them rather than invent.

Snapshots, both 2026-07-20.

| Document | Covers |
|---|---|
| [Authentic AI-assisted writing](authentic-ai-writing.md) | Process and provenance — elicitation craft, oral-history fidelity norms, ghostwriting ethics, thesis-editing's editing/authoring line, provenance formats, HCI evidence on AI drafts and authorial ownership. ~68 cited sources, labeled empirical / practice / opinion. |
| [Boneyards and cut material](boneyards-and-cut-material.md) | The keep-don't-delete drafting habit: what it's actually called, how practitioners organize it, and how shipping tools (Final Draft, Highland 2, WriterDuet, Scrivener, Ulysses) implement it. |

Deliberately **out of scope**: style cloning / "write like me" fine-tuning and
prompting. Boxholder finds it unimpressive and it's a well-covered dead end for
this purpose.

## Dispositions

| Finding | Disposition | Where it landed |
|---|---|---|
| Oral history's fidelity spectrum (full verbatim → intelligent verbatim → edited) as a user-facing dial | **adopt** | Promoted to the issue's core frame. Boxholder: "I like oral history fidelity as a core idea." |
| Meaningful false starts preserved, pure filler dropped | **adopt** | The judgment that separates sounding like the person from sounding sanitized. |
| IPEd thesis-editing rule — "may draw attention to problems, but should not provide solutions; examples may be offered" | **adopt** | Basis of the issue's governing rule; read constructively as *the technique* for offering ideas without over-steering. |
| Channel separation — opinionated in conversation, conservative in the artifact | **adopt** | The issue's governing rule (settled 2026-07-20). Derived here from IPEd + the anchoring evidence. |
| Elicitation craft — OARS, StoryCorps, CJR (concrete before abstract, hardest last, prepare-20-ask-10, silence as a tool) | **adopt** | Stage 1. "Silence is a tool" is the non-obvious one for a chat agent built to fill turns. |
| Narrator review / storyteller approval of the edited cut as a mandatory stage | **adopt** | Stage 4 — and the reason bold editing is safe rather than presumptuous. |
| Selection can falsify without inventing a word (Schwartz, *Art of the Deal*) | **adopt** | Means accurate `{% quote %}` is necessary but not sufficient; the user must own the arrangement. |
| Provenance via **process capture**, not output analysis | **adopt** | No span-level format has been adopted anywhere; the systems that get closest log as you work. The elicitation transcript is the record. |
| Brackets `[ ]` reserved exclusively for editorial insertion | **adapt** | Near-universal oral-history convention; a ready-made complement to `{% quote %}`. |
| Boneyard: adjacency beats bottom-exile; cuts stay chunked and nameable; auto-excluded from word counts and export | **adapt** | Convergent across Final Draft / Highland 2 / WriterDuet / Scrivener. |
| Membership-in-output as a toggleable **property of a chunk**, not a location (Ulysses Material Sheets, Scrivener include-in-compile, org-mode `COMMENT`) | **adopt** | Dissolves the bottom-pile-vs-inline-collapsed question, and fits a design where the destination is often unknown. |
| Scheduled reread of the boneyard at revision milestones | **investigate** | No surveyed tool addresses the graveyard-nobody-reads problem — genuinely novel ground, and a natural fit for a box that already runs scheduled procedures. |
| Anchoring: AI drafts shift the writer's position and phrasing | **adopt as rationale** | Jakesch CHI 2023 (N=1,506) and follow-ups support "ask, don't draft" — but no direct questions-vs-drafts study exists. Well-motivated, not demonstrated. |
| Felt ownership as a success metric | **reject** | Dissociates from disclosure behavior; token effort manufactures it. Use process facts instead (fraction of final words traceable to user utterances). |
| Span-level provenance standards (C2PA, academic AI-disclosure policy) | **reject for now** | C2PA handles text but whole-file only; academic policies are document-level; detection fails on hybrid text. Superseded by process capture above. |
| Style cloning / voice mimicry | **reject** | Out of scope by boxholder direction. |
| Naming the practice ("AI assembles the human's words" has no term of art) | **later** | Nearest anchors: "as told to," centaur, Sarkar's "provocateur, not assistant." Open ground. |

## Known gaps

Flagged by the research rather than papered over:

- **No head-to-head study** of "AI asks questions" vs. "AI hands you a draft."
  The anchoring case is converging-indirect. This practice could generate the
  missing data.
- **Ghostwriters on AI** is one substantive essay deep.
- **Oral History Association's institutional AI position** is member-gated; the
  field's granular transcription norms live in individual repository style
  guides, not one central standard — so a deeper pass means reading several.
- **No empirical work on whether saved cuts get reused.** Composition studies
  covers recursive revision generally (Sommers 1980) but not this; the retrieval
  design won't be settled by literature.
- A few style-guide specifics rest on secondary summaries where primaries were
  unfetchable (noted inline in the documents).
