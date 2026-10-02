---
title: "Chat titles for every chat, kept fresh cheaply"
status: draft
workstream: chat-titles
issues: []
---

# Chat titles for every chat, kept fresh cheaply

When I have a short chat — two exchanges about one thing — I want it to carry
a real title in the chat list, so I can find it again without reading
snippets. When a long chat drifts to a new subject, I want its title to
follow, without paying a full re-summary every night. And when a chat has no
title at all, I want the list to show the first message *as a snippet* —
visibly quoted — so raw transcript openings stop masquerading as titles.

Today all three fail for one structural reason: titling is welded to the
summary gate. `discovery.ts` qualifies a session for everything at once —
`REVIEW_CHAR_THRESHOLD = 6_000` chars of new span *and* 2 user turns
(`beebox/src/core/chat/review/discovery.ts:48-52`) — so a 900-char chat is
never titled, and a titled chat keeps a stale title until it grows another
6,000 chars. On the production `personal` box (2026-10-01): 21 of 35 husks
have generated titles, 0 sessions were review-ready that night, and 9 June
husks carry `title:` values that are raw transcript snippets their (now
deleted) transcripts once opened with.

**Issues addressed:** none filed; this is boxholder-requested work. Related
closed history: `issues/closed/features/2026-05-19-overnight-session-compaction.md`
(the pass this amends) and
`issues/closed/bugs/2026-07-29-chat-review-journal-is-machine-local.md`
(the origin-machine rule this builds on).

## Smallest fix and budget

Smallest fix for the reported symptom: lower `REVIEW_CHAR_THRESHOLD` to ~500
so short chats clear the existing gate. One line — and it makes every short
chat pay a full reviewer call (title + `contains` + account) every 500 chars
of growth, which is the cost the boxholder explicitly asked Jev to avoid, and
runs the account machinery on chats that will never be worth an account.

Chosen design, four tracks:

- **A — a title pass** with its own gate and its own journal consumer
  (~350 src + ~250 test lines);
- **B — a Jev freshness check** that keeps a title for free when it still
  fits (~120 src + ~80 test);
- **C — honest snippet labels**: a `first-message` husk field, quoted snippet
  display, and no more snippet-written `title:` (~150 src + ~80 test);
- **D — a done marker** on the husk, user-set, display-affecting (~150 src +
  ~80 test) — **a proposal awaiting a boxholder decision**; see Open design
  questions.

Total estimate ~1,300 changed lines including tests; authored docs (this
plan, amendments to `docs/chat/review.md` and
`docs/implemented-plans/chat-review.md`) ~400 lines, reported separately.
Under the 2,000-line BIG CHANGE bar.

## Stated preferences this plan trades against

- **`docs/engineering-principles.md` #8, one way to do each thing.** The
  title pass reuses the reviewer, the journal, the leak scan, and the husk
  write path rather than adding a parallel titling subsystem. The one new
  primitive (a second journal consumer) is the shape the existing state file
  already documents for exactly this: `applied` is *"keyed by consumer"*
  (`beebox/src/core/chat/review/state.ts:55`).
- **#10, testability is architectural.** The freshness decision is a pure
  function over Jev's answer, behind the existing JevService fake
  (`beebox/src/core/judgment/service.ts:50-60`, `BBX_JEV_FAKE`), so the
  run pipeline stays doctestable without a real Decisions API call.
- **#12, the maintainer is usually an agent.** `first-message` and `done`
  get schema doc-comments and instructions text; the difference between
  "editorial title" and "machine snippet" is exactly the kind of distinction
  an agent will guess wrong without it.
- **`beebox/CLAUDE.md` "work only on the requested problem".** Track D is
  scoped to a single marker with no automation; the reviewer never writes it.
- **Minimize invented concepts (boxholder guidance).** The done marker is a
  named boolean `done: true`, the form the repository's reserved-field rule
  prescribes; the snippet display quotes at the two existing label resolvers
  rather than introducing a label-type union.
- **Standard card fields (`docs/implemented-plans/standard-card-fields.md`).**
  `status` is a banned field name: `src/cards/reserved-fields.ts` rejects it
  with *"record the specific fact instead: a named boolean per state
  (`archived: true`)…"*, and `test/cards/reserved-fields.doctest.md` holds
  every built-in schema to it. **[rev]** The first draft proposed
  `status: done` and claimed todos and questions use a per-type `status`; that
  claim was not verified, and the doctest caught it during implementation.
- **Shipped precedent:** the chat-review plan itself
  (`docs/implemented-plans/chat-review.md`) — this document amends it and
  follows its vocabulary lock-ins ("chat review", never "compaction").

## What already exists

**Reused as-is:**

- The span journal is already multi-consumer: `AppliedSpanSchema` under
  `applied: z.record(z.string(), AppliedSpanSchema)`
  (`beebox/src/core/chat/review/state.ts:54-57`), with
  `METADATA_CONSUMER = "metadata"` (`state.ts:27`) as the only key today. A
  `title` consumer is a new key, not a new shape.
- `resolveSpan` / `spanSize` / `computeSpanId` / `appliedSpanFor`
  (`beebox/src/core/chat/review/span.ts`, used throughout
  `discovery.ts:167-190` and `run/core.ts:137-163`) work per applied-span
  entry; `readSessionWindow` takes the state and resolves against whichever
  consumer's entry it is handed.
- `resolveTitleOwner` (`beebox/src/core/chat/review/run/husk-write.ts:115-130`)
  already discriminates hand edits from auto-titles on every pass, including
  the first-review case via `snippetTitle` comparison — exactly what the
  title pass needs before writing.
- The leak scan and the credential-only rejection policy
  (`husk-write.ts:44-45`, `passesLeakScan` at `husk-write.ts:133-144`) apply
  to any generated string; the title pass reuses them verbatim.
- `extractSnippet` cleaning and the 80-char bookmark budget
  (`beebox/src/core/chat/husk.ts:38`, `husk.ts:57-65`) — what
  `readSnippetTitle` derives today becomes the `first-message` value,
  unchanged.
- The label resolution order already exists in one place per list:
  `resolveSessionLabel` (`beebox/src/core/chat/session/list/label.ts:52-67`)
  for live chats and `deadHuskLabel`
  (`beebox/src/core/chat/session/list/core.ts:250-252`) for dead husks.
  Quoting lands in those two functions; every consumer (history dropdown,
  landmark picker, search-row join) inherits it.
- Jev, as a service with a fake and an env override: `resolveJudgeService`
  reads the box's OpenRouter key or `BBX_JEV_FAKE`
  (`beebox/src/core/judgment/service.ts:50-60`); a `noul` question returns a
  calibrated probability (`beebox/src/services/jev-judge.ts:28-37`). The
  debug log (`appendJevDebug`, `service.ts:75-86`) gives the freshness calls
  a paper trail for free.
- The chat-search index already joins live labels at display time — its
  `title` is *"the chat's title as of indexing (husk title, else '')"*
  (`beebox/src/core/chat-search/schema.ts:27-28`) and the rows prefer the
  live session's label (`session-search.tsx` `labelFor`). Quoted snippet
  labels flow through with no index change.

**Modified:**

- `discovery.ts` — two gates instead of one (Track A).
- `run/core.ts` — a title-pass branch and a freshness branch (Tracks A/B).
- `reviewer.ts` — a title-only output schema and prompt mode alongside the
  full one (Track A).
- `husk.ts` `ensureChatHusk` — writes `first-message`, stops writing `title`
  (Track C).
- `schemas/chat.ts` — two new optional fields, `first-message` and `done`
  (Tracks C/D), plus instructions text.
- `state.ts` — optional per-consumer failure counters (Track A, additive).
- `bbx chat review status` / `run --dry-run` (`beebox/src/cli/commands/chat/review.ts`)
  — report title-pass counts.

**Deliberately NOT built:** a per-consumer `spanId` namespace. `computeSpanId`
hashes `(sessionId, endUuid, prefixHash)` with no consumer component, so two
consumers at the same boundary mint the same id. Changing it would strand
every `review-span` marker already on husks. Collisions are benign for
journal identity (the marker only guards the metadata consumer) and are
handled in the failure counters instead — see Track A.

## Prior art (external)

No external premise bears on a design decision here. The Jev/Decisions API
shapes are already shipped and validated in this codebase
(`docs/implemented-plans/notifications.md`); the freshness question is a
plain noul over in-repo prompt material. Auto-titling patterns from chat
products (title from first prompt, manual override) are already the box's
shipped baseline. Searches not run; nothing here invents a mechanism with an
external counterpart.

## Ontology

- **Title pass** — a review of a session's new span that may replace the
  husk `title` and nothing else. Identified by the journal consumer
  `"title"`. NOT a smaller summary pass: it never touches `contains`,
  `contains-evidence`, or `review-span`.
- **Metadata pass** — the existing pass (title + `contains` + account),
  consumer `"metadata"`, gate 6,000 chars. Unchanged.
- **Freshness check** — one Jev noul over (current title, tail of the new
  span). Output: *keep* or *retitle*. NOT a judgment of title quality —
  only whether the title still names what the recent messages are about.
- **`first-message`** — new optional chat-husk field: the opening user
  message, snippet-cleaned, ≤80 chars, machine-written once at husk creation.
  NOT a title; display always quotes it. What `readSnippetTitle`
  (`husk.ts:46-71`) computes today.
- **Snippet label** — a list label derived from the first user message:
  live, from the transcript (`label.ts`, 400-char budget, quoted after this
  plan) or durable, from `first-message` (80 chars, quoted). Falls back to
  the id prefix.
- **`done: true`** — new optional chat-husk field, a named boolean (absent
  or `false` = active). Means:
  the boxholder has closed this conversation. Set by the boxholder from the
  UI only. NOT a review gate in v1, NOT settable by the reviewer or Jev.

## Tracks / scope

### Track A — The title pass: a second gate and a second journal consumer

**What.** Discovery qualifies sessions for titling at a much lower gate; a
title-only reviewer mode writes the title; a second journal consumer
remembers what the title has seen.

**Why this needs to change.** Titling and summarizing share one gate
(`discovery.ts:237-259`: turns, then `spanChars < REVIEW_CHAR_THRESHOLD`
skips everything), so short chats are never titled and stale titles wait for
6,000 more chars.

**Direction.**

```ts
/** Pre-elision rendered chars of new material required to trigger a title pass. */
export const TITLE_CHAR_THRESHOLD = 400;
```

- `REVIEW_MIN_USER_TURNS = 2` stays shared (`discovery.ts:52`). The char
  threshold exists to skip "hi"/"thanks" tails, like the 6,000 one does for
  summaries; 400 chars past two turns is essentially "a real exchange
  happened". As untuned as the plan document says 6,000 is
  (`docs/implemented-plans/chat-review.md` § Track A).
- Discovery resolves **two** windows per husk: the metadata span (consumer
  `"metadata"`) and the title span (consumer `"title"`), each via the
  existing `readSessionWindow`. A `QualifiedSession` carries both sizes and
  the pass set it qualifies for. The double parse is the same accepted
  quadratic class the plan already records ("Performance, accepted",
  implemented-plans § Track A) — bounded by `PARSE_LIMIT`, nightly, on the
  husk corpus.
- `TITLE_CONSUMER = "title"` alongside `METADATA_CONSUMER` (`state.ts:27`).
- `readSessionWindow` hardcodes the consumer today
  (`discovery.ts:176`, `applied[METADATA_CONSUMER]`) — it takes an explicit
  `consumer` argument instead, and the reviewer's re-read passes the same
  consumer discovery measured.
- Reviewer: `ChatReviewer` gains a title-only mode — same interface file,
  same `TITLE_MAX = 80` (`reviewer.ts:20-21`), same title rules (the title
  section of `REVIEWER_SYSTEM_PROMPT`, `reviewer.ts:80-108`, extracted into a
  shared block so both prompts state it identically):

  ```ts
  const TitleOutputSchema = z.object({
    /** One line. Empty string means "the existing title still fits, keep it". */
    title: z.string().max(TITLE_MAX).refine((t) => !t.includes("\n"), …),
  });
  ```

  An empty title returned when the husk has **no** title at all is a failure
  (attempts++, retried next night) — "keep" is meaningless with nothing to
  keep. The same rule covers the metadata pass: its schema permits
  `title: ""` as "keep" (`reviewer.ts:29-34`) and `applyReviewToHusk` treats
  an empty offer as "nothing written" while still applying the span
  (`husk-write.ts:180`, `husk-write.ts:203`), so a first-review chat whose
  model returns "" would be left untitled with the title journal advanced.
  When the current title is null and the offer is empty, the metadata span
  still applies (the account is real work) but the title journal does not,
  and `titleAttempts` counts it.
- Husk write: a small sibling of `applyReviewToHusk` — `resolveTitleOwner`
  from the live card, leak-scan the title, write `title` alone under
  `withCardLock` when the owner allows and the scan passes. **No husk span
  marker**: a title write *replaces*; a crash between husk write and journal
  save cannot double-extend anything (the reason `review-span` exists,
  `husk-write.ts:147-157`, is account corruption, which titles cannot suffer).
  The lost journal entry costs one freshness check that will say "keep".
- Run orchestration (`run/core.ts`): a session qualifying for the metadata
  pass runs it exactly as today, and the metadata result advances **both**
  consumers' journals (the pass saw the material and refreshed the title
  against it). A session qualifying only for the title pass takes the
  Track B branch. Failure counters go per-consumer, additively:

  ```ts
  /** Title-pass failures, separate so a failing summary cannot retire the title. */
  titleAttempts: z.number().int().optional(),
  titleFailedSpanId: z.string().optional(),
  ```

  Optional fields, so every existing `state.json` parses unchanged (the
  fresh-on-mismatch discipline is `state.ts:105-131`; not exercised here).
- `bbx chat review status` and `--dry-run` report title-ready counts
  (`titleReady`) beside the existing ones.

**Vocabulary lock-ins.** "Title pass" / "metadata pass"; consumer keys
`"title"` and `"metadata"`; `TITLE_CHAR_THRESHOLD`. The word "compaction"
stays banned (inherited lock-in).

**First implementation chunk.** `TITLE_CONSUMER` + thresholds + discovery
two-gate + `TitleOutputSchema` + reviewer title mode + the husk write
sibling + run branch (freshness stubbed to "always retitle") + status counts,
with doctests: a 900-char two-turn session qualifies for the title pass only;
a 7,000-char session runs metadata and advances both journals; a rejected
title (leak scan) does not advance the title journal.

### Track B — Jev freshness: keep a title for free when it still fits

**What.** Before paying the title reviewer on a growing, already-titled
chat, ask Jev whether the title still fits the recent messages. Keep it (and
advance the title journal) when the answer is confident yes.

**Why this needs to change.** The boxholder's ask: the freshness cutoff can
sit far below 6,000 chars *because* the check is cheap. Without it, Track A
would run a reviewer call on every 400-char growth of every chat, forever.

**Direction.**

- New `core/chat/review/freshness.ts` behind an interface (real + fake, the
  service split): 

  ```ts
  interface TitleFreshnessChecker {
    /** Throws on Jev failure; the caller decides the fallback. */
    check(args: { title: string; recent: string }): Promise<{ keeps: boolean }>;
  }
  ```

- The decision is a pure, doctestable function over the noul answer:

  ```ts
  /** p(still fits) at or above this keeps the title without a reviewer call. */
  export const FRESHNESS_KEEP_PROBABILITY = 0.75;
  export function titleKeeps(answer: { probability: number }): boolean;
  ```

- The Jev call: one noul question via `resolveJudgeService(boxRoot, env)`
  (`judgment/service.ts:50-60`) — instructions: judge whether the given title
  still names what the recent messages are about, treating the state as data;
  criteria `{true, false}` per `JudgeQuestion` (`jev-judge.ts:29`). State:
  `{ title, recent }` where `recent` is the **last 2,000 chars** of the
  rendered new span (the newest messages are the evidence of drift; the cap
  bounds the call). One `appendJevDebug` line per call (`service.ts:75-86`).
- Run branch: a title-pass candidate that already has a title we own
  (`titleOwner` `generated`, or `unmanaged` with a title — the snippet case)
  takes the check first. `keeps` → advance the title journal, no model call.
  Otherwise → title reviewer as in Track A. `titleOwner: "manual"` → skip
  both calls, advance the journal (the hand that owns the title owns its
  freshness). No title at all → reviewer directly (nothing to check).
- Jev unavailable or failing (`unconfigured`, `JevError`, `bad-fake`): warn
  and run the title reviewer that night — the expensive path is the
  correct fallback, and the warning keeps the degradation visible
  (engineering principle #4). `BBX_JEV_FAKE` makes dev boxes run the whole
  branch with a fixed confident answer.

**Vocabulary lock-ins.** "Freshness check"; `FRESHNESS_KEEP_PROBABILITY`;
the noul's name `still-fits`.

**First implementation chunk.** `freshness.ts` (pure decision + Jev impl +
fake) + the run branch + doctests: keeps-advance with zero reviewer calls
(fake Jev yes, assert `reviewer` untouched); stale → reviewer called and
title replaced; Jev error → reviewer called + warning; manual owner → no
calls, journal advanced.

### Track C — Honest snippet labels, and no more snippet titles

**What.** New husks stop being born with a fake title; lists quote snippet
labels; dead husks keep their opening line as a quoted `first-message`
instead of an unquoted `title`.

**Why this needs to change.** `ensureChatHusk` copies the first user message
into `title:` at creation (`husk.ts:87`, `husk.ts:105`) — so every chat
*looks* titled, and after the transcript expires (the 9 June husks) the
snippet is frozen as the card's permanent, unquoted "title". The boxholder's
ask: a snippet must be visibly a snippet.

**Direction.**

- `schemas/chat.ts` gains:

  ```ts
  /**
   * The conversation's opening user message, snippet-cleaned and capped.
   * Machine-written once at husk creation; the durable fallback label once
   * the transcript is gone. Not a title — display always quotes it.
   */
  "first-message": z.string().optional(),
  ```

- `ensureChatHusk` writes `first-message` (from today's `readSnippetTitle`
  unchanged) and **stops writing `title`**. New husks are titled only by the
  review or by hand.
- **The write is idempotent, not creation-only.** `readSnippetTitle` returns
  null when the transcript does not exist yet (`husk.ts:66-70`), and a coined
  chat's husk is created at *reserve* time, before any message
  (`session/registry/start-record.ts:3-16`, the two-paths note) — so a
  creation-only write would leave exactly the chats that most need a durable
  fallback label without one (found in cross-model review). Every review pass
  — title or metadata — fills `first-message` when the field is absent and
  discovery's `snippetTitle` (`discovery.ts:88-89`) is available, under the
  same `withCardLock` write. Residual, accepted: a chat that never reaches
  two user turns is never reviewed, so a dead one-turn husk falls back to the
  id prefix.
- Display quotes snippets, in the two resolvers and nowhere else:
  - `resolveSessionLabel` (`label.ts:52-67`): the transcript-snippet branch
    returns `“{snippet}”` (typographic quotes, one ellipsis if truncated).
  - `deadHuskLabel` (`list/core.ts:250-252`): `title` → unquoted;
    `first-message` → quoted; else id prefix.
  Live label order is otherwise unchanged (`label.ts:4-6`); the app-bar chip
  keeps showing nothing for untitled chats (`titleForSession`,
  `list/core.ts:398-410` — an icon face, which is now the honest common case).
- Search rows inherit quoting through the live-label join
  (`session-search.tsx` `labelFor`, `chat-search/schema.ts:27-28`); the
  indexed `title` stays the husk title ("" when none). No index change.
  Known transient: before the session list loads (or after it errors), the
  panel passes an empty `sessions` array and an untitled hit falls back to
  the id prefix, unquoted — a sub-second window on panel open, accepted
  rather than widening the index schema for it.
- **The 9 June husks (and any like them on other boxes): a per-box repair,
  not shipped code.** How those titles got there is now verified:
  `ensureChatHusk`'s creation-time `readSnippetTitle` (`husk.ts:87`), with
  the transcripts since deleted — so the reviewer can neither read the chat
  nor retitle it, and no mechanical test distinguishes a creation snippet
  from a short hand-typed title once the transcript is gone (the live
  discriminator, `resolveTitleOwner`'s `snippetTitle` comparison at
  `husk-write.ts:127-129`, needs the transcript). The repair is judgment
  over a handful of cards: on the affected box, an agent moves a
  transcript-less husk's snippet-shaped `title:` to `first-message:`. This
  plan ships the procedure (below, Rollout shape); the boxholder's agent
  executes it on every prod box they operate (decided 2026-10-01) after
  landing. Nothing private crosses
  into the repo.
- Self-healing for the rest: a *live* chat whose `title` is still a creation
  snippet classifies as `unmanaged` on its first title pass
  (`resolveTitleOwner`, same comparison) and gets a real title the first
  night it qualifies. No migration needed for those.

**Vocabulary lock-ins.** Field key `first-message` (kebab-case, matching
`context-dir`/`review-span`); typographic quotes `“ ”` for snippet labels;
`title:` remains editorial-or-generated only.

**First implementation chunk.** Schema field + template + `ensureChatHusk`
change + both resolvers + doctests (untitled live chat renders a quoted
transcript snippet; dead husk with `first-message` renders it quoted; a
titled husk renders unquoted; `createChatHuskTemplate` carries
`first-message` and no `title`).

### Track D — A done marker (decided 2026-10-01; builds after A–C)

**What.** `done: true` on the husk, set by the boxholder from the session
chip menu, shown in the chat lists. Boxholder decisions on record: single
value `done` (no separate `one-off`), display-affecting only — review
behavior unchanged.

**Why this needs to change.** The boxholder asked for "a way to mark a chat
as done, or as a one-off" — conversations that are finished shouldn't sit in
the list indistinguishable from living ones.

**Direction (proposed).**

- `schemas/chat.ts` gains `done: z.boolean().optional()` — a named boolean,
  because `status` is a banned field name (see Stated preferences, **[rev]**).
  One state, not two: "one-off" and "done" both mean *closed*, and a second value would
  buy no different behavior in v1. (If the boxholder wants "one-off" as a
  distinct visible label, it is one enum member, not a redesign — Open
  design questions.)
- UI: a "Mark done" / "Mark active" toggle item in the session chip menu
  (`SessionChip`'s menu, beside "New chat"/"Recent chats"), over a tRPC
  mutation that writes the husk field under `withCardLock` (the
  `bbx-guide-api` shapes). The current session's own husk is the target;
  a brand-new chat with no husk yet offers nothing.
- Lists: done chats sort below every live one and below "Other chats",
  carrying a muted `done` tag on the row (the `DeadSessionGroups` precedent
  for visually demoting a class, `SessionListPanel.tsx:178-203`). They stay
  clickable — done is a state, not a deletion.
- **Review behavior: none, by decision.** The pass reads `done` for no
  purpose. Rationale: with Track B, a closed chat that never grows again
  costs nothing anyway (discovery gates on *new* span), and gating review on
  `done` creates a trap — a resumed "done" chat would silently stop being
  titled or summarized until unmarked. Confirmed display-only by the
  boxholder, 2026-10-01.

**Vocabulary lock-ins.** `done: true` (named boolean); "Mark done"
menu label.

**First implementation chunk.** Schema field + mutation + menu item + list
sorting/tag + a route doctest (mark, list reflects, unmark restores).

### Track E — Docs and status surface

`docs/chat/review.md` (the live reference) gains the two-gate model, the
freshness check, and the new fields; `docs/implemented-plans/chat-review.md`
gets a dated revision note pointing here (the precedent: its own 2026-07-28
Codex-revision note); `docs/cards/schemas.md` and the
`bbx-guide-schemas` skill enumeration gain `first-message` and `done`
(the declared rule at `cards/schema.ts:96-97`). On ship, this plan moves to
`implemented-plans/`.

## Could this be simpler?

The simplest version that touches the symptom: lower `REVIEW_CHAR_THRESHOLD`
to ~500 and change nothing else. It titles short chats — and then runs a
full summary pass over every 500-char growth of every chat forever, which
the boxholder explicitly rejected ("use Jev to keep titles fresh cheaply"),
and it leaves snippet-as-title untouched (the 9 June husks stay wrong, new
ones keep being minted). The second-simplest: keep one gate at 400 but give
the reviewer a title-only mode with no Jev — every growing chat still pays a
model call per nightly growth. Track B is the only piece that buys
"fresh titles at near-zero cost", which is the stated job; everything else
in this plan is the honest-labels half, which has no simpler version that
still distinguishes a title from a snippet.

## Subplans

None. The one design question that could have warranted one (the done
marker) is a single field with one behavior; it is an Open design question
instead, answered by a decision, not a design document.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Jev keeps a title that has drifted (p ≥ 0.75, wrong) | No — judgment, not testable | Bounded: re-checked on next 400-char growth; visible in the list; boxholder can edit (→ `manual`, forever safe) | Silent per check, visible in list — accepted residual, same class as the shipped title-discretion risk |
| Jev unavailable on a night | Yes — doctest with erroring fake | Warn + run the title reviewer (correct, costlier path) | Clear (warn) |
| Crash between title husk write and journal save | Yes — doctest replaying the span | No husk marker needed: next run's freshness check sees the new title against the same span → keeps → journal advances | Clear by construction |
| Title reviewer returns "" when the husk has no title | Yes — doctest | Counts as failure (`attempts`), retried next night | Clear (run summary counts it) |
| Metadata pass exhausts its attempts; title pass then also blocked | Yes — doctest | Separate `titleAttempts`/`titleFailedSpanId` counters | Clear (status counts both) |
| Span ids collide across consumers at the same boundary | Yes — assertion in state doctest | Benign by design: `computeSpanId` stays unnamespaced (changing it strands every on-husk `review-span`); counters are per-consumer fields | Clear (documented here) |
| A chat drifts but grows < 400 chars | No | Never re-checked — strictly smaller residual than today's < 6,000 | Accepted, documented |
| An agent writes `first-message` by hand or treats it as a title | Yes — knowledge audit | Schema doc-comment + instructions text | Clear (audit) |
| A hand-edited `title` meets the title pass | Yes — doctest (existing `resolveTitleOwner` suite extends) | `manual`, one-way, never written; journals still advance | Clear (the absence of a write) |
| Snippet label itself contains quote characters | Yes — doctest fixture | Cosmetic only; snippet is truncated with an ellipsis before quoting | Clear |
| `done` hand-set to a non-boolean | Yes — route doctest | Card validation fails; the lists read it as absent and warn | Clear (validation error + warning) |
| Two machines: laptop-origin chat grows; prod's title journal doesn't see it | Existing — origin rule (`discovery.ts:141-143`) | Discovery skips foreign-origin sessions; counted in `status` | Clear (counted) |

> **Critical gap:** none unresolved.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED: `first-message` vs `title` vs
  `done` each carry doc-comments and instructions text; a knowledge audit
  (below) tests exactly the `first-message`-is-not-a-title confusion.
- **Stale ref** — ADDRESSED: transcript vanishing between discovery and run
  is the existing `missingTranscripts` path (`run/core.ts:143-147`); a husk
  deleted mid-run fails its card write loudly (`HuskUnreadableError`,
  `husk-write.ts:55-60`).
- **Two agents touching the same card** — ADDRESSED: every write stays under
  `withCardLock` with the live re-read (`husk-write.ts:191-199`); the
  freshness→reviewer gap re-resolves ownership from the card at write time,
  as the metadata pass already does.
- **Hand-edit drift** — ADDRESSED: hand titles are permanent via
  `titleOwner: "manual"`; a hand-set `first-message` is overwritten never
  (written once at creation); a hand-set non-boolean `done` is a validation
  error, not silent normalization.
- **Fabricated free-form value** — ADDRESSED: `done` is a boolean;
  `first-message` is derived verbatim by `extractSnippet`; the title pass's
  leak-scan and owner checks are inherited unchanged.
- **Validation error UX** — ADDRESSED: the enum message names `done` as the
  only value; the `first-message` doc-comment states machine ownership.
- **Partial migration / transition state** — ADDRESSED: both new fields are
  optional; old state files parse (additive counters); pre-change husks with
  snippet titles self-heal on first title pass while their transcript lives,
  and dead ones go through the per-box repair. Boxes that never enable the
  schedule keep today's behaviour except the quoted labels and the absent
  creation title — both pure display, both the point.

## NOT in scope

- **Changing the metadata 6,000-char gate or the summary machinery** — the
  account design is shipped and measured; only titling moves.
- **Retitling transcript-less husks from code** — impossible by design (the
  reviewer reads transcripts); the per-box repair is judgment work.
- **The reviewer or Jev setting `done: true`** — automation of an
  editorial close; v1 is user-set only (per the arrange-context preference).
- **A `one-off` enum value with distinct behavior** — recorded as an open
  question; one enum member if wanted, no separate mechanism.
- **Cmd+K / global-search integration of chat titles** — open elsewhere
  (`issues/features/2026-09-28-chats-in-global-search.md`).
- **Making `first-message` searchable/indexed** — the search index joins
  live labels already; indexing another derived field changes a tuned
  scoring surface for no stated job.
- **Cross-machine journal reconciliation** — the origin rule
  (`discovery.ts:141-143`) is the shipped answer.

## Open design questions

- ~~**The done marker's exact shape** (Track D)~~ **Settled (boxholder,
  2026-10-01):** a single done state (shipped as `done: true`; see [rev]); display-affecting only — a done chat
  is still reviewed like any other (a closed chat that stops growing costs
  nothing under Track B, and gating review would trap a resumed chat).
  Placement: the session chip menu, per the lean below.
- ~~**The June-husk repair scope**~~ **Settled (boxholder, 2026-10-01): the
  judgment repair runs on every prod box the boxholder operates**, not the
  personal box alone. Procedure unchanged; per-box content never enters this
  repo.
- **`FRESHNESS_KEEP_PROBABILITY = 0.75`** — untuned prior, the same stance
  the 6,000 threshold ships with. **Lean:** start at 0.75, adjust from the
  `jev-debug.log` record if titles visibly lag drift.

## Knowledge audits

One new audit in `beebox/src/dev/knowledge-audits.yaml`: a box agent handling
a `chat` card knows that `title` is editorial-or-reviewer-owned, that
`first-message` is a machine-written quoted-in-lists snippet (not a title to
edit or mimic), and that `done: true` is the boxholder's close mark. Lands
RUN (`pnpm knowledge-audit run --box <test-box> --filter <id>`), status
comment recorded in the plan before ship.

## What will hold this after it ships

- The two-gate qualification, the both-journals advance, the no-title-empty-
  return rule, and the per-consumer counters: core doctests against the
  scripted reviewer fake (the existing chat-review doctest tier).
- `titleKeeps` and the freshness branch: pure-function doctest plus
  fake-Jev pipeline doctests (`createFakeJev` / `BBX_JEV_FAKE`), asserting
  *zero* reviewer calls on the keep path.
- Label quoting and `first-message`: doctests on `resolveSessionLabel`,
  `deadHuskLabel`, and `createChatHuskTemplate` — all plain functions, the
  cheapest tier; the frontend only renders strings.
- The done marker: a route doctest over the mutation plus a grouping test on
  `layoutSessionList`'s successor — the decision stays in a pure layout
  function, testable without a browser.
- No new test tier. One trap checked: the freshness doctests must use the
  fake's *scripted* answers, not `fixedAnswer` defaults — an
  evenly-uncertain fake would pass `titleKeeps` for the wrong reason.

## Implementation order

1. **Track C** (schema + `ensureChatHusk` + resolvers) — independent,
   immediately visible honesty; nothing depends on the passes.
2. **Track A** (gates, consumer, title mode, run branch with freshness
   stubbed to "retitle") — the machinery, verified without Jev.
3. **Track B** (freshness) — replaces the stub; the cost win.
4. **Track E docs** — with the code they describe.
5. **Track D** (done marker) — after the boxholder answers the open
   questions; droppable without touching 1–4.

Commit boundaries follow tracks; the plan ships as one piece, on the
boxholder's word.

## Rollout shape

Tests first, as designed above; done-when is the named doctests plus
`pnpm typecheck` / `pnpm lint:changed`.

Migration: additive optional card fields and optional state fields — no data
migration, existing cards and journals parse unchanged (the
`bbx-migration` checklist: on-disk shape changes are compatible-additive;
`ensureChatHusk`'s behavior change affects only cards created after landing).

The per-box June repair (procedure, executed by the boxholder's agent on
**every prod box they operate** — boxholder decision, 2026-10-01 — after
landing):

1. List husks under `_content/chat/web/` whose transcript is absent on this
   machine (the dead-husk enumeration is the test).
2. For each, judge whether `title:` reads as a raw opening snippet (verdict
   per card, by judgment — a hand title like "June receipts question" is not
   a snippet).
3. Move snippet verdicts to `first-message:` (trim to the 80-char budget if
   the plan's quoting would truncate anyway), leaving genuine titles alone.
4. Nothing enters this repo from that box's content — structural facts only
   (count repaired, say), per the real-box rule.

Knowledge audit lands with Track E. After ship: move this plan to
`implemented-plans/`, add the revision note to `chat-review.md`'s
implemented plan, and close nothing in the issue queue (no issue filed).
