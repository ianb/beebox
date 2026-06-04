# Triage — Design

Status: early notes, design in progress.

## Motivation

The system already does triage in several places — capture sessions sort voice-in to a card type; the inbox processor decides where an unknown item belongs. Each path was built ad hoc for its own input shape. There is no shared notion of "triage" as a thing the box does, no shared substrate for categories, and no consistent way to handle the cases triage doesn't resolve cleanly.

As use expands to new input types — calendar events, emails, share-sheet pastes from arbitrary apps — the lack of a formal system shows up as:

- Categories invented ad hoc per pipeline, with overlap and drift.
- Items that don't fit cleanly get force-fit or silently land in `inbox/unhandled/`.
- Ambiguity (this looks like a memo *or* a todo) handled by the categorizer guessing, with no record that it guessed.
- No back-pressure to the boxholder when the category set itself is the problem.

A formal triage system would name the operation, define what a category is, and give the box a consistent way to handle low-confidence cases.

## Three stages: intake → triage → handle

The pipeline has three named stages. Items move through them in order:

1. **Intake** — enhance content, in place. Transcription, OCR, EXIF extraction, format normalization (including filenames). May delete (filter junk), combine (group related items), or explode (split one into many). Does *not* decide where the item goes.

2. **Triage** — decide what process should handle the item, and move it to a holding location for that process. Reads the category rules, picks a category, moves the item. The destination of triage is still *not* the final resting place — it's a per-category holding spot.

3. **Handle** — run the procedure called for by the category. May move to a subdirectory, merge into another file, schedule a follow-up, etc. This is where the item reaches its final state for this cycle.

Each stage is materialized in the filesystem (see §Batching), so each is interruptible and observable. A given wakeup pass can run any subset; items that finish intake but not triage just sit there until the next pass.

## Design tensions

The five things this design has to answer for, framed as the boxholder originally posed them.

### 1. New categories appear as use expands

New inputs will need new categories (book recommendations from chat, recipes from photos, receipts from emails). The system must (a) tolerate items that fit no existing category, (b) make it cheap to introduce a new one, and (c) signal to the boxholder when the existing set is straining rather than papering over it.

**The category list is distributed by marker files.** Each category is a single landmark card that lives at its destination directory; the category set is "every landmark with a `<triage-destination>` role in the box," discovered by glob. Dropping a new card adds a category. No central registry to keep in sync. See §3 for the artifact shape.

The two possible workflows for introducing one are still live:

- **Promotion from unhandled.** Items the categorizer can't place accumulate; the boxholder eventually drops a landmark with `<triage-destination>`; future items route there.
- **Inline proposal.** The triage agent proposes a category mid-run and leaves a note for review; the proposal sticks if the boxholder doesn't override.

### 2. Ambiguity, and what we want to learn from it

Even a well-defined category accrues edge cases. When the categorizer is unsure, the goal is **to extract a general rule**, not to accumulate examples.

If the agent had to ask a question, it means the rules currently in place didn't suffice. The right follow-up isn't "remember this specific item as a labeled example" — it's "what general rule would have made the answer obvious?" Sometimes the boxholder's answer is genuinely a one-off; mostly it's a small principle the agent could have applied if it had been written down ("anything from this sender is a receipt," "photos with text in them go to documents, not photos").

Direction:

- Categories carry **rules** (prose, addressable to the agent) plus, optionally, **applied examples** that illustrate how a rule resolved a tricky case. Bare unlabeled examples are bounded — useful as memory, but not the main mechanism.
- A low-confidence answer feeds back into a category's rules before the next pass, not (only) as a labeled exemplar.
- The category card grows. When rules contradict or accumulate noisily, that's a signal for the boxholder to review the category.

*Pinned for later:* how is the rule update performed? Direct edit by the answering pass, an agent that proposes a diff for review, or a separate "rules update" question kind? First implementation will land items into categories without auto-updating rules; the boxholder edits the category card by hand when a pattern emerges.

### 3. The landmark card (extended)

A category is not just a label — it's a *named spot in the box* that carries rules for triaging into it and a procedure for handling its contents. Rather than introduce a new card type, **landmarks are extended** to carry the new role.

**One card, multiple roles.** Today's landmark (a hand-curated bookmark for human navigation) and a triage destination (a named routing target for the categorizer) are both "a directory the system cares about, with metadata." The landmark card grows **role-bearing child elements** — each wrapping the fields for that role:

- `<navigation>` — human-facing: label, symbol, pinned links, expands. (What the current landmark schema carries today, lifted into this wrapper.)
- `<triage-destination>` — agent-facing: rules, applied examples, handler procedure.

A landmark must have at least one role and can have any combination. A recipes directory might be `<navigation>` + `<triage-destination>` (shows on the Landmarks page, receives triaged recipe items). A pure routing target — an archive humans don't browse — might be `<triage-destination>` only.

Chat-target metadata is out of scope for the first pass; if it becomes a role later it slots in as another child element next to these two.

**Discovery: glob, filter by role.** `**/*.landmark.card` finds all landmarks; triage filters to cards with `<triage-destination>`; the Landmarks UI filters to ones with `<navigation>`.

Why "at the destination" rather than "in config":

- The card and the directory are the same fact. Editing the rubric and seeing what's in the bucket are one action.
- Moving a spot = moving its card = moving its directory. No registry to sync.
- The destination is already named (it's the filesystem path). The card just *labels* a tree location with its roles.

The compiled triage-instructions doc the categorizer reads is built by globbing across the box, filtering to cards with `<triage-destination>`, and pulling the rules and examples out.

**A triage category IS a card type.** Each triage-destination corresponds to the card type that lives in its directory. The landmark's "what kind of item" *is* the type. This unifies what could have been two parallel taxonomies (card schemas vs. triage categories) into one.

**The handler is a procedure** — but it runs at the *handle* stage, not as part of triage. The `<triage-destination>` carries the procedure (or a `ref` to one); the triage stage uses the landmark's *rules* to route; the handle stage uses its *procedure* to run. Same artifact, two consumers. Two carriage options:

- **Inline.** Procedure steps live inside `<triage-destination>`. One artifact per category — unified editable surface.
- **By reference.** `<procedure ref="..."/>` inside `<triage-destination>`. Reuses the existing procedure-running machinery directly, lets one procedure serve multiple categories, lets the handler grow without bloating the landmark.

Both are reasonable. The `ref` form is implementation-cheaper (the engine already runs procedure cards as-is). The inline form is editorially nicer. Likely shape: support both, default to inline, with `ref` available for genuine reuse — and the inline form can desugar to "an inline procedure card embedded in the landmark" so the engine doesn't need two code paths.

The handler procedure receives the bucket of files as input — likely as an env variable (`$TRIAGE_ITEMS` containing null-delimited filenames) for shell steps. Filenames are normalized at intake (no spaces, no special characters), so quoting hazards stay manageable.

**Relationship to `briefing.briefing.card`.** Briefings remain separate — they're agent-facing per-directory context for any agent working in that area, not a named spot with discoverable roles. A directory can have a landmark *and* a briefing card; they answer different questions ("what roles does this spot play?" vs. "what should an agent know when working here?").

### 4. Comparable: Projects in Claude / ChatGPT

The hosted assistants have "Projects" (Claude) and project-level instructions / Custom GPTs (ChatGPT). Useful overlap:

- Named buckets, each with its own instructions and context.
- A lightweight surface for the user to see and edit the bucket list.
- Items/conversations scoped to a bucket inherit its setup.

Worth borrowing: a category should be a *single artifact the boxholder can read and edit in one place*, not state scattered across prompts and code.

Differences to keep in mind:

- Our categories are routing destinations with concrete downstream processes — a category exists to *do something* with an item, not just to scope context.
- Items arrive from many channels (connectors, capture, chat), not just from a user picking a project at compose-time.
- Categorization is automatic by default; the boxholder corrects rather than chooses.

### 5. Confidence, and the question system

**Confidence is a small set of named levels, not a number.** Numeric confidence is a lie — the categorizer doesn't actually compute calibrated probabilities, and acting on `0.6` vs. `0.7` invites false precision. Levels are defined by what they let the pipeline do without waiting for review:

- **confident** — pipeline proceeds. No marker. "Confident" rather than "certain": the agent doesn't need to be 100% sure to act — just sure enough that flagging would be noise. Most successful triages are this.
- **probable** — pipeline proceeds, with a marker for review. Same action as `confident`, but the boxholder is told "this one was a judgment call — you may want to look back." Retrospective, not gating.
- **guess** — pipeline blocks. Item moves to the unsure holding spot, a question is raised, and nothing further happens for this item until the boxholder answers.

"Wrong" is not a level. The agent doesn't file items it considers wrong — those go to the holding spot.

Two distinct cuts:

- `confident` vs. `probable`: whether a marker is left for review. Both let the work proceed; only one is auditable as a judgment call.
- `probable` vs. `guess`: the review gate. `guess` is the only level that stops the pipeline pending the boxholder's answer.

**Low-confidence handling: a holding spot + a question.** When the categorizer can't (or shouldn't) commit, the items move to a holding spot, and a question references them. After the boxholder answers, a **second categorization pass** runs:

1. Optionally update the relevant category's rules — the answer often reveals a missing rule (§2).
2. Place the held items into their categories. The answer might be distributive ("the first two go in photos, the second two in finance"), so this is not an automatable "apply the same answer to all items" step — it's an explicit re-placement guided by the answer.

This is the case the question system is *for*. The current question card design covers `select`, `text`, `confirm` with a `directive` that creates a follow-up job. Triage will push on it — needing to address multiple items at once, needing to carry both a rule-update and a placement instruction in one answer. **Evolve the question system to fit this case**; don't work around its limits. This is the most demanding use of questions we're going to build; if it works here, it's working.

Open: does the second-pass placement need its own agent invocation, or can a simpler script handle "the answer told me where each item goes; move them"?

## Intake (stage 1)

Some incoming items need work *before* a category can be assigned: voice memos need transcription, photos might want EXIF extraction, screenshots want OCR. Filenames usually need normalization (no spaces, no special characters — shell-quoting hazards are too persistent to live with).

Properties:

- **No taxonomy decisions.** Intake never decides destination.
- **Shape changes are allowed.** Deletion (filter junk), combination (group related items), explosion (split one into many) are intake operations — they shape content, they don't categorize it.
- **Filename normalization belongs here.** Strip spaces and special characters at intake, before any downstream code has to escape them.

**Intake is a directory: `inbox/intake/`.** Items arrive there (or get moved there immediately on inbox arrival). The intake stage scans the directory and, for each item, runs any intake step whose precondition matches.

This works because **intake-step preconditions are fast** even when the step itself is heavy. Telling whether an image needs OCR ("does the card lack a `<transcription>` element?") is cheap; running the OCR is not. So repeatedly scanning `inbox/intake/` and checking "is there work to do here?" is cheap, and idempotent — applying the same intake pass twice is a no-op on items that are already done.

**Intake-complete items move out before triage runs.** When all applicable intake steps' preconditions are false for an item, intake moves it out of `inbox/intake/` into a triage staging spot (working name: `inbox/staged/`). Triage reads from that staging spot. Two reasons the move matters: (1) the boundary between "still being prepared" and "ready to categorize" is visible in the filesystem, and (2) triage doesn't have to re-check intake preconditions on every pass.

Some current intake work (transcription, the early steps of capture-session sort) fits this frame and could be reframed as intake. Worth a pass.

**Photo and PDF canonicalization is an intake step.** Raw phone images (HEIC/JPEG) arrive in `inbox/intake/`, get transcoded to AVIF, have metadata preserved and enriched, and are uploaded to the blob store before the card is committed to git. The original bytes never enter git history — only the finished card does. PDFs get similar treatment (Ghostscript compression, metadata preservation). See `docs/photo-storage-investigation.md` for details on format choices, compression, and the blob store design.

## Triage (stage 2)

Triage is the named categorization step. It reads the compiled triage-instructions doc (built from all landmarks with `<triage-destination>`), examines the batch of intake-complete items sitting in `inbox/staged/`, and for each item: assigns a category at a given confidence level, then moves the item accordingly.

For `certain` / `probable` items: move into the category's holding spot — `inbox/triaged/<category>/` (working name).

For `guess` items: move into the low-confidence holding spot — `inbox/triaged/_unsure/` (working name) — and create a question card referencing them. The same triage pass can produce a mix of confident and unsure results in a single batch.

### Surface

A named triage agent. Candidates:

- **Subagent.** Invoked with the batch plus the compiled triage instructions as system prompt. Returns a structured result per item: category, confidence level, optional question draft. Matches the existing pattern of small focused subagents.
- **Procedure.** A procedure card with explicit steps. More visible to the boxholder, heavier for one classification operation.
- **CLI command.** `cb triage <items>` as a thin wrapper around one of the above. Beyond inbox processing this is useful for: testing the triage live, introspecting how a specific item categorizes, re-triaging items that need a second look, and chaining — a handler procedure can call `cb triage` after processing items to send them back through the system. Probably matches how other subagents are exposed.

Working direction: subagent invoked by `cb triage` wrapper.

Open:

- Does the same agent both classify *and* create the question card, or is question-creation a separate pass?
- Does the agent read only the compiled doc, or also pull in per-category rules cards when those rules are richer than the index?

### Compiled doc as decision tree

The current direction has the compiled triage-instructions doc as (roughly) a flat list of category cards. A richer form is worth considering: a *decision tree* — an organized set of disambiguating questions that distinguish the categories from each other, not just a list of "here's category A, here's category B." Questions like "external counterparty?" / "deadline?" / "single-action vs. multi-step?" structure the routing so the agent traverses a tree rather than pattern-matching against a flat list.

Why a tree probably outperforms a flat list:

- The agent's classification quality degrades when many similar-looking categories sit side-by-side in the prompt. A tree forces commitment at each level (the disambiguating question) rather than vibe-matching across the whole set.
- The tree surfaces *which axes the categories actually differ on*, which is itself useful — flat lists hide the structure.
- When new categories are added, the tree-builder can identify where they slot in or whether they require a new axis, flagging conflicts that flat-list compilation misses.

The tree can't be hand-written (categories are dynamic, distributed via marker cards) and can't be trivially compiled (categories don't carry explicit "I differ from X by Y" metadata). It probably requires an **agent pass after assembly of the destinations** — read all category cards, synthesize a disambiguating decision tree, write it as the compiled instructions doc. The pass runs whenever categories change, not per-triage.

Open questions:
- What's the output shape — a literal tree (nested questions), an ordered set of questions with a category-match-matrix, or both?
- Does the boxholder review the tree before it's used? (Probably yes initially — the agent's read of "what distinguishes these categories" can miss the boxholder's actual intent.)
- How does the tree handle items that don't fit any path? (Falls through to `_unsure` as before.)

## Handle (stage 3)

The name stays generic on purpose. `deliver` was considered and rejected — it implies the item might leave the box, which isn't true: handle outputs usually stay in the box's filesystem (archive directories, merged collections, etc.).

Handle is whatever the category's procedure does. Properties:

- **Procedure-driven.** Reads from the category card (inline or via `ref`).
- **Operates on the holding spot's bucket.** Receives the file list (via `$TRIAGE_ITEMS` env var or similar — see §3).
- **Final-state moves are handler-specific.** A receipts handler might move items to `archive/receipts/<year>/`; a recipes handler might re-render the recipe collection; a calendar-event handler might create a follow-up question and leave the item where it is.

The handle stage is where the system's "do something useful with this kind of thing" knowledge lives. Triage is dumb compared to it — triage just routes.

**Recursive triage falls out for free.** A handler can choose to move some items back to an inbox subdirectory (or call `cb triage` directly on them); the next wakeup picks them up. Useful when category A's handler decides that some items it received are actually category B's problem.

## Batching

The typical case is many items arriving together and going through together. Batching is the default — single-item is N=1.

**Each stage is materialized in the filesystem and interruptible.** Items at each stage live in a known location:

| Stage | Location | Meaning |
|---|---|---|
| Pre/in intake | `inbox/intake/` | Just arrived; intake stage operates here, scanning for items with applicable intake steps. |
| Post-intake / pre-triage | `inbox/staged/` | Intake-complete, ready for triage. Items are moved here by intake when all applicable steps' preconditions are false. |
| Post-triage / pre-handle | `inbox/triaged/<category>/` | Categorized, awaiting handle. |
| Low-confidence | `inbox/triaged/_unsure/` | Held, paired with a question card. |
| Post-handle | wherever the handler put them | Done. |

A crash mid-handler doesn't lose the categorization work — items still sit in `inbox/triaged/<category>/` and can be picked up again.

Two levels of batching:

- **Triage-time.** Multiple intake-complete items in one categorizer pass, sorted into K buckets. Reuses one model call.
- **Handle-time.** Each category's procedure runs once over its holding spot. The procedure receives the file list and iterates as it needs to.

Not building question-card batching (one multi-confirm card covering many uncertain items) yet — the triage pass already batches incoming items into one categorization run; if some of those need questions, the question-system evolution (§5) can decide how to group them later.

Implications:

- **Cadence fits wakeup.** Wakeup → intake → triage → per-category handle → done.
- **Per-item failure inside a handler.** A handler operating on a bucket needs a clear story for "succeeded on items 1–6, failed on item 7." Likely a per-item subloop within the procedure step.

Open:

- Per-category batch-size limits — does a category with 500 items run as one handler invocation, or chunk?

## Existing triage points to inventory

These exist in some form. The new system has to either replace them or coexist:

- **Capture session sort** — voice-in → card type. Likely subsumed by intake + triage.
- **Inbox processor** — wakeup agent routes unknown items. Subsumed by triage.
- **Calendar review** — event triage (action needed / FYI / ignore). Partly aligned; the categories map to triage destinations.
- **Feedback intake** — `inbox/feedback/` integration into briefings and guides. Probably fits.

## Open questions

1. **Granularity** — *Resolved: box-wide.* The system is aware of how content came in (channel: gmail, voice, share-sheet, etc.) and category rules can reference channel. Channel is metadata, not a separate categorization axis.
2. **Category storage** — *Resolved: landmark cards, extended.* The existing `*.landmark.card` type carries the new `<triage-destination>` role alongside `<navigation>`. One landmark per spot, living at its directory, discovered by glob (`**/*.landmark.card`). Triage filters to cards with `<triage-destination>` child. Compiled into the triage-instructions doc on demand. Existing landmarks get their current fields wrapped in `<navigation>` during migration. `<chat>` deferred. Open: compilation cadence.
3. **Categorizer surface** — working direction: subagent + `cb triage` wrapper. Confirm against how other subagents are exposed.
4. **Rules vs. examples accumulation** — confirmed-answer flow updates *rules* in the category card; bare examples are bounded. *Pinned for later:* how the rule update is performed (direct edit, diff-for-review, separate question kind). First implementation lands items into categories without auto-updating rules; boxholder edits the landmark by hand.
5. **Confidence levels** — *Resolved.* Named: `confident`, `probable`, `guess`. No `wrong`. No numbers. The `confident`/`probable` distinction is behavioral (note-for-review or not), not gradient.
6. **Holding spot layout** — *Resolved (working):* `inbox/triaged/<category>/` for category buckets, `inbox/triaged/_unsure/` for low-confidence.
7. **Intake staging** — *Resolved: `inbox/intake/` is a directory.* Intake scans it, runs steps with cheap preconditions, items leave when intake-complete. Intake-complete items move to `inbox/staged/` before triage looks at them.
8. **Stage 3 name** — *Resolved: `handle`.* `deliver` was considered and rejected — it implies the item might leave the box.
9. **Unhandled lifecycle** — *pinned for later.* How long items linger before triggering a category-proposal review, what evicts them.
10. **Relationship to schemas** — *Resolved: a triage category is a card type.* The destination card's type *is* the category. No parallel taxonomy.
