---
title: "Place intention: a landmark says what to do next"
status: active
workstream: workspaces
issues: []
---
# Place intention: a landmark says what to do next

A landmark can carry one **intention**: a single line saying what the next piece of work in that place is, with an optional **prime card** that arrival opens. The chat agent writes it when it leaves work unfinished in a place; a daily procedure refreshes or clears it when the place changes; the person can hide it per device. The aim is that going to a place launches the person into the work there instead of showing them an overview of the folder.

**Issues addressed:** none resolved outright. Related and left open: [landmark baseline of cards](../../../issues/features/2026-09-08-landmark-scoped-pinned-card-baseline.md) (this plan opens one card, not a set), [agent hands the person into a chat](../../../issues/features/2026-10-16-agent-hands-user-into-new-chat.md) (decided against an agent turn on arrival, see Design), [chats bind to a landmark once](../../../issues/bugs/2026-08-25-chats-bind-to-a-landmark-once-and-never-move.md) (an intention written from a root-bound chat still lands on the place's landmark, since the agent names the landmark by path). Searched `issues/` for "intention": no issue describes this feature.

## Design

### Situations

- When Priya opens her writing place on Saturday morning, I want to see "Finish the second draft of the garden post; the two quotes from Tomas are in" with that draft already open beside the chat, so I can start typing instead of reading a list of files.
- When Idris opens the place for his club's website, where nothing is built any more, I want to see "Three pieces of feedback came in this week; the events page lists May" and the feedback card open, so I can do this week's maintenance without working out what it is.
- When Tomas opens the recipes place to add the soup he made tonight, I want to see nothing extra, so I can add the card. Nothing was unfinished there and the box has no idea what he is about to do.
- When Priya has decided to leave the garden post for a month, I want to close the line and not see it again on this laptop, so the place stops nagging me; if the box later writes a different line, I want to see that one.
- When Noor reads the line and it is wrong ("Reply to Bram about the invoice", but she already called him), I want to say so in the chat in her own words and have the line change, so I am not managing a field.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Unfinished writing | Show | A strip at the top of the cards pane while a chat in this place is open (above the chat on the phone), and first on the place page; the prime card opens beside the chat on arrival (desktop) | Waits to be found: it appears when the person goes there |
| Maintenance place | Show | Same; the procedure wrote the line from the open todos and inbox items under the place | Waits to be found |
| Collection place, nothing partial | Quiet | Place page as today | None |
| Closed by the person | Quiet on this device | The line is hidden; the field stays so the agent sees what it last wrote | None until the text changes |
| Wrong line | Show, then the chat corrects | The person says so in the place's chat; the agent rewrites the field | None added |

The moment is arrival. The line is never pushed anywhere else: no notification, no root-page roll-up. A place with no intention is the normal state for most places.

### Spirit

- **Serves:** *It should feel like a place* — the place remembers where you left off and has the work out on the table when you walk in. Also *the best stuff comes from the people*: an intention written from the person's own unfinished cards, todos, and questions is their work handed back, not the box's idea.
- **Risks:** *People aren't broken versions of their better selves* — a line that reads as "you still haven't done X" is a nag. Guards: the line describes the work, not the lapse; the person can close it; a place with nothing partial gets no line; the procedure may clear a line, and clearing is a normal outcome. Second risk: *don't fake things* — an agent inventing an intention. Guard: the rule says an intention names something present under the place (a card, a todo, a question, an inbox item) or something the person said; otherwise write none.

### Trust

The box writes and rewrites the field automatically. This is the rung the place summary already sits on (`src/core/agent-guide/guide.md:391-393`: *"After you add, move, or change cards in a place, update its landmark's body (the place summary) in the same turn"*), and an intention is the same kind of record: agent-written, about the place, cheap to correct. The rung below is for the person: anything they say in the chat about the line is a correction the agent applies. There is no rung above: the box never acts on an intention, it only shows it. Nothing is learned or recorded about trust here.

### When it goes wrong or does nothing

- **Wrong line.** It is one sentence on the page, with the prime card open beside it. The person says "no, I already did that" in the chat; the agent rewrites or removes the field and commits. Git history shows who wrote each version.
- **Prime card gone.** The line still shows; arrival falls back to today's target (the single entry point, else the place page); `bbx validate` reports the broken ref as a warning, like every other ref.
- **Line fails to parse** (multi-line, blank). The landmark fails lenient parse and shows as a parse warning on the Landmarks page, the same path an invalid opener takes today (`docs/landmarks.md:74`: *"an invalid opener makes the landmark fail to parse, which shows as a parse warning"*).
- **Line that was not for them.** The procedure wrote "Reply to the invoice email" from an email that merely arrived. The rule forbids it (Track C) and the restraint audit tests for it; when it happens anyway the person says so in chat or hides the line, and the correction is the next run's evidence.
- **Nothing to do.** No line, no "nothing to do here" text. The page is as it is today.
- **Procedure skipped.** The precheck exits `CHECK_SKIP` and no agent runs, the same as the openers step on a quiet box.

### Walkthrough

Friday evening Priya dictates two paragraphs for the garden post in the writing place's chat and stops. The agent puts them in `Garden_Post.doc.card`, updates the place summary as the rule says, and, because she said "I'll finish the ending tomorrow", writes `intention: { text: "Finish the *garden post*: the two paragraphs about the trellis are in, the ending is not", ref: /_content/writing/Garden_Post.doc.card }` on `Writing.landmark.card`, committing both. Saturday morning she picks "Writing" in the landmark menu. The place's most recent chat resumes. The intention line appears as a strip across the top of the cards pane, with an × at its end, because a chat bound to this place is open; it shows there whatever card is open, and on the phone above the chat. On the desktop, arrival reads `landmarks.forDir` and finds `arrival` pointing at the draft (the prime card), so the draft opens beside the chat under the strip. She reads the line and types into the draft. (Had she opened the place page itself, from a chat link or the Browse folder header, the same line would lead it.) On Sunday, Tomas sends her two quotes by email; triage files them under the writing place. Monday 06:15 the daily procedure's precheck sees commits under `_content/writing/` after the commit it last reviewed this place at, and runs the agent with the current line, the open todos and questions under the place, and the files that changed. The agent rewrites the line to mention the quotes and commits "Intentions: writing"; the validate phase checks that only that field on that landmark changed and records the reviewed commit. Nothing notifies Priya; she sees the new line when she next goes there.

## Smallest fix and budget

Smallest fix: the `intention.text` field, rendered at the top of the place page, written only by the chat agent under a guide rule. No prime card, no dismiss, no procedure. About 60 source lines and 40 test lines. It serves the writing situation when the person last left through the chat, and nothing else: the maintenance place never gets a line, a stale line stays until someone chats there, and the person cannot make one go away without editing a card.

Chosen plan, four tracks:

| Track | Source | Tests |
|---|---|---|
| A. Schema, payload, prime-card resolution, arrival target | ~90 | ~110 |
| B. Inline-only rendering, strip, place page line, dismiss | ~190 | ~150 |
| C. Agent rule and box docs | ~15 source, ~40 authored docs | knowledge audit |
| D. `intentions check|verify`, state, procedure template, schedule, migration | ~260 source, ~120 YAML template | ~160 |

About 555 source lines, 120 lines of procedure YAML, and 420 test lines, plus about 60 lines of authored docs (`docs/landmarks.md`, `box-docs/landmark-curation.md`). Not a BIG CHANGE. Revised after the plan review (2026-11-09): the review record and `verify` in Track D, the strip and inline-only renderer in Track B, and prime-card resolution in Track A each answer a finding; see those tracks. The fuller plan buys the maintenance-place situation (Track D), the "leave me alone" situation (Track B's dismiss), and "launch, don't overview" (Track A's prime card and Track B's strip), each a situation in the Design.

## Stated preferences this plan trades against

- **No prose fields on a landmark.** `docs/landmarks.md:76-78`: *"a bookmark seen hundreds of times shouldn't carry a paragraph explaining itself"*. The intention is one line about now, written to churn, and it renders on the place page and nowhere the tile is seen hundreds of times (not the menus, not the Landmarks page tiles). The doc gets a paragraph saying why this field is the exception. Boxholder decision, 2026-11-09.
- **Minimize invented concepts.** No new card type; a workspace is a landmark with an intention. Boxholder: "we can squeeze this into Landmark and only refactor later once we understand things".
- **Status over timestamps.** The todo design chose `status` over a done-date because *git history carries the timestamp* (`docs/implemented-plans/todo-annotation.md`, boxholder decisions). The intention carries no `by` or `at` field for the same reason; the procedure's gate reads git.
- **Arrange context, don't automate judgment.** The procedure runs an agent over a fixed brief and may rewrite one field; it takes no action on the intention and never notifies.
- **Engineering principle: validate at boundaries.** The field is validated at parse like `OpenerEntry` (`src/schemas/landmark.ts:96-104`), and the agent's `ref` goes through the generic broken-ref lint.
- **No agent turn on arrival.** Boxholder, 2026-11-09: "the agent doesn't have to take a turn. It's too hard, and not even necessarily the next right thing." The hands-into-chat issue stays open and separate.

## What already exists

- **Landmark schema and lightweight parse.** `src/schemas/landmark.ts:123-129` (`LandmarkNavigation`), `:170-175` (`LandmarkObject`, the lightweight reader shape), `:285-300` (`parseLandmarkFields`). Reuse: the field is added beside `navigation`, since it is not a navigation-role field (it is about the work, not the bookmark) and is read by the same lightweight readers.
- **Opener validation precedent.** `src/schemas/landmark.ts:97-104`: `OpenerEntry` refines blank and multi-line. Reuse the pattern for `intention.text`, without the 120-character cap (boxholder, 2026-11-09).
- **Payload and arrival target.** `src/webapp/trpc/routers/landmarks/payload.ts:66-73` (`arrival` doc), `:194-199` (`arrivalTarget`: root opens its page, else the single entry point, else the landmark). Reuse: `arrivalTarget` gains the prime card as its first choice below the root.
- **Client arrival.** `src/frontend/src/components/chat/workspace/WorkspaceProvider/arrival.ts:16-31` (`arrivalPlan`) and `provider.tsx:104` (`target: query.data?.landmark?.arrival`). No change: the target is whatever the payload says.
- **Place page.** `src/frontend/src/components/PlaceView/view.tsx:164-168` renders the body with `<Markdown prose="block">`; `Markdown/body.tsx:418-419` has `prose="inline"` for a span. Reuse `prose="inline"` for the line.
- **Open beside the chat.** `use-open-beside/hook.ts:19-29` (`cardTarget`, `useOpenBeside`). Reuse for the line's link to the prime card.
- **Browser-storage flag with guarded access.** `src/frontend/src/lib/stored-flag.ts` reads and writes a boolean in storage and treats every failure as off. Reuse the shape (a getter for storage, try/catch) for the dismiss key; the value is the dismissed text, not a boolean, so it is a sibling helper, not this one.
- **Broken-ref lint.** `src/core/card-lint/core/path-fields.ts:5-7`: *"The generic broken-ref walk in `card-lint.ts` finds frontmatter keys literally named `ref`/`refs`"* (the filename in that comment is stale; the walk is `src/cards/extract-refs.ts:35-50`, reported at `card-lint/core/lint-cards.ts:253-260`, confirmed by the plan review). Reuse: `intention.ref` is named `ref`, so a missing target is a lint warning with no new code. Track A's test confirms it.
- **Ref parsing.** `src/shared/ref-path/core.ts` (`parseRef`, `resolveRefPath`) is the only ref parser (`beebox/AGENTS.md`, Behavioral Notes). Reuse for prime-card resolution.
- **Procedure check/verify with saved state.** `src/core/todo/review-check/` and `review-verify.ts`, `review-state.ts`: a precheck that computes and saves the run's items, a validate that judges the committed result against them. Reuse the shape for `bbx engine intentions check|verify`.
- **Guide rule for the place summary.** `src/core/agent-guide/guide.md:391-393`. Reuse: the intention rule is the next sentence under the same rules marker.
- **Box docs.** `box-docs/landmark-curation.md` ("What goes inside one") and the schema `instructions` in `src/schemas/landmark.ts:192-264`, which generate `card-landmark.md`.
- **Gated procedure step with a marker.** `templates/procedures/process-retrospective.procedure.card:267-416` (the `openers` step): shell precheck that exits `CHECK_SKIP`, `pass-output: true`, an agent with a narrow edit permission, a validate phase that refuses to record the pass when landmark edits are uncommitted. Its scope rule is prose (`:407-411`), not a mechanical check. Reuse the step shape and the agent brief's tone; Track D's gate and verify are mechanical and per place.
- **Daily procedure schedules.** `src/core/box/structure/default-schedules.ts:103-119` (`todo-review`: daily, `notBefore: "20h"`, precheck no-ops). Reuse the shape for `refresh-intentions`.
- **Template install into existing boxes.** `src/core/install-template-file.ts:1-16`: unchanged stock copies are overwritten, customised ones are parked under `_config/_template-updates/`. A new procedure template and schedule card reach existing boxes this way. `default-schedules.ts:128` records that `question-review` was *"installed into existing boxes"*; verify the exact command path during Track D (unverified: whether a new default schedule installs on `bbx init` update alone).
- **Open todos and questions per place.** `src/core/todo/review-sweep.ts:149` (*"Every open todo the box holds, each carrying its card's summary text and its heading path"*) and `bbx todos`; questions live under `_bookkeeping/questions/`. The procedure's precheck lists them by path prefix with the existing CLI, no new query.

## Prior art (external)

No design decision here depends on an external library or service. The "intention" idea has prior art in the box's own todo design (an undated open todo is on the plate now; quiet states are explicit) and in the writing-practice research's "boneyard" finding that retrieval, not storage, is the hard part (`issues/features/2026-07-05-writing-skill.md`): an intention is a retrieval cue. Evaluated only; nothing adopted, no ACKNOWLEDGEMENTS entry.

## Ontology

- **Place** (exists): a directory with a landmark card; `docs/landmarks.md:19`.
- **Landmark card** (exists): `*.landmark.card`, `src/schemas/landmark.ts`. Roles `navigation`, `destinations`; this plan adds a top-level `intention`.
- **Intention** (new): one line of inline Markdown saying what the next work in the place is, plus an optional prime card. Identified by its landmark. It is NOT a todo (no status, no dates, not collected), NOT an opener (not a line the person sends), NOT the place summary (not "where things stand"; it is "what next"). Points at: one card (`ref`).
- **Prime card** (new name for a field, not a new thing): `intention.ref`, a box path to a card. It is the arrival target when present. It is NOT the entry point (`prominence: entry-point` is durable and about the place; the prime card is about the current work and changes). A place may have both; the prime card wins at arrival while an intention is set.
- **Arrival target** (exists): `LandmarkPayload.arrival`, `payload.ts:66-73`. Order becomes: root page at the root; else the prime card; else the single entry point; else the landmark card.
- **Place summary** (exists): the landmark body. Unchanged.
- **Dismissal** (new, client-only): the intention text a device has hidden, in `localStorage` under a key per box and landmark path. It is NOT box state and is never read by an agent.

## Tracks / scope

### Track A. Schema, payload, arrival target

**What.** Add `intention` to the landmark schema and lightweight readers, carry it on `LandmarkPayload`, and make the prime card the arrival target.

**Why.** Nothing can show or open an intention until the card can say it and the router can read it.

**Direction.**

```ts
// src/schemas/landmark.ts
export const IntentionText = z.string()
  .refine((s) => s.trim() !== "", "an intention must not be blank")
  .refine((s) => !s.includes("\n"), "an intention must be a single line");
// No Markdown-shape refinement: the renderer (Track B) shows only inline content, so a stray
// heading or list marker renders as its literal text instead of failing the card.
export const LandmarkIntention = z.preprocess(
  (v) => (typeof v === "string" ? { text: v } : v),   // a hand-written bare string means `{ text }`
  z.object({ text: IntentionText, ref: z.string().optional() }),
);
// landmarkFields gains `intention: LandmarkIntention.optional()` beside navigation/destinations.
// Serialization writes the object form.
```

`LandmarkObject` and `LightweightLandmarkObject` inherit it through `landmarkFields`. Schema `instructions` gain an `## intention` section (the text is Track C's). `createLandmarkTemplate` is unchanged: new places start without one.

```ts
// payload.ts
intention: { text: string; ref: string | null } | null;
// `text` trimmed. `ref` is the prime card RESOLVED: the box-relative path of the target when it
// parses as a ref, stays inside the box, and names an existing `*.card` file; null otherwise
// (missing, a directory, a non-card file, or an escaping path). The raw written value is not sent.
```

Resolution goes through `parseRef`/`resolveRefPath` (`src/shared/ref-path/core.ts`, the only allowed ref parser per `beebox/AGENTS.md`) and the same containment and symlink checks `resolveRefExists` (`src/core/ref-exists.ts:85-104`) applies, plus a `*.card` filename test; `resolveRefExists` alone is not enough, since it returns true for any existing path, a directory included. `arrivalTarget` takes the resolved `intention.ref` and, when `dir !== ""` and it is non-null, returns it; else the current logic. So a stale or wrong prime card falls back to today's target, and the page's Open action (Track B) shows only when the payload has a non-null `ref`. The root keeps opening its page (`front-door.md`, Track B).

**Vocabulary lock-ins.** `intention`, `intention.text`, `intention.ref`; "prime card" in docs and comments for `intention.ref`; `LandmarkPayload.intention`.

**First implementation chunk.** Schema field and refinements; `parseLandmarkFields` carries it; payload field and `arrivalTarget` change; tests in `test/core/landmark/resolve.schema.test.ts` (valid, blank, multi-line, inline Markdown kept verbatim) and a payload test for arrival order (prime card beats entry point; missing prime card falls back; root ignores it); a lint test showing a broken `intention.ref` reports a warning through the existing walk.

### Track B. The intention strip, the place page line, and dismiss

**What.** Show the intention in two places: as a strip across the top of the cards pane while a chat bound to the place is open (above the chat on the phone, where there is no cards pane), and first on the place page. One inline-Markdown line, an Open action for the prime card, and an × that hides it on this device until the text changes.

**Why.** Arrival with a prime card opens that card *instead of* the place page (`payload.ts:66-73`), so a line that lived only on the page would be hidden exactly when the prime card exists (review finding, 2026-11-09). The chat is the one surface that is present in every arrival shape: desktop with a card open, desktop with a saved arrangement, and the phone, where arrival opens nothing (`arrival.ts:29`). The dismiss is the "leave me alone" situation.

**Direction.**

- `IntentionLine` in `components/intention/`: renders `payload.intention` as inline content. Not `<Markdown prose="inline">` as it stands: that only wraps the output in a span, and a paragraph still renders a `div` (`Markdown/body.tsx:155-166`) while an image can become a video embed (`:75-82`). Instead an `inlineOnly` option on the Markdown component (or a sibling `MarkdownInline`) that renders the inline children of the first block node and shows any other node as its literal source text. Emphasis, links, code, and emoji render; headings, lists, images, and custom tags do not.
- The strip: `IntentionStrip`, mounted by the workspace layout above the cards pane on the desktop and above the transcript on the phone, when the current chat's place has a non-null `intention` and it is not dismissed. It runs its own `landmarks.forDir` query for the chat's `contextDir`, enabled for any chat bound to a place; the arrival query in `provider.tsx:94-104` is enabled only for a desktop arrival candidate and the provider exposes no landmark payload (`provider.tsx:287`), so it cannot be the strip's source (round-2 review). The query is cached by tRPC, so arrival and the strip share one request when both run. One line, the Open action, the ×. Hidden while the place page is the active card, so the line is never shown twice.
- The place page: `PlacePage` renders the same `IntentionLine` first, `data-place-section="intention"`, when not dismissed.
- Open: shown only when `payload.intention.ref !== null`; calls `useOpenBeside()` with `cardTarget(ref)` when a workspace is present, else navigates, as `LandmarkLinks` does.
- Dismiss: × labeled "Hide this until it changes" writes the current `text` under `bbx:intention-dismissed:<boxSlug>:<landmark path>`. Dismissed when the stored value equals the current trimmed text. `lib/dismissed-text.ts` with the `stored-flag.ts` guard shape; a pure `isDismissed({ stored, text })` for the test tier. Both surfaces read the same key, so one × hides both.

**Vocabulary lock-ins.** Section name `intention`; storage key prefix `bbx:intention-dismissed:`; component names `IntentionLine`, `IntentionStrip`.

**First implementation chunk.** `IntentionLine` with the inline-only rendering and its test (emphasis and link render; a leading `## ` or `- ` renders as literal text; an image renders as its source text); the dismiss helper and `isDismissed` test; the place page section and `view.place-page.test.ts` cases (line first; no `ref` means no Open; dismissed hides; new text shows). The strip is the second chunk, with a test on the layout that it appears for a chat in a place with an intention and not for a chat elsewhere.

### Track C. Agent rule and box docs

**What.** One guide rule, the schema instructions, `landmark-curation.md`, and `docs/landmarks.md`.

**Why.** Without the rule nothing writes an intention from a chat, which is the most accurate source (the agent that left the work partial).

**Direction.** Under the `landmarks.summary-on-change` marker in `src/core/agent-guide/guide.md`, a new `landmarks.intention` rule:

> When the person leaves work in a place unfinished, or finishes what its intention named, set or clear the landmark's `intention` in the same turn: one line, in the person's terms, saying what the next step is, with `ref` on the card that step happens in. An intention is a track the person is already on. Write one only from evidence of that: something they said they would do, a draft they were editing, a todo or question of theirs, or the standing job of a place that exists to process what arrives (its destination rules say so). A card merely being present, incomplete, or newly arrived is not an intention; work the person set aside on purpose is not either. With no such evidence, remove the field. When the person tells you the line is wrong, change it.

Schema `instructions` gain the field's shape and the same rule in brief. `landmark-curation.md` "What goes inside one" gains an **Intention** bullet. `docs/landmarks.md` gains a section "The intention" with the field, the arrival change, the dismiss, the procedure, and the exception to "no prose fields".

**Vocabulary lock-ins.** Rule id `landmarks.intention`.

**First implementation chunk.** All of the above plus a `knows_directly` knowledge audit (see below). Docs ship with the code that makes them true, so this chunk follows A and B.

### Track D. Daily `refresh-intentions` procedure and schedule

**What.** A stock procedure template with one step: a precheck that lists places with commits since the procedure last reviewed them, an agent that rewrites or clears each listed place's `intention`, and a validate phase that checks the committed diff touched nothing else and then records the reviewed commit per place. A default daily schedule, installed into existing boxes by a migration.

**Why.** The maintenance-place situation: items arrive by triage, not by chat, so no chat agent is there to write the line. And a line left by a chat goes stale when the place changes afterward.

**Direction.** `templates/procedures/refresh-intentions.procedure.card`, with `bbx engine intentions check` and `bbx engine intentions verify` as its precheck and validate, the shape `todo-review` uses (`src/core/todo/review-check/`, `review-verify.ts`). The state file is `.beebox/intentions/reviewed.json`: `{ [landmarkPath]: reviewedCommit }`, plus the run's baseline `HEAD` and listed places while a run is open, the same role `review-state.ts` plays for todos.

- **Gate (`check`).** For every `*.landmark.card` outside `.beebox/` and `_config/_template-updates/`: `from` is the place's recorded `reviewedCommit`, else none. A place is listed when it has no record (never reviewed: this is the kickoff), when `git log <from>..HEAD --name-only -- <dir>` is non-empty, or when its `intention.ref` no longer resolves. The landmark's own commits count as changes to the place too, since a summary rewrite is new evidence; what closes the gate is the review record, never a landmark edit. This replaces the first draft's "changed since the landmark's last commit" gate, which could not converge: a run that correctly changed nothing left the place listed every day, and any unrelated landmark edit silently closed it (review finding, 2026-11-09). Exit `CHECK_SKIP` when nothing is listed. Otherwise save the baseline and the list, and print per place: the landmark card, the changed paths (capped), `bbx todos` for the directory, question cards referring to a card under it, and the ten most recently changed cards' titles. `pass-output: true`.
- **Agent.** Rewrite or remove `intention` on the listed landmarks only. The rule text from Track C, plus: "Prefer the current line's wording when it still holds. Stage only the landmarks you edited, by path; commit `Intentions: <places>` with `Created-By: refresh-intentions`. Changing nothing is a normal outcome; say so and do not commit." `max-turns: 15`.
- **Verify (`verify`).** The procedure's own commits are those in `<baseline>..HEAD` carrying the `Created-By: refresh-intentions` trailer; other commits in that range (a chat agent working at the same time) are not judged, so an unrelated concurrent commit does not fail the run. Fails, so the next day retries, when: landmark files are dirty; a procedure commit touches a path outside the listed landmarks; or for a listed landmark, the two versions differ anywhere but the `intention` key. The comparison is on the raw frontmatter mapping (every key, unknown ones included, with `intention` removed) and on the body text separately: `parseLandmarkFields` reads frontmatter only (`src/schemas/landmark.ts:285-300`) and strips unknown keys, so it is not the comparator. On success, set `reviewedCommit = HEAD` for every listed place, changed or not, and clear the open run. This is detection after the commit, not prevention: an out-of-scope edit is reported by the run's failure and stays in history for the person to see.
- **Schedule.** `default-schedules.ts`: `refresh-intentions`, `cron: "15 6 * * *"`, `notBefore: "20h"`, `enabled: true`, `timeout: "30m"`, `runs: "bbx procedure run refresh-intentions"`, reason "Daily early-morning pass; precheck no-ops when no place has changed since its last review".
- **Install and kickoff.** No migration. `generateDocs` runs `syncTemplatesFromSource` (`src/core/docs-gen/generate/core.ts:243-254`), which calls `installProcedures` and `installSchedules` whenever the engine version changes; that is how `question-review` reached existing boxes (commit b43325339). The plan's first draft said only `bbx init` installs schedules, which was wrong (Track D implementation, 2026-11-09). `test/core/docs-gen/generate.refresh-intentions.test.ts` starts from a box with neither card and checks both are installed and committed. The kickoff is then by construction: on the first run every place has no review record, so every place is listed once, and the agent writes a line where the evidence rule is met and nothing elsewhere. No "kickoff done" state beyond the per-place record.

**Vocabulary lock-ins.** Procedure name `refresh-intentions`; `bbx engine intentions check|verify`; state file `.beebox/intentions/reviewed.json`; commit subject `Intentions: …`; trailer value `Created-By: refresh-intentions`.

**First implementation chunk.** `check` and `verify` with their state module, tests on a scenario box: never-reviewed places are all listed; a reviewed place with no later commits is not; a later commit to a card lists it; a later commit to the landmark alone lists it; a no-change run still records the review; `verify` fails on a procedure commit that edits another card, a landmark body, or an unknown frontmatter key, and passes when an unrelated non-procedure commit lands during the run; the "together" commit case lists nothing after review. Then the template card and the schedule entry; then the migration entry installing both, with the test the migration runbook requires.

## Could this be simpler?

Simplest version that meets the boxholder's stated requirements (field, prime card, inline Markdown, local dismiss, kickoff): Tracks A, B, and C, with the kickoff done once by hand (an agent asked to write intentions for every place) and no daily procedure. It works for a person who leaves a place through its chat; a line goes stale only when the place changes by triage or by another chat.

What Track D buys: the maintenance-place situation, where no chat agent is present to write the line, and the clearing of lines left behind. Without it an intention is right once and then wrong until someone chats there, which is the todo design's "graveyard" failure applied to one line. Within Track D, the review record and `verify` are what make the daily run converge and keep its edits in scope; the first draft without them could not do either (plan review, 2026-11-09).

Dropped as over-build: an agent turn on arrival (boxholder decision); a `by`/`at` field (git carries it); a set of cards instead of one prime card (the baseline issue, separate); a root-page roll-up of every place's intention (no situation asked for it); a new query for "partial cards" (the agent judges from the listed material).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `intention.text` is multi-line or blank | Track A schema test | Lenient parse returns null; landmark shows as a parse problem | Clear: Landmarks page problem row, as for openers |
| `intention.ref` points at a moved or deleted card, a directory, or a non-card file | Track A payload tests (deleted, directory, relative form) and lint test | Payload `ref` is null; arrival falls back to today's target; the line shows without Open; `bbx validate` warns on a missing target | Clear |
| `intention.ref` is written relative, or without the leading `/` | Track A | Same resolution as `links[].ref` (relative to the landmark dir still resolves) | Clear if broken, else fine |
| Arrival opens the prime card over a card the person had open | existing: `arrivalPlan` returns `[]` when `tabCount > 0` | Yes, `arrival.ts:27` | Fine |
| The person dismissed, the agent rewrote with the same text | Track B `isDismissed` test | Stays hidden by design: same text, same decision | Documented |
| Storage unavailable (private mode) | Track B helper test | Dismiss lives for this page load only | Silent by design, as `stored-flag.ts` |
| Chat agent writes an intention for work the person did not mention | Knowledge audit (Track C) | Rule forbids; nothing mechanical | Visible on the page; corrected in chat |
| Procedure agent edits a card other than a listed landmark, or another field of a listed one | Track D `verify` tests | `verify` compares the committed diff against the listed paths and the parsed fields | Clear: run fails and retries; the edit stays in history for the person to see |
| Procedure lists a place every day (gate does not converge) | Track D `check` tests (no-change run) | The review record closes the gate whether or not the agent edited | Visible in run logs |
| Two writers: the person corrects the line in chat while the morning procedure runs on the same landmark | none | None. The procedure's agent may have read the old line and write over the correction. Git serializes the commits, not the reads (`src/lib/git-lock.ts`), so "later writer sees newer text" does not hold | Accepted risk, see Open design questions: the window is one morning run against a live chat in the same place, the result is visible on the strip, and the person corrects it again |
| Landmark never committed (new place, dirty tree) | Track D `check` test | No review record, so listed; the agent writes or leaves none | Clear |
| Markdown in the line is block-shaped (a heading, a list, an image) | Track B `IntentionLine` test | Inline-only rendering shows the node as its literal text | Visible as odd text on the strip; the agent or person rewrites it |

No critical gap: every row has either a test or handling, and none fails silently in a way the person cannot see on the page.

## Agent-flow / user-flow edge cases

- **Wrong field.** The agent writes the next step into the place summary (body) or as an opener instead of `intention`. ADDRESSED by the rule text naming the field and by the knowledge audit; the summary rule and the intention rule sit together so the distinction is read in one place.
- **Stale ref.** ADDRESSED: fallback in `arrivalTarget`, lint warning, and Track D's precheck lists a place whose prime card is gone.
- **Two agents touching the same card.** DEFERRED as an accepted risk, see Failure modes and Open design questions: a morning procedure run can overwrite a correction made in chat during the same minutes. A conditional write (apply only if the landmark is unchanged since `check` read it) is the remedy if this is not acceptable.
- **Hand-edit drift.** The boxholder writes `intention: Finish the post` (a string, not an object). ADDRESSED in Track A: the schema accepts a bare string as `{ text }` and serializes the object form.
- **Fabricated free-form value.** The design makes honesty easy: the line may quote a card title or todo text verbatim; the rule requires a present referent. Not mechanically enforced.
- **Validation error UX.** "an intention must be a single line" reads well in `bbx validate` output and in the Landmarks page problem row.
- **Partial migration.** No data shape changes; a box without the procedure installed simply has chat-written intentions only. A parked template update (customised `_config/schedules/`) is reported by the existing parked-template health check.

## NOT in scope

- An agent turn on arrival or a hand-off into a new chat: boxholder decision; the hands-into-chat issue stays open.
- Restoring a set of cards on arrival: the baseline issue; this plan opens one.
- Showing intentions on the Landmarks page tiles, the landmark menu, or the root page: no situation asked for it, and the tiles are the surface the "no prose fields" rule protects.
- Notifying about an intention: the moment is arrival, nothing else.
- A per-box or per-person dismiss stored in the box: the boxholder asked for local storage; box state would be a card edit the agent sees.
- Preventing an out-of-scope edit by the procedure's agent: `verify` detects it after the commit and fails the run; prevention would need a write path the agent cannot bypass, which no procedure has today.
- Running the intention refresh on `bbx wakeup` after triage files into a place: daily is the agreed cadence.
- Fixing chat-to-landmark binding: separate bug; the intention lands on the landmark by path regardless of which chat wrote it.
- A "partial work" detector: the agent judges from the listed material; a heuristic here is the kind of automated judgment the box avoids.
- Emoji or theming of the line beyond inline Markdown: the body is where richer content goes (boxholder).

## Open design questions

- **Should the page hide the "Start here" tier while an intention with a prime card is set?** Lean: no. The line is first and the card is already open; the tiers below are still the place. Revisit after use.
- **Should the procedure also run on `bbx wakeup` when triage filed into a place?** Lean: no for now; daily is the agreed cadence and a same-day line is not required by any situation.
- **Where the strip lives on the desktop.** Lean: a one-line strip across the top of the cards pane, present for any chat bound to the place, hidden while the place page itself is the active card. Alternative: a line inside the chat transcript header. Decide before Track B's second chunk. **Human decision required** (review finding 2).
- **Procedure overwriting a same-morning correction.** Lean: accept and document. `verify` can only detect it afterwards (a non-procedure commit touched a listed landmark inside the run) and fail the run so the person sees it; it cannot protect the correction, since it runs after the agent's commit. Real protection is a pre-write conditional update: the agent writes the field through a `bbx` verb that refuses when the landmark's content hash differs from the one `check` recorded. That is a new write path and is not in this plan unless chosen. **Human decision required** (review finding 5, round-2 fresh finding 1).
- **Is a per-place review record in `.beebox/intentions/` acceptable state?** It is the same kind the openers step (`.beebox/retro/openers-last-run`) and todo review (`review-state.ts`) keep: operational, not box content, not committed. Lean: yes. **Human decision required** (review finding 1).

## Knowledge audits

Two `knows_directly` entries in `src/dev/knowledge-audits.yaml`, both landed RUN against the worktree test1 clone with status recorded:

- `landmark-intention`: "You just put two paragraphs the person dictated into a draft card in a place and they said they'd finish it tomorrow. What, besides the card, do you update on the landmark, and what goes where (summary vs intention vs openers)?" `watch_for`: names `intention` with `text` and `ref`, keeps "where things stand" in the body, does not add an opener.
- `landmark-intention-restraint`: "Three things sit under a place: an email that arrived asking the person for a favor, a recipe they saved months ago and never cooked, and a draft they told you last week to leave alone for now. Does the place get an intention? Say which, if any, and why." `watch_for`: writes none; names that presence, incompleteness, and arrival are not evidence of a chosen track, and that set-aside work is excluded.

## What will hold this after it ships

- Schema and arrival order: unit tier, `test/core/landmark/resolve.schema.test.ts` and a payload test; cheap.
- Page rendering and dismiss: the existing `PlaceView` static-render tests; `isDismissed` as a pure function so the decision is tested without storage.
- The procedure's gate: a scenario-box test around the precheck shell, the same tier the openers step would use; the agent step itself is not unit-tested, its validate phase is.
- The chat agent's behavior: the knowledge audit, rerun when the guide changes.
- No new test tier and no mock.

## Implementation order

1. Track A (schema, payload, arrival), with tests. Depends on nothing.
2. Track B (page line, dismiss), with tests. Depends on A's payload field.
3. Track C (rule, instructions, box docs, `docs/landmarks.md`, knowledge audit run). Depends on A and B being true.
4. Track D (`check`/`verify` and state, procedure template, default schedule, migration entry). Depends on C's rule text.
5. Cross-model review of the branch; CODING_FEEDBACK entry at `plan-reviewed` after the plan review and again at the branch review.

## Rollout shape

Tests first per track, named above; done-when is those tests passing plus `pnpm typecheck`, `pnpm lint:changed`, `pnpm layout-check`. Both knowledge audits land run. The card field is additive and optional, so no card migration. The `refresh-intentions` procedure and schedule reach existing boxes through the docs-generation template sync on the next engine version change; the first run reviews every place once, which is the kickoff. A box whose schedule cards are customised sees the parked update in health, as today. Ships as one piece when the boxholder says so.
