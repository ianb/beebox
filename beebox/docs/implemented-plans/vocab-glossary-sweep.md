---
title: "Vocabulary sweep: glossary with a user-facing register, UI copy, record quantity/measurements"
status: implemented
workstream: vocab-sweep
issues:
  - ../../../issues/closed/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md
  - ../../../issues/closed/bugs/2026-08-08-markdown-not-rendering-in-agent-output.md
  - ../../../issues/closed/bugs/2026-08-24-agent-records-counts-in-prose-though-measures-exists.md
---
# Vocabulary sweep: glossary, UI copy, record quantity/measurements

Two field-test journeys collected, verbatim, the implementation vocabulary the
product shows first-time users ("box" meaning three things, "session" and
"chat" in one menu, raw vendor model names, a debug badge on the first
screen). The boxholder has now chosen the user-facing words in conversation
(2026-09-02). This plan records those decisions in the glossary, applies them
to every named UI surface and to the box agent's guidance, and makes the one
schema change the decisions require (`measures` → `measurements` +
`quantity`).

**Issues addressed:**
`issues/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md` (remaining UI
half), `issues/bugs/2026-08-08-markdown-not-rendering-in-agent-output.md`
(remaining agent-guidance half; the apostrophe-loss note splits into its own
issue — different mechanism),
`issues/bugs/2026-08-24-agent-records-counts-in-prose-though-measures-exists.md`.
Related, deliberately not addressed:
`issues/features/2026-08-23-first-screen-says-nothing-about-what-this-is.md`
(onboarding design; gets a note pointing at the settled vocabulary).

## Stated preferences this plan trades against

- Principle 8 (one way to do each thing): one glossary with a user-facing
  register per term, not a second user-glossary document.
- Principle 12 (the maintainer is usually an agent): the glossary is the
  authority both the UI and the agent guide defer to, so the next agent
  editing a label has one place to check. `docs/glossary.md` already claims
  this: *"When a term here conflicts with how code or other docs use it, the
  glossary is the source of truth."*
- Memory/feedback "minimize invented concepts": the chat split view gets no
  new user-facing noun (it is "the tab" / the card's name); "sidecar" stays
  unnamed for users.
- `bbx-migration` skill: a field rename with data on disk is a migration,
  never a schema-only edit; new entries append to `MIGRATIONS`.
- `beebox/CLAUDE.md` "Keep source and docs generic": "boxholder" stays an
  internal term, never rendered.

## What already exists

- `docs/glossary.md` — the glossary, dev-register only. Extend, not replace.
- `src/core/agent-guide/behavior.ts:8` `speakingToUserSection()` — "Speak the
  User's Language" already teaches call-things-what-users-call-them; the
  `[→ …]` rule and the no-"agent"/"box assistant" rule slot in here.
- `src/dev/knowledge-audits.yaml:3122` `speak-users-language` audit — the
  verification pattern to copy for the two new guidance rules.
- `src/core/markdoc/emit-tags.ts:104,136` — the `[→ ref]` downgrade
  serialization the agent imitates. It stays (markdown genuinely can't carry
  the chip UI); the fix is guidance, not the emitter.
- `scripts/migrate/_harness.ts` + `docs/migrations.md` — migration runner and
  template; `src/core/migrations.ts` `MIGRATIONS` registry (append-only).
- `src/frontend/src/components/FileView.tsx:247` `RendererToggle` — the view
  tabs; labels come from each renderer's registered `name`
  (`renderers/markdown-card.tsx:14` "Card" prio 30, `renderers/builtins.tsx:46`
  "Source" prio 10, type-specific renderers at prio 100).
- `src/frontend/src/lib/place-label.ts:30` `STATIC_LABELS` +
  `CHAT_PLACE` — the route→place map the pill renders.
- `useErrorCount`/`clearErrorCount` (`components/DebugLog.tsx`) — the badge's
  data source; gating slots into `ErrorBadge` (`AppNav.tsx:188`).
- `useCurrentUser` (`hooks/useCurrentUser.ts`) — whether an owner/admin
  session is present, for the badge gate.

## Prior art (external)

Nothing external is in play: every change is to our own copy, schema, and
guidance. The naming question ("extent" as the archivist's term for
count-plus-size) was considered and rejected in conversation as jargon —
recorded here so it isn't re-proposed.

## The decided vocabulary (2026-09-02, boxholder)

This is the decision record the glossary entries encode. UI and agent-guide
text follow it; disagreement later means updating the glossary first.

| Internal term | User-facing | Notes |
|---|---|---|
| session | **chat** | "chat session" in prose is fine; bare "session" labels go. |
| agent | *(none)* | UI says "Thinking…"; the assistant never calls itself "the agent". |
| box | **box** = the user's box, the totality | Never the app's name for itself ("box assistant" dies) and never a bare place label. |
| (root place) | **Home** | |
| dashboard "Inventory" | **Storage** | Frees "inventory" for the user's own job. |
| boxholder | *(internal only)* | Already the guide's rule; glossary marks it never-shown. |
| landmark | **landmark** | Kept, boxholder's explicit call, pending a better idea. |
| attachment | **attachments** | Word is fine; presentation fixes only. |
| companion pane (chat split view) | *(no noun)* | "the tab" / the card's own name; internally "companion pane". |
| sidecar (derived annotation file) | *(no umbrella noun)* | User surfaces name the kind ("transcript"). Internal term stays lowercase-informal. |
| `measures` field | **`measurements`** (list) + **`quantity`** (scalar) | quantity = "how much do I have" ("3 items", "10 ounces"); measurements = facts about the thing ("7 feet", "45 pounds", "1200 USD"). |
| renderer "Card" tab | schema's human name; **"Details"** when a type-specific tab already claims it | |
| renderer "Source" tab | **"Original text"** | |
| transcription services | vendor name + what it's about | Group headings carry the real axis: live-while-you-speak vs. final transcript after recording. Not "fastest/most accurate". |

## Tracks / scope

Ordered by dependency: glossary first (the authority), then the schema change
(longest tail: migration), then UI copy, then agent guidance + audits, then
issue bookkeeping.

### Track A — Glossary: user-facing register

**What.** Every `docs/glossary.md` entry gains a `User-facing:` line — the
word to show, "same", or "internal — never shown to users". New/updated
entries: **chat** (vs session), **Home**, **companion pane**, **quantity /
measurements**, **Storage** (dashboard), plus the table above folded into the
existing entries (box, boxholder, landmark, attachment).

**Why.** The collisions are unfixable surface-by-surface; the next label edit
needs one authority. The glossary already claims source-of-truth status.

**Direction.** A short "User-facing register" section at the top of the
glossary states the convention and points at
`speakingToUserSection()`; each entry gets one `User-facing:` line. No second
document.

**Vocabulary lock-ins.** The table above.

**First chunk.** The glossary edit, complete, one commit.

### Track B — Record schema: `measurements` + `quantity`

**What.** In `src/schemas/record.tsx`: rename `measures` → `measurements`
(same `{value, note?}` array shape); add optional `quantity` — a single
`{value, note?}` (not a list); rewrite the instructions so `quantity` answers
"how much/many do I have" (examples lead with a count: `"3 items"`,
`"roughly 15–20"`, `"10 ounces"`) and `measurements` answers "how big / how
heavy / what did it cost".

**Why.** Two of twenty journey-B inventory records carried a count in the
field; eighteen kept it in prose. The name reads as dimensions, and nothing
connected the field to "how many do I have".

**Direction.** Schema shapes:

```ts
quantity: MeasureEntry.optional(),        // {value, note?}
measurements: z.array(MeasureEntry).optional(),
```

Migration `record-measurements` (script, `scripts/migrate/`): for every
`*.record.card`, rename the `measures:` key to `measurements:`; entries whose
`value` is count-shaped are NOT auto-moved to `quantity` (deciding "4 sticks"
is a count but "45 pounds" isn't requires judgment per the migration skill's
script/agent line — and the old field's *meaning* was measurements, so a
straight key rename is the honest deterministic transform). Idempotent (skip
cards with no `measures:` key), harness-based, warnings spec for unexpected
entry shapes, appended to `MIGRATIONS`. Dry-run + apply on the worktree test
box, then `bbx validate`.

**Vocabulary lock-ins.** Field names `quantity`, `measurements` on the record
schema.

**First chunk.** Schema + instructions + migration script + doctest, one
commit set.

### Track C — UI copy sweep

Each item cites its surface; all are label/copy edits except the badge gate
and the tab labels, which are small behavior changes.

1. **Box-not-found page** (`app-shell.tsx:161`): drop "No box matches
   `<slug>` on this server" for user words — "There's no box called
   `<slug>` here." with the existing recovery list kept. Worktree
   paragraph (dev-only surface) stays technical.
2. **Session → chat** (`SessionChip.tsx`): "New session" → "New chat";
   accessible name "Session menu"/"Session: X" → "Chat menu"/"Chat: X"
   (`SessionChip.tsx:77,247`). Sweep other visible bare-"session" labels in
   chat chrome (grep; `SessionListPanel`, delete dialog).
3. **"Agent is working…" → "Thinking…"** (`TargetStrip.tsx:35`; comments in
   `processing-status-display.ts` follow).
4. **Empty-chat line** (`InteractiveChat-messages.tsx:264`): "Start a
   conversation with your box assistant." → "Start a conversation." ("box
   assistant" dies).
5. **Dashboard Inventory → Storage** (`router.tsx:106` title, the
   `/inventory` page's own headings; route path stays — URL churn buys
   nothing).
6. **Home** (`place-label.ts`): `CHAT_PLACE` label "Chat" stays for the chat
   place, but the root landing place reads "Home"; the bare "Box" place/menu
   labels in the pill (`PlacePill-panels.tsx` Box submenu) present the box's
   own name instead of the word "Box". Exact edits determined at the surface
   (the pill already claims "box tools are behind the box's own name",
   `AppNav.tsx:42`; verify and fix where it still says "Box").
7. **Place aria-labels** (`PlacePill.tsx:201`, `SessionChip.tsx:247`):
   "Place: X" → "Where you are: X"; covered by item 2 for the session chip.
8. **View tabs** (`FileView.tsx:247` RendererToggle): display-label mapping —
   a renderer named "Card" shows the card type's human name (from the path's
   `Name.type.card`) when no higher-priority type-specific renderer exists,
   else "Details"; "Source" shows "Original text". Pure function
   (`rendererDisplayLabel`), doctested; registered renderer `name`s (the
   `?view=` identity) do not change, so URLs and the registry stay stable.
9. **Transcription pickers** (`VoiceChip-panels.tsx:17-35,77,84`): group
   headings "Live transcription" → "While you speak", "HQ transcription" →
   "Final transcript (after recording)"; rows keep vendor names, disambiguate
   the double Whisper ("Whisper (live)" in the live group), gloss only where
   a row differs in kind ("Voxtral + diarization — labels who's speaking").
10. **Error badge gate** (`AppNav.tsx:188`): render only when the debug log
    has been opened this browser before (localStorage flag set by the debug
    log's open path) — the badge is a developer affordance; a first-run
    screen never shows it. The count still accumulates; the profile menu's
    "Debug Log" entry is unchanged, so the surface stays reachable.
11. **Health warning** (`webapp/trpc/routers/health.ts:204`): "Claude Code is
    not logged in — …" → name the machine, not the user's login state:
    "The assistant engine (Claude Code) isn't connected on this server — …".
    Admin surface, so the product name may stay, but the sentence no longer
    reads as a claim about the user.

### Track D — Agent guidance + knowledge audits

**What.** Extend `speakingToUserSection()` (`behavior.ts:8`) with two rules:
(1) `[→ …]` is the compiled-briefing serialization of a source chip — never
write it in chat or card prose; cite with `{% source %}`/`{% quote %}` or a
plain link (chat renders the real tags as citation chips,
`Markdown.tsx`); (2) don't present yourself as "the agent" or "your box
assistant" — speak as "I". Note the glossary as the vocabulary authority for
guide maintainers (a comment in `behavior.ts`, not agent-facing text —
box agents never see dev docs).

**Audits.** Two new `knows_directly` entries in
`src/dev/knowledge-audits.yaml` modeled on `speak-users-language`: one
prompting a reply that would tempt a `[→ …]` citation, one probing
self-reference. Run per the Knowledge audits section.

### Track E — Issue bookkeeping

Split the apostrophe-loss note out of the markdown-rendering issue into a new
`issues/bugs/` item (slugging mechanism, not vocabulary). Add a note to
`issues/features/2026-08-23-first-screen-says-nothing-about-what-this-is.md`
pointing at the settled vocabulary table. Update all three addressed issues
with progress notes as tracks land (final closure at /finish).

## Could this be simpler?

Simplest version: skip the glossary register and the schema change; just fix
the labels. It fails on the two documented regrowth paths: the vocabulary
collisions were collected twice, independently, two weeks apart — without a
recorded authority the next surface reintroduces them (principle 8); and the
count-in-prose failure is data rot that compounds ("twenty records is
recoverable; six containers of them is a migration" — the issue's own words).
The tab-label mapping could be simpler (rename the static strings), but a
static rename can't show "Recipe" for a recipe card, which is the reported
confusion. The badge gate could be dropped, but the ungated badge is the
single worst first-contact item after the fixed filename-as-heading.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Migration misses `measures:` on a card variant (different type holding the shape) | grep of real boxes in rollout | harness warnings spec | clear (warning dump) |
| Migration re-run re-renames / errors | doctest: run twice | idempotence check (skip when no `measures:`) | clear |
| Old generated per-box docs still teach `measures` | rollout step: grep boxes post-`bbx docs refresh` | `deploy.sh` runs docs refresh; dirty boxes skipped | clear if the grep runs; silent if skipped — rollout step is mandatory |
| Agent writes `quantity` as a list (shape confusion with `measurements`) | schema validation rejects | Zod error names the field | clear |
| `rendererDisplayLabel` derives a wrong name from an unusual path | doctest over path shapes | falls back to registered name | clear (label just less pretty) |
| Badge gate hides errors from a developer who never opened the log on a new browser | — | profile menu Debug Log always present | silent by design — accepted: that is the feature |
| `?view=Card` URLs break if renderer `name`s change | — | names deliberately unchanged (display-label layer only) | n/a |
| Audit passes but live agents still imitate `[→ …]` from compiled context | audits are the check we have | guidance names the exact form | accepted residual: audits probe knowledge, not every generation |

No critical gaps: every row has a test or an explicit accepted rationale.

## Agent-flow / user-flow edge cases

- **Wrong field of two similar things** (`quantity` vs `measurements`):
  ADDRESSED — instructions draw the line by question asked; quantity examples
  lead with counts (Track B).
- **Hand-edit drift** (boxholder writes `measures:` from memory):
  ADDRESSED — unknown keys fail card validation; the error names known fields.
- **Partial migration / transition state**: ADDRESSED — compatibility horizon
  is short (migration skill); no dual-read path, old key removed in the same
  plan.
- **Two agents on one card**: not implicated — no concurrency surface changes.
- **Validation error UX**: ADDRESSED — Zod's unknown-key error on `measures:`
  after rollout names the schema's fields, which now include the right ones.
- **Fabricated free-form value**: unchanged — `value` was and stays natural
  language.

## NOT in scope

- The first-run/onboarding screen
  (`issues/features/2026-08-23-first-screen-says-nothing-about-what-this-is.md`)
  — separate design work; it inherits the vocabulary table via a note.
- Renaming the `/inventory` route path — URL churn with no user-words gain.
- A user-visible glossary page — the point is users never need one.
- The assistant's persona/name (personified vs appliance) — boxholder
  explicitly left open; belongs to onboarding.
- Auto-moving count-shaped `measurements` entries into `quantity` — needs
  judgment per entry; the two known cards are cheap to hand-fix, and the
  migration skill says script the deterministic part only.
- The apostrophe-loss slugging bug — split to its own issue (Track E).
- Renaming "landmark" — boxholder kept it.
- `bbx` CLI wording — the CLI is not a user surface (standing feedback).

## Open design questions

none — the vocabulary table above settles what conversation left open; the
remaining unknowns (exact pill "Box"-submenu wording) are surface-level and
resolve at the point of edit within the decided rule (show the box's name,
never bare "Box").

## Knowledge audits

- `no-compiled-citation-form` — agent asked to cite a saved file in chat;
  `knows_directly` that `[→ …]` is never written, `{% source %}`/link is.
- `no-self-jargon` — agent asked "who/what are you?" adjacent probe;
  `knows_directly` it doesn't say "the agent"/"box assistant".
- `record-quantity-field` — agent asked to record "I have about 15 pens";
  `knows_directly` the count goes in `quantity`, not prose.

All three land RUN with status comments (`pnpm knowledge-audit run --box
<worktree test box> --filter <id>`). Track C is UI copy — no audit reaches it
(box agents don't see the UI); skipped with that rationale.

## What will hold this after it ships

- `rendererDisplayLabel` is a pure function → frontend doctest tier reaches
  it cheaply.
- Migration idempotence + rename → filesystem doctest via the harness pattern
  used by existing migrators.
- The two guidance rules → knowledge audits (above), the same anchor the
  first speak-users-language fix used.
- The glossary's authority is convention, not enforcement — accepted; a lint
  for label strings would be enforcement theater over prose.
- UI copy strings: no per-string tests (they'd pin prose, cost > value);
  the existing tours/journey walks are the periodic check.

## Implementation order

1. Track A (glossary) — the decision record lands first.
2. Track B (schema + migration + doctest + audit entry).
3. Track C (UI sweep; items 1–11, one or few commits).
4. Track D (guide text + audits, run them).
5. Track E (issue notes + apostrophe-loss split).
6. Cross-model review of the whole branch; act on findings.

## Rollout shape

Done-when: typecheck + lint:changed + test:changed green; migration dry-run
and apply clean on the worktree test box with `bbx validate` after; all three
knowledge audits RUN and passing; cross-model review done. Ship via /finish
(merge to main). Post-merge, prod rollout follows the migration runbook:
`bbx migrate` sweep, then confirm generated per-box docs converged (grep prod
boxes for `measures:` in `docs/generated/` and `.claude/rules/` — the
2026-08-24 scar says check, don't assume).
