---
title: "Design reconciliation — adjudication list"
status: implemented
workstream: unknown
issues: []
---
# Design reconciliation — adjudication list

The design documents disagree with each other and with the code, and none of them
can be presumed right: the boxholder's design preferences have been developing
(see the Direction section of `docs/plans/docs-reorg.md`: "Design docs require
reconciliation, not just filing"). This doc is the divergence list for that
reconciliation. **Convention** (precedent: the user-stories audit,
`docs/implemented-plans/user-story-audit-followups.md`): the boxholder writes
`IAN:` comments anywhere in this file, or edits the `**Ruling:**` lines in
place. A follow-up pass then executes the rulings against the docs.

Scope: genuine design-preference divergences — framing, vocabulary, intent.
Simple factual staleness (dead paths, removed features already covered by
banners) is collected at the end as a no-ruling-needed appendix.

Sources compared: `docs/design.md`, `docs/implementation.md`,
`docs/design-vision.md`, the `docs/architecture/` vignette series
(01, 02, spirit.md, outline.md), the code as it is (triage pipeline, reactor,
chat, connectors, hub), and recent decisions (`docs/glossary.md`,
`docs/stack-decisions.md`, `docs/plans/interface-as-cards.md`,
`docs/implemented-plans/boxes-as-packages-v2.md`,
`docs/activities-retrospective.md`).

---

## A. Identity and audience

### 1. Is the interface documents, or conversation?

- **Claim** — design.md:14: "A file-based environment where the main interface
  is **documents and command files**, not a UI." Reinforced at design.md:16-20
  ("The 'innards' are not meant to be the attraction").
- **Reality/tension** — architecture/01-what-is-this.md:11: "This group chat is
  the primary surface: a conversation where the box is one of the participants.
  Not a dashboard everyone logs into separately. Not an app with a home
  screen." The code agrees with the vignette: chat is the central page, plus
  capture, dashboard, views, and a real design system (frontend.md).
  `docs/plans/interface-as-cards.md` (current direction) goes further and makes
  the UI itself card material — dissolving the files-vs-UI dichotomy rather
  than picking a side.
- **Options** —
  1. Rewrite design.md §1: the filesystem is the *state*, conversation +
     generated surfaces are the *interface*; "documents not UI" was a
     statement about where truth lives, not where interaction happens.
  2. Keep documents-first as the identity and demote chat to "one surface
     among several" (consistent with §16's nothing-is-privileged — see item 6).
  3. Adopt the interface-as-cards framing as the canonical answer: surfaces
     are cards too, so the dichotomy is retired.
- **Ruling (boxholder, 2026-07-04):** Both, now. The web UI is the main UI, and
  it's really a focus. Conversation and chat are important. The documents are
  the result, and are main method of record.

### 2. One boxholder, or a shared household box?

- **Claim** — glossary.md:18: "**box** — A single user's working directory";
  glossary.md:20: "**boxholder** — The human a box belongs to."
  implementation.md:1015 still lists as open: "Multi-user: Is this single-user
  only, or could multiple people share a box?"
- **Reality/tension** — the entire architecture series is premised on a
  five-person shared box (01-what-is-this.md:5: "They share a *box* — a system
  that holds their stuff…"; six-member group chat, per-member surfaces,
  cross-language use). Nothing in the code has member-level identity beyond
  the auth allowlist; all prompts and schemas assume a singular boxholder.
- **Options** —
  1. Rule the family box as the design target (the vignettes are the vision);
     glossary gains a "member" concept and single-user is the degenerate case.
  2. Rule single-boxholder as the design (glossary stands); the Lund-Vegas are
     an *illustrative dramatization* and the architecture docs get a note
     saying multi-member is aspirational, not designed.
  3. Split: shared *data and chat* is in-scope, per-member identity/permissions
     is explicitly out-of-scope for now.
- **Ruling (boxholder, 2026-07-04):** Shared. Sometimes one, but can be
  multiple. A "box" has one granularity of sharing, so if you have different
  groups or subgroups then you need different boxes.

### 3. The one-sentence identity: OS, appliance, or assistant?

- **Claim** — design-vision.md:56: "Bee Box functions as a personal
  operating system where Claude Code becomes the development environment."
  design.md:22: "It's not meant to feel like a 'work tool,' even if it could
  be used professionally."
- **Reality/tension** — CLAUDE.md:1 (the sentence agents actually load): "A
  personal assistant infrastructure built on Claude Code." And
  boxes-as-packages-v2 added a productization goal foreign to both:
  "**a stranger can start a box in minutes**, without this monorepo, Ian's
  server, or any of its conventions"
  (docs/implemented-plans/boxes-as-packages-v2.md:19-21).
- **Options** —
  1. Bless CLAUDE.md's "personal assistant infrastructure" as the canonical
     identity; "personal OS" survives only as a historical aspiration inside
     whatever design.md becomes.
  2. Keep "operating system / place you inhabit" (spirit.md's framing) as the
     identity and treat "assistant" as merely the most visible feature.
  3. Write the identity fresh (it has genuinely evolved: assistant + shared
     repository + buildable place), and make every narrative doc open with it.
- **Ruling (boxholder, 2026-07-04):** The ambition is OS.

### 4. Local-first-avoid-the-cloud vs. the hosted fleet

- **Claim** — design.md:304-307: "do not worry about configuration/environment
  setup for cloud / execute directly on the computer locally."
- **Reality/tension** — there is a production server fleet with a resident
  `bbx hub`, auto-deploy, health-check runbooks; boxes-as-packages-v2 made the
  routing/auth parent process "an important, first-class component"
  (docs/implemented-plans/boxes-as-packages-v2.md:31-33). Local-first was a
  sequencing decision that has been executed past.
- **Options** —
  1. Update design.md §12 to describe the actual posture: local dev boxes +
     first-class hosted multi-box serving, with the stranger-in-minutes goal.
  2. Retire §12 entirely — it was a phase note, not a design position.
- **Ruling (boxholder, 2026-07-04):** There's a kind of cloud option, but only
  a cloud server. It won't ever run on AWS Lambda for instance. So it can run
  "remotely" but always on a full computer.

---

## B. Interaction model

### 5. "Not a chatbot" vs. the standing witness

- **Claim** — design.md:348: "The system is **not a chatbot**. It doesn't sit
  waiting for interaction." (§15, "Idle by default".)
- **Reality/tension** — chat is now a continuous, session-resuming presence:
  the reactor gives chat jobs per-thread sessions with resume
  (src/core/reactor/DESIGN.md, "Two Processing Paths"), and the current design
  direction makes chat *the* persistent frame primitive —
  interface-as-cards.md:328-329: "it is the standing *witness*, subscribed to
  the frame across everything you do"; :339: "chat becomes the sidekick of
  everything."
- **Options** —
  1. Re-scope §15: "idle by default" governs *background processing* (wakeup,
     reactor, schedules — still true and load-bearing); interactive chat is a
     co-equal foreground mode the section simply wasn't about. Rewrite to say
     both.
  2. Declare §15's "not a chatbot" superseded: the box *is* conversational
     first (per the vignettes), and idleness is an implementation property,
     not an identity claim.
- **Ruling (boxholder, 2026-07-04):** I WANT there to be more proactivity and
  stuff, but it's definitely ALSO a chatbot.

### 6. "Nothing else is particularly privileged" vs. chat's special machinery

- **Claim** — design.md:375: "Connectors are first-class. Nothing else is
  particularly privileged—not voice, not web, not any particular UI. They're
  all just different connectors or ways to feed the inbox."
- **Reality/tension** — chat is architecturally privileged everywhere: the
  reactor has a dedicated chat path (src/core/reactor/DESIGN.md, "Why two
  paths?"), chat sessions have their own pool/registry/history machinery
  (src/core/chat-*.ts), and interface-as-cards names the companion slot and
  the input as frame *primitives* — the input being "a true singleton …
  it extends the person, not the content" (interface-as-cards.md:374-393).
- **Options** —
  1. Amend §16: connectors are the boundary for *external services*; chat and
     the input are frame primitives, deliberately privileged — state the
     hierarchy explicitly.
  2. Hold the original line as a design constraint (chat should be
     re-plumbable as "just another connector," e.g. Telegram vs web parity)
     and treat current chat specialness as accepted tech debt.
- **Ruling (boxholder, 2026-07-04):** The web has become privileged, or at
  least the richest surface and main focus.

### 7. Web UI: debug viewer or product surface?

- **Claim** — implementation.md:542: "Initially this is a debugging/viewer
  interface - full transparency into the system state. Later it may split
  into a cleaner user-facing view and a debug backend."
- **Reality/tension** — the web app is the primary product surface
  (architecture/CLAUDE.md: "Web chat is primary; Telegram is one of several
  additional channels"), with a design system, SSR rendering, capture pages,
  and interface-as-cards is entirely about its future. The split that
  happened is Admin-vs-everything (interface-as-cards.md:291: "Admin stays
  shell. Permission boundary."), not debug-vs-user.
- **Options** —
  1. Retire the debug-first framing; record that the actual split rule is the
     permission boundary (Admin/OAuth out of cards, everything else in).
  2. Keep a "full transparency" clause as a live value (see-the-gears,
     spirit.md:21-29) while dropping the "later it may split" prediction.
- **Ruling (boxholder, 2026-07-04):** Web UI as debug viewer is fully out of
  date.

### 8. What does "wakeup" name now?

- **Claim** — glossary.md:34: "**wakeup cycle** — `bbx wakeup` runs connectors →
  processes inbox → executes commands → archives → schedules next wakeup. The
  agent's main loop." (CLAUDE.md "Key Concepts" repeats this.) glossary.md:10
  says the glossary wins conflicts "or update this file if the term has
  genuinely shifted."
- **Reality/tension** — the reactor is the main loop; `bbx wakeup` is just its
  step (a), "sync external sources" (src/core/reactor/DESIGN.md flow diagram);
  "executes commands" doesn't exist (outbound flushes via `bbx finalize`);
  inbox processing is intake → triage → handle (docs/triage-design.md:18-27).
  The term has genuinely shifted and the glossary hasn't.
- **Options** —
  1. "Wakeup" narrows to mean the sync step; the glossary gains a **reactor**
     entry as "the agent's main loop," and CLAUDE.md's Key Concepts follows.
  2. "Wakeup cycle" stays the umbrella name for one full reactor cycle
     (sync → jobs → finalize), and the reactor is documented as the wakeup
     cycle's engine; `bbx wakeup` the command gets renamed or footnoted.
- **Ruling (boxholder, 2026-07-04):** I think that's roughly right, but you
  could research to make it more accurate. There's no big change to wakeup
  planned as far as I can remember.

---

## C. Processing, trust, and agency vocabulary

### 9. Did the paperwork/authorization idea die with command cards?

- **Claim** — design.md:243-249 (§9): "For actions, you want the system to
  include a kind of 'paperwork': What is the impact of the action? What
  confirmation exists that the user really wanted it done this way?" and
  design.md:381-394 (§17): command cards carry "**authorization fields**
  alongside the payload: Source … User intent … Risk/impact assessment …"
- **Reality/tension** — command cards are gone (design.md banner, line 2);
  their successor, reactor job cards, carry only
  `status/source/priority/description/items`
  (src/core/reactor/DESIGN.md, "Job Lifecycle") — no impact, intent, or risk
  fields anywhere in the current action path. The *idea* (justified,
  auditable outbound actions) has no successor artifact; the closest living
  relative is commit trailers plus question/confirm gates.
- **Options** —
  1. Rule the paperwork idea retired: trust now comes from the question system
     + see-the-gears history, not per-action justification records. Note that
     in design.md §9/§17's replacement text.
  2. Rule it a standing requirement the jobs/outbound model still owes —
     open a design item (e.g. authorization fields on outbound cards like
     `email-outbound`).
  3. Defer: park in `docs/ideas.md` with a pointer from the rewritten section.
- **Ruling (boxholder, 2026-07-04):** No. The schemas are actually part of
  that, including fields that must be filled in not because they are
  essential information, but because they are essential process for the
  agent to go through.

### 10. Three trust vocabularies

- **Claim** — design.md:495-497 (§21): "1. **Question** … 2. **Confirmation**
  … 3. **Automatic** — the system's relationship with the user evolves"
  with escalations recorded in `/.claude/` rules.
- **Reality/tension** — two other trust scales shipped independently:
  triage confidence — "**confident** … **probable** … **guess**"
  (docs/triage-design.md:117-119), and retro belief confidence —
  "1 session = hypothesis, 2–3 = low, 4+ = medium — the ceiling for inferred"
  (glossary.md:44). Three vocabularies for "how sure/authorized is the agent,"
  none referencing the others.
- **Options** —
  1. Rule §21 the umbrella *principle* (question → confirm → automatic) and
     explicitly scope the other two as domain instances of it; add a short
     canonical statement (glossary or the rewritten DESIGN section) linking
     all three.
  2. Rule them genuinely different things (action-permission vs.
     classification-confidence vs. belief-confidence) that should *not* share
     vocabulary — document the distinction once.
- **Ruling (boxholder, 2026-07-04):** Not well filled out in the
  implementation, but it's not incorrect as a design.

### 11. §19 ("possibly the most important design area") vs. what actually shipped

- **Claim** — design.md:414: "**This is a major design area—possibly the most
  important one.**" §19 then enumerates speculative mechanisms — "Preference
  cards … Proposal cards — system creates a card saying 'I think we should do
  X' and waits for approval/rejection" (design.md:446-449).
- **Reality/tension** — the teaching relationship shipped, but through a
  different stack: personality/guide cards with `source: inferred` beliefs,
  the retro procedure (glossary.md:44), briefing cards, category rules on
  landmarks (docs/triage-design.md:51-57). There is no proposal-card schema
  (nothing in src/schemas/); "proposal" as a confidence tier (design.md:485)
  never materialized.
- **Options** —
  1. Rewrite §19 as the *rationale* for the shipped teaching stack
     (retro/personality/briefings/category-rules), preserving the "teaching,
     not configuring" framing (design.md:453) which still reads current.
  2. Same, plus explicitly rule proposal cards dead (the retro question-card
     path covers "wants user buy-in") — or park them in ideas.md.
- **Ruling (boxholder, 2026-07-04):** Also more ambition than reality, but
  still important. Not central though, clearly.

### 12. Question loop: resume-a-session or spawn-a-job?

- **Claim** — design.md:199-201 (§8): the question goes to `/box/questions/`
  "with a reference to the agent session — when it's answered with enough
  info, Claude Code can resume the session and proceed." implementation.md:536
  likewise: "The session reference in the question card tells wakeup which
  agent session to resume."
- **Reality/tension** — answered questions produce a *follow-up job*, not a
  resumed session: the question card's `directive` "creates a follow-up job"
  (docs/triage-design.md:131; `src/schemas/question-followup-job.ts`).
  Session-resume exists but is chat's mechanism, not the question loop's.
- **Options** —
  1. Rule the job model canonical; rewrite §8 (context-refs and roles at
     design.md:206-214 survive — they describe the question card well).
  2. Rule that resume-the-session is still the *desired* semantics for
     long-running interrupted work (distinct from quick directives) and open
     a design item.
- **Ruling (boxholder, 2026-07-04):** Just not filled out well enough to have
  a clear answer.

### 13. "Git is the state engine / to do something, commit it"

- **Claim** — implementation.md:12: "The filesystem is the interface, but
  **Git is the state engine**"; implementation.md:322: "The fundamental
  pattern: **to do something, commit it**." Echoed at design.md:171.
- **Reality/tension** — the architecture series deliberately reformulates:
  "The **filesystem** is the canonical store … **Git** is the canonical
  history" (02-cards-and-memory.md:96; also 02:72-77, 83-91). The code agrees
  with the reformulation: nothing is commit-*triggered*; actions run through
  reactor jobs and `bbx finalize`; commits record what happened (trailers,
  audit). "Commit as action" — validation-gated status flips driving
  execution — did not survive the command-card removal.
- **Options** —
  1. Bless "filesystem is the state, git is the history" as the canonical
     formula (glossary entry); retire "state engine"/"commit as action" as
     historical framing.
  2. Keep "git as state engine" for one narrow surviving sense (commits as
     the durable checkpoints agents reason from) and say exactly that.
- **Ruling (boxholder, 2026-07-04):** Yes, and it does do this in many cases.
  Not everything (e.g., chat messages aren't handled like this), but a lot,
  and it's an active and true guidance. Committing something makes it durable
  and real.

### 14. Provenance: invariant or aspiration?

- **Claim** — design.md:176-184 (§7): "Provenance as a first-class invariant …
  artifacts should retain **provenance** as they move through the system."
  02-cards-and-memory.md:50 leans on it: "we can require that every card
  records where its data came from … the agent is compelled to fill it in."
- **Reality/tension** — the architecture outline is more honest:
  "This is aspirational — we don't currently keep enough reference
  information to trace back like this, especially when the source was a chat
  message. But we want to." (architecture/outline.md:121). Source fields
  exist on some schemas; end-to-end traceability (action → input that caused
  it) does not.
- **Options** —
  1. Keep the invariant claim and treat the gap as a work item (schema-level
     required source fields + provenance on agent actions) — strict,
     fail-closed.
  2. Re-badge §7 as an aspiration with a statement of the current guarantee
     (commits + per-card source where schemas require it), so no doc
     over-claims.
- **Ruling (boxholder, 2026-07-04):** Aspirational, but `{% source %}` and
  `{% quote %}` do make attempts. Always can be better.

---

## D. Representation and strictness

### 15. Strict schemas vs. escape valves

- **Claim** — design.md:123-131 (§4): "Schemas should be **strict** … strict
  validation rather than 'best effort' loose parsing."
- **Reality/tension** — spirit.md:81: "Cards are validated against schemas —
  we do want them structurally sound — but schemas include escape valves,
  fields that can hold ad hoc information." 02-cards-and-memory.md:52: "Not
  every card type needs tight enforcement. Some schemas are strict about
  structure; others are mostly containers with a few required fields for
  provenance." These are reconcilable (strict *validation* of a schema that
  *includes* loose fields) but no doc says so, and each side reads as a
  correction of the other.
- **Options** —
  1. Write the synthesis once, canonically: validation is always strict
     (fail-closed), and looseness is a *schema design* choice (designated
     ad hoc/notes fields), never a parsing choice. Cite it from both docs.
  2. Rule that one emphasis wins and edit the other doc's phrasing.
- **Ruling (boxholder, 2026-07-04):** The escape valves should be clear and
  discussed (with me) and serve clear purposes. I think we've avoided too
  many escape valves. The Markdown body of a card is a kind of escape valve,
  being very freeform.

### 16. "A card is one idea" vs. instrument/husk/infrastructure cards

- **Claim** — design.md:559-560 (§24): "**A card is one idea.** The unit of
  the record is a discrete thing — a bank account, a person, a memo, a
  decision — because that's the unit of thought."
- **Reality/tension** — the current direction populates the tree with cards
  that are not domain ideas: instrument cards that "situate" code
  (interface-as-cards.md:76-80), husk cards ("The husk is the noun; the
  session is the verb," interface-as-cards.md:309), positional organs
  (`landmark.card`, `briefing.card`). interface-as-cards itself flags the
  cost: "the tree gains a population of infrastructure cards (`/proc`-like —
  acceptable if every card answers a real question…)"
  (interface-as-cards.md:48-51).
- **Options** —
  1. Extend §24 explicitly: interface/infrastructure cards are ideas too
     ("this saved view," "this conversation") and the same one-idea test
     applies — plus adopt interface-as-cards' emptiness test ("a card whose
     body stays empty … should have stayed virtual") as the guardrail.
  2. Rule §24 scoped to *domain* cards and give infrastructure cards their
     own stated justification (addressability, margin, config surface).
- **Ruling (boxholder, 2026-07-04):** True, cards serve other purposes. But
  like a chat husk is still an idea (the idea of that chat session). There's
  tensions, but this is also kind of correct.

### 17. Three definitions of "landmark"

- **Claim** — design-vision.md:7: "**Landmarks** are distinct activity centers
  within the file system—places where you go to do specific kinds of work …
  Five subdirectories that are variations on a single theme share one
  landmark."
- **Reality/tension** — the shipped definition is a role-bearing marker card:
  navigation surface and/or triage destination, one per directory
  (docs/triage-design.md:61-72; src/schemas/landmark.ts:130 — "Marks its
  directory as a notable spot — a curated navigation bookmark and/or a triage
  filing destination"). And the current direction floats dissolving it:
  "whether `landmark.card` eventually dissolves into claiming cards carrying
  a navigation/prominence role" (interface-as-cards.md:462-464).
- **Options** —
  1. Rule the role-bearing-card definition canonical now (update
     design-vision/glossary accordingly) and leave dissolution as
     interface-as-cards' open question.
  2. Rule the dissolution direction likely enough that docs should describe
     landmark as transitional vocabulary.
- **Ruling (boxholder, 2026-07-04):** I think we resolved some of this tension
  with the current implementation. The current implementation is by best
  effort for the moment (though I'm sure there will be more to be done), so
  describing it as the intended design would be correct.

---

## E. Extensibility and modality vocabulary

### 18. "Knowledge, not plugins" vs. box-authored views and skills

- **Claim** — design-vision.md:35-41: "The system's extensibility model
  prioritizes understanding and knowledge over plugin architecture … Custom
  views and interactions can be built through careful prompting and
  structured approaches, not through elaborate plugin systems."
- **Reality/tension** — the extension surface has become quite concrete:
  box-local schemas under `config/schemas/`, box skills (courseware's
  `build-course`), and interface-as-cards' extensible view tier —
  "box-authored `.tsx` views as the extensible tier"
  (interface-as-cards.md:62-64). Meanwhile activities-retrospective.md:19
  ruled *against* framework-shaped extension: "Build piecemeal features that
  different instructions can opt into." Are box views/skills the vision's
  fulfillment (compose small pieces, no marketplace) or its quiet revision
  (there *is* a plugin tier now)?
- **Options** —
  1. Restate the principle in current terms: extension = knowledge + small
     typed artifacts (schemas, skills, views) composed by the agent; "no
     plugin architecture" means no registry/marketplace/lifecycle framework —
     which activities-retrospective confirmed empirically. One canonical
     paragraph, cited from wherever design-vision's content lands.
  2. Rule that the vision has genuinely shifted and write a fresh
     extensibility statement around the box-package boundary
     (`beebox/{cards,schema,view-widgets}` imports only).
- **Ruling (boxholder, 2026-07-04):** Yes, this is actively my plan, but
  neither knowledge (wiki-style) nor plugins exist yet.

### 19. "Modes" as user-facing vocabulary

- **Claim** — design-vision.md:15-21 names composable interaction modes:
  "**Narration Mode** is listening-focused interaction … **Factual Mode**
  surfaces when Claude has something concrete to address …" plus "Chat
  Instructions" as a named triage-extension concept (design-vision.md:11).
- **Reality/tension** — the mode-container idea was built (Activities) and
  removed: "The framework was correct but premature … the unit of
  customization that emerged from real use was a feature flag plus some
  prose, not a class hierarchy" (activities-retrospective.md:17-23).
  Narration shipped as "three features and a system-prompt overlay"
  (docs/implemented-plans/narration-mode-design.md:19). Nothing in the
  current system is called a mode; "chat instructions" as a term appears
  nowhere in code or glossary.
- **Options** —
  1. Retire "mode" and "chat instructions" as vocabulary; the concepts
     survive as chat features + rules/personality prose, and any doc that
     inherits design-vision content says so.
  2. Keep "narration mode" as the *user-facing* name for that feature bundle
     (it's how the boxholder talks about it) while the docs describe it as
     composed features underneath.
- **Ruling (boxholder, 2026-07-04):** They don't surface to users, and I'm
  not sure this is the best phrasing. But then I also just added an idea
  (that I like!) about Listening Mode, so it's also kind of true.

---

## F. Cross-doc authority

### 20. spirit.md claims supremacy nothing else acknowledges

- **Claim** — spirit.md:5: "If something in the architecture contradicts
  what's written here, the architecture is wrong. … This document is the
  compass, not the map."
- **Reality/tension** — architecture/CLAUDE.md scopes spirit.md as a steering
  doc for *writing the vignette series* ("Steering docs (not user-facing)");
  design.md, CLAUDE.md, and the glossary never cite it. Yet its content
  (see-the-gears, messy-is-expected, best-stuff-comes-from-the-people,
  no-deficiency-model, it-should-feel-possible) is the closest thing to a
  values document the project has, and several rulings above (7, 14, 15)
  lean on it.
- **Options** —
  1. Promote spirit.md to the system-wide values doc (move out of
     `architecture/`, link from CLAUDE.md's Guides table); its supremacy
     claim then means what it says.
  2. Keep it scoped as the narrative series' compass; extract any principles
     the *engineering* docs should obey into design.md's successor, and
     soften spirit.md:5 to match its actual jurisdiction.
- **Ruling (boxholder, 2026-07-04):** I wrote it and meant it, but then forgot
  it even existed!

---

## The two-narratives question: proposed roles

Executed 2026-07-04 — see docs/design/. (Citations below are the historical
record; the paths they name have since moved.)

The docs-reorg survey flagged "two competing 'what is this system' narratives
… never cross-referenced" (docs/plans/docs-reorg.md:195-199) and
design-vision.md as "a thinner, staler sibling of DESIGN.md — merge or retire"
(docs-reorg.md:200). Proposal, one home per job:

- **`architecture/` series → the onboarding narrative.** The canonical
  human-facing "what is this," continued per outline.md. It is the only doc
  set that reflects the current interaction model (item 1) and it already
  marks aspiration vs. working. Rulings needed from section A/F above before
  writing more chapters (audience, item 2; spirit's authority, item 20).
- **`design.md` → the engineering-rationale reference, split into a
  subdirectory.** Per the docs-reorg Direction principle — "Long docs can
  become subdirectories of small files … split when the doc is a collection
  of separable topics (DESIGN.md's 24 sections…)" (docs-reorg.md:264-269) —
  design.md becomes `docs/design/` with one file per surviving topic. Each
  section is disposed by the rulings above: rewritten to current preference
  (§1, §12, §15, §16, §17, §19, §21), replaced by a pointer to the canonical
  doc (§2→triage-design, §6→calendar.md, §18→scheduler.md), or retired into
  the plans-taxonomy history with a one-line tombstone (§3, §9, §10, §11 as
  written). §24 (representation mirrors the idea) is current, load-bearing,
  and a good anchor file for the new directory. Peer of stack-decisions.md:
  it answers *why*, never *how to*.
- **`implementation.md` → retire into history.** It is the MVP-era build
  plan — its banner already treats it as historical, and everything still
  true in it (wakeup, connectors, schemas, questions, testing) is documented
  better in CLAUDE.md + the reference docs it predates. Salvage first: the
  filesystem-is-the-index framing (implementation.md:168), the git-replay
  testing idea (:946-953), and the open questions worth keeping (:1010-1017)
  go to reference docs or ideas.md; then move the file to the retired-plans
  home (same treatment the boxes-as-packages v1 and activities docs got).
  Its "Git as the State Engine" opening is superseded per item 13's ruling.
- **`design-vision.md` → retire, after harvesting.** Each of its five
  sections is adjudicated above (items 3, 17, 18, 19); whatever survives
  lands in `docs/design/` or the glossary, and the file moves to history
  with a pointer. It should not remain a third competing narrative.

Cross-linking either way: whatever survives as DESIGN's successor and the
architecture series should each open with a one-line pointer to the other
("narrative → architecture/; rationale → design/").

**Ruling (roles, boxholder 2026-07-04):** Approved as proposed — split
design.md into `docs/design/` rewritten per the rulings above, retire
implementation.md (after salvage) and design-vision.md (after harvest),
architecture/ carries the onboarding narrative.

---

## Appendix: mechanical fixes, no ruling needed

Factual staleness to fix in whatever text survives the rulings — listed here
so the items above stay design-only.

1. **XML residue.** design.md §3 (XML envelope, :76-104), implementation.md's
   XML examples (:200-227, :685-698), and outline.md:38 ("XML is the format
   but that's an implementation detail") — cards are YAML frontmatter +
   markdown (banners already say so; body text still teaches XML).
2. **Command-card machinery in body text.** design.md §6/§9/§20 and
   implementation.md §4/§5/§6 still teach `box/commands/`, `bbx do`,
   `bbx exec`, dry-run lifecycle — removed; reactor/jobs + `bbx finalize` is
   the action path.
3. **cardworks references.** implementation.md:101, :254, :831, :928
   ("cardworks library at `~/src/cardworks`") — package removed; primitives
   live in `src/cards/` (glossary.md:42).
4. **Tailing phase / `bbx tail`.** implementation.md:179-194, :459,
   design.md:406 — no `bbx tail` exists; scheduling is `bbx tick` +
   `<schedule>` tags (docs/scheduler.md, docs/chat-schedules.md).
5. **`agents.json` subagent config and `claude --print` invocation.**
   implementation.md:585-631 — agent invocation is the Agent SDK
   (stack-decisions Decision 12); no `agents.json`.
6. **Signal as the MVP DM channel.** implementation.md:737-754 — Telegram
   shipped instead; Signal never built.
7. **Schema location.** implementation.md:485-496 (`/config/schemas/*.schema.ts`
   with registry in the box) — schemas live in `src/schemas/` with box-local
   additions under `config/schemas/` importing `beebox/cards`.
8. **Branch strategy.** implementation.md:337-344 (`connector/*`, `agent/*`
   branches) — everything is on main; open question resolved by practice.
9. **Run modes.** implementation.md:234-239 (Triage/Process/Execute/React
   agents) — superseded by reactor batch/chat paths + triage pipeline.
10. **Combined webapp-runner.** implementation.md:802-832 — now `bbx serve`
    per box under `bbx hub`; the runner is the reactor + scheduler.
11. **Whisper/Foxtel.** design-vision.md:17 — transcription direction is
    Mistral (Voxtral, stack-decisions Decision 18).
12. **Directory table drift.** implementation.md:85-97 (`/box/commands/`,
    `/store/archive/done|failed/`) — reconcile against `docs/box-layout.md`
    (v2 package layout, `content/` root).
13. **Questions directory.** design.md:199 `/box/questions/` — verify against
    current question-card location/lifecycle before reuse in rewritten text.
14. **Trash.** design.md §2's trash-bin sketch is implemented (`bbx trash`,
    store/trash) — the rewritten section can simply cite it.
15. **Scheduling section.** design.md §18 (RRULE schedule cards + "tailing
    phase") — point at docs/scheduler.md and docs/chat-schedules.md.
16. **Meta-processes marked "future."** design.md §23 — behavior review /
    instruction distillation exists as the retro system (glossary.md:44);
    mark implemented and point.
17. **Sessions open question.** design.md §22 — resolved by practice:
    per-thread resumable chat sessions + fresh reactor batch sessions +
    retro as the meta-review; update or retire alongside item 12's ruling.
