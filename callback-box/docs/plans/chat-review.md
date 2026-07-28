# Chat review: size-gated overnight compaction and generated titles

**Status:** active — designed 2026-07-28, nothing implemented

A nightly pass that reads chat sessions which have accumulated enough *new*
material since it last read them, and writes back to the session's husk card:
a **title** (an information-dense one-liner replacing the current
first-message-snippet label), a **`contains`** sentence, and a **running
account** of what the conversation amounted to — decisions, open threads,
follow-ups.

The pass is **incremental**: it keeps a cursor into the transcript, reads only
the span past the cursor, and *extends* the account it wrote last time rather
than regenerating it from a re-read. This is a correctness requirement, not an
optimization — see "Why incremental" below.

Filed as [overnight session compaction](../../../issues/features/2026-05-19-overnight-session-compaction.md);
this plan resolves that issue's `needs: [design]`.

---

## Stated preferences this plan trades against

- **`docs/engineering-principles.md`** — findings trace to:
  - **#4 Resilient AND never silent — and never resilient to the impossible.**
    The review is a best-effort enrichment pass; every degradation (unreadable
    transcript, model failure, leak-scan rejection) must leave the session
    usable and say so, not fail the run and not fail silently.
  - **#8 One way to do each thing.** There are currently *two* session-list
    codepaths with different labelling behaviour (Track C). Adding a title
    without unifying them would make it three.
  - **#10 Testability is architectural.** The reviewer goes behind an interface
    with a scripted fake, as `RetroObserver` already does
    (`src/core/retro/observer.ts:21-24`).
  - **#12 The maintainer is usually an agent.** "Compaction" already means
    something else in this codebase; reusing it would cost every future agent a
    disambiguation (Track A vocabulary lock-in).
- **`callback-box/CLAUDE.md`** — the "don't add features beyond what the task
  requires" rule bounds the fan-out (see NOT in scope); the time-discipline
  rule (`getBoxTime`, not `new Date()`) applies to every timestamp written here.
- **`callback-box/code-style.md`** — max 2 positional params, no default
  parameters, no `any`, explicit return types on exports, `Result` vs throw.
- **Most recent shipped precedent: box retrospectives**
  (`docs/implemented-plans/box-retrospectives.md`, `src/core/retro/`). The same
  shape of thing — a scheduled walker over chat transcripts running a cheap
  tool-less LLM pass and recording results with dedupe. Where this plan deviates
  from that precedent, it says why.

---

## Why incremental (the finding that shapes the design)

`renderSessionCompact` elides the middle of any transcript over 40,000 chars —
`src/core/retro/render.ts:21`: *"Hard cap on rendered transcript size so one
marathon session can't blow the observer's budget. Over the cap, the middle is
elided"*, implemented by `elideMiddle` (line 42).

Measured against the real distribution (777 box transcripts, sizes in
`renderSessionCompact` output chars): **of the ~45 sessions that clear the size
gate, 33 are already over the 40k elision cap** — roughly 73% of the eligible
set. So for most sessions that qualify for review at all, a from-scratch re-read
*cannot see the middle of the conversation*.

That makes regeneration lossy in a way that gets worse over a session's life,
and it is why the account extends rather than being rewritten: the material that
scrolled out of the render is already captured in the previous pass's account.
The cursor is what makes extension sound — it guarantees each span is read
exactly once, so extending can neither double-count nor skip.

This is the **anchored incremental summarization** pattern (see Prior art):
maintain a persistent structured document, extend it per new span.

Residual limitation, stated plainly: the *first* review of an
already-long session still reads a from-scratch, elided transcript, because
there is no prior account to anchor to. That is a one-time bootstrap cost per
session, not an ongoing one, and it is not worth engineering around.

---

## What already exists

**Reused as-is:**

- `src/cli/lib/session.ts:205` `getSessionMetadata({sessionId, logPath, snippetMaxLen})`
  → `userTurns`, `assistantTurns`, `firstUserSnippet`, already filtering
  plumbing messages, SDK compaction summaries and self-notes (`foldUserMetadata`,
  lines 158-177). **Reuse** for the turn-count half of the gate and the snippet
  fallback.
- `src/core/agent/index.ts` `createAgent(...).invokeStructured(schema, opts)` —
  the "one cheap scoped LLM call with a Zod-validated result" helper. The retro
  observer's use is the template: `src/core/retro/observer.ts:69-76` passes
  `model: "haiku"`, `maxTurns: 4`, `maxBudgetUsd: MAX_BUDGET_USD`. **Reuse.**
- `src/core/chat/husk.ts:42` `findChatHusk(boxRoot, sessionId)` and
  `src/core/chat/husk.ts:128` `listChatHusks(boxRoot)` — husk lookup and
  enumeration, already surfacing `title` (`ChatHuskEntry.title`, line 119).
  **Reuse** as the read/write target.
- **`title` and `contains` need no schema change.** Both are global card fields:
  `src/cards/schema.ts` `GLOBAL_CARD_FIELDS` declares *"`title` —
  human-readable display title"* and *"`contains` — one sentence stating what
  can be found inside this card; the prime retrieval field for search and
  listings"*, each `z.string().optional()` on every card type. So
  `src/schemas/chat.ts:16-22` not listing them is correct, not a gap.
  **Reuse both; add no fields.**
- `src/publish/leak-scan.ts` — a **pure** function over a text file map
  returning `LeakFinding[]` for home-dir paths, non-allowlisted emails,
  credential shapes and absolute URLs. **Reuse** as the mechanical backstop on
  generated titles (Track B), by handing it a one-entry map.
- `src/schemas/scheduled-script.tsx:48` `ScheduledScriptSchema` + `cb tick`
  (`src/cli/commands/tick.ts`) — how a nightly job is expressed. Shipped
  schedules are **defined in code**, not as template card files:
  `DEFAULT_SCHEDULES` in `src/core/box/defaults.ts` (the retro entry ends at
  line 272), installed per box by `installSchedules` (line 282) through
  `installTemplateFile`. **Reuse**; the review adds one entry to that array.
- `src/cli/commands/chat.ts:275-282` — `cb chat` is already a command family
  (`self-note`, `whats-changed`, `screenshot`, …). **Reuse** as the parent:
  `cb chat review` rather than a new top-level command.

**Modified:**

- `src/core/retro/render.ts:57` `renderSessionCompact(logPath)` — dialogue plus
  tool one-liners, tool results dropped. The rendering is exactly right; what it
  lacks is a starting offset. `parseSessionLog` already supports `offset`/`limit`
  (used at `src/webapp/trpc/routers/chat-session-procedures.ts:46-50`), so the
  change is small: an options object carrying an optional `offset`, defaulting
  to the whole transcript so retro's call site is unaffected. The module also
  moves out of `retro/` to a shared home, since two subsystems now use it.
  Note the useful side effect: with an offset, the 40k elision cap now applies
  to *one span* rather than the whole session, so it almost never fires.

**Deliberately NOT reused (rebuilt, with reasons):**

- `src/core/retro/state.ts` — retro's walker state is a **terminal** predicate:
  `isSessionSettled` (line 43) returns true for `status: "done"`, and *"A session
  marked `done` is never re-observed"* (lines 5-6). Chat review is the opposite:
  a session must be re-read every time it grows past the threshold again. New
  state file with a cursor shape. The *loading discipline* — missing file starts
  fresh, corrupt file warns and starts fresh (`loadRetroState`, lines 56-82) — is
  copied.
- `src/core/retro/discovery.ts` — retro's qualification is "is this a chat, is it
  quiet, is it unsettled" (lines 99-117) with no size notion. Chat review needs
  "how much *new* material since the cursor", which `discoverSessions` cannot
  express. New function, sharing the quiescence constant.

**The bug this plan also closes.** Two session-list codepaths label differently:

- `src/webapp/trpc/routers/chat.ts:162` — husk-based, title-aware:
  `let label = husk.title ?? husk.session.slice(0, 8);` with the transcript
  snippet used only *"if (husk.title === undefined)"* (line 163). Its doc comment
  states the intent: *"a husk `title` beats the transcript snippet"* (line 136).
- `src/webapp/trpc/routers/chat-session-procedures.ts:74-80` — history-JSON
  based, **title-blind**: `let label = sessionId.slice(0, 8);` … `if
  (meta.firstUserSnippet) label = meta.firstUserSnippet;`. It never reads a husk.

`src/frontend/src/api-chat.ts:158` (`trpcClient.chat.sessions.query()`) is the
title-blind one, and it is what `SessionListButton.tsx` renders. Generated titles
are invisible in the chat history dropdown until Track C lands.

---

## Prior art (external)

- **"Anchored incremental summarization" is the pattern this plan uses** —
  maintain a persistent structured document and extend it per new span rather
  than regenerating from scratch, avoiding the O(n²) cost of re-summarizing the
  whole conversation each pass.
  [Memory Consolidation and Summarization Techniques](https://apxml.com/courses/agentic-llm-memory-architectures/chapter-3-designing-memory-systems/memory-consolidation-summarization),
  [Memory in the Age of AI Agents](https://arxiv.org/pdf/2512.13564).
  The cost argument is secondary here; the elision argument above is the
  binding one.
- **Production evidence that incremental beats bulk** — Airbnb's deployed
  incremental case-summarization reported ~3% lower handling time vs bulk
  summarization, up to ~9% on complex cases.
  [Incremental Summarization for Customer Support via Progressive Note-Taking and Agent Feedback](https://arxiv.org/pdf/2510.06677).
  Weak support: the metric is human handling time, not summary quality, and the
  spans are support cases, not open-ended chat. Recorded so the next person
  doesn't re-find it and over-read it.
- **Auto-titling from the first prompt, with a manual override, is the
  industry-standard pattern** —
  [AI Chat UI Best Practices for 2026](https://thefrontkit.com/blogs/ai-chat-ui-best-practices).
  That is what this box already does; the prior art confirms the baseline, not
  the improvement.
- **No prior art found for sensitivity-aware title generation.** Searches
  returned only prompt-sanitization and PII-redaction work —
  [Sanitizing Sensitive Prompts for LLMs](https://arxiv.org/html/2504.05147v2),
  [When Prompts Leak Secrets](https://www.keysight.com/blogs/en/tech/nwvs/2025/08/04/pii-disclosure-in-user-request) —
  which is a different problem (scrubbing tokens *before* the model sees them,
  not asking the model to write a *discreet* label about content it has fully
  read). This empty search is itself a finding: the reviewer prompt (Track B) is
  the artifact carrying the whole requirement, with no external design to copy.
  It should be iterated against real transcripts, not written once.
- **The project's own precedent says the regex backstop cannot carry this.**
  `src/publish/leak-scan.ts` states it in its header: the scan *"does NOT
  meaningfully cover"* PII or secrets *"in prose form"*, and *"the human
  file-by-file preview is the only real gate"*. Applied here: leak-scan catches a
  title containing an email or an API key; it cannot catch a title that
  accurately names a medical or financial topic. Only the prompt and the
  boxholder's edit can.

---

## Tracks / scope

### Track A — Eligibility: the cursor and the size gate (`src/core/chat/review/`)

**What.** A discovery function returning the sessions worth reading tonight,
plus the per-session state that makes "worth reading" mean "grew since the
cursor" rather than "never read".

**Why this needs to change.** Nothing today expresses "how much new material has
this session accumulated". Retro's walker answers a once-ever question. Running
an LLM pass over every session nightly is not viable: of 777 measured box
transcripts, ~90% are single-turn non-chat invocations (scheduled tasks, reactor
runs) sharing `~/.claude/projects/`.

**Vocabulary lock-ins.**

- The subsystem is **chat review** — `cb chat review`,
  `src/core/chat/review/`, `.callback-box/chat-review/`, and a `## Review`
  section on the husk.
- It is **never called "compaction"** in code, comments, or docs.
  That word is already taken for the SDK's context-window compaction:
  `src/cli/lib/session-text.ts:22-27` `isCompactionSummary()` detects *"This
  session is being continued from a previous conversation that ran out of
  context."* Two meanings for one word, in a codebase whose maintainer is
  usually an agent (principle #12), is a cost paid on every future read.
- The **`chat` qualifier is load-bearing and not dropped**. Bare "review" in
  this repo means code review — `/code-review`, `cb-plan`'s review mode, the
  `docs/plans/<topic>.review.md` convention. `cb chat review` is unambiguous;
  `cb review` would not be. Do not shorten it.

**Direction.**

Sizes are measured in `renderSessionCompact` output characters — the unit
actually sent to the model, deterministic, and already computed. Distribution
across 777 transcripts:

| p50 | p75 | p90 | p94 | p95 | p97 | p99 | max |
|---|---|---|---|---|---|---|---|
| 662 | 1,076 | 1,989 | 5,161 | 21,917 | 82,605 | 232,906 | 641,383 |

Cumulative: `≥2,000` → 76 sessions (9.8%), `≥4,000` → 57 (7.3%), `≥6,000` → 45
(5.8%), `≥8,000` → 40 (5.1%), `≥12,000` → 39 (5.0%), `≥20,000` → 39 (5.0%). The
plateau at exactly 39 from 12k to 20k is a hard cluster of genuinely long
conversations.

```ts
/** New rendered-transcript chars required before a session is re-reviewed. */
export const REVIEW_CHAR_THRESHOLD = 6_000;
/** Real user turns required before a session is reviewed at all. */
export const REVIEW_MIN_USER_TURNS = 2;
```

6,000 sits in the flat region: moving it to 4,000 adds ~12 sessions, to 8,000
removes ~5, out of 777. **The threshold is deliberately not a tuned number** —
its job is to exclude the single-turn mass, and any value in 4k–8k does that
identically. Recorded so a future reader doesn't mistake it for a fitted value
that must be preserved.

State at `.callback-box/chat-review/state.json`, one entry per session. Cursors
are a **map**, not flat fields, so that when the fan-out sinks eventually exist
(see NOT in scope) they can advance on their own cadence without reshaping the
file:

```ts
const CursorSchema = z.object({
  /** parseSessionLog entry index read through — the exclusive upper bound. */
  entryCount: z.number().int(),
  /** renderSessionCompact length of everything up to entryCount. */
  renderedChars: z.number().int(),
  /** When this cursor last advanced (getBoxTimeISO). */
  at: z.string(),
});

const ReviewSessionStateSchema = z.object({
  /** Keyed by consumer; "metadata" is the only one this plan ships. */
  cursors: z.record(z.string(), CursorSchema),
  /** sha256 of the title we wrote, so a hand-edit is detectable. See Track B. */
  titleHash: z.string().nullable(),
  /** Consecutive failures; at MAX_REVIEW_ATTEMPTS the session is skipped. */
  attempts: z.number().int(),
});
```

A session qualifies when it is quiet (reuse `QUIESCENCE_MS` from
`src/core/retro/discovery.ts:23`), has `≥ REVIEW_MIN_USER_TURNS` real user
turns, and `renderedChars(total) - cursors.metadata.renderedChars ≥
REVIEW_CHAR_THRESHOLD` — with an absent cursor treated as zeroed, so a first
look uses the same threshold.

**Cursor reset.** `entryCount` in the transcript going *below* the cursor means
the transcript was rewritten, not appended (SDK auto-compaction rewriting
history, a `--resume` fork, or `~/.claude` cleared and partially restored). A
real possibility, not an impossible state, so it degrades rather than asserts:
the cursor is zeroed and the session is treated as never reviewed. Logged at
`console.warn` per the logging policy — a degradation that stayed visible. The
existing account is *kept*, not discarded: it is still the best record of the
material that the rewrite destroyed.

Loading discipline copied in spirit from `src/core/retro/state.ts:56-82`:
missing file → fresh; unparseable JSON → warn and fresh; schema mismatch → warn
and fresh. Worst case of a lost state file is one extra pass per session — cheap,
and idempotent by design.

**First implementation chunk.** `src/core/chat/review/state.ts` +
`eligibility.ts` + the `renderSessionCompact` offset parameter + `cb chat review
status` (mirroring `src/cli/commands/retro.ts:53-66` `statusCommand`, including
its `--check` flag for procedure prechecks) + pure doctests over eligibility and
offset rendering. No LLM call in this chunk; the gate is independently
verifiable.

---

### Track B — The reviewer: title, `contains`, and the running account

**What.** One tool-less structured LLM call per qualifying session, receiving the
previous account and *only the new span*, returning an updated title, `contains`,
and account; written to the session's husk card.

**Why this needs to change.** The current label is the first user message, copied
once at husk creation and never revised — `src/core/chat/husk.ts:81` calls
`readSnippetTitle` inside `ensureChatHusk`, which runs at session-id assignment,
*before there is a transcript*. Its own comment concedes this: *"No transcript
yet (brand-new session) or unreadable — the husk starts untitled"* (lines 63-65).
So most husks have no title at all and every list falls back to the first-message
snippet — worst exactly where it matters, on long sessions that drifted from
their opening line.

**Direction.**

Where each output lives, and why:

| Output | Home | Extends? |
|---|---|---|
| `title` | husk `title` (global field) | Replaced when stale, else kept |
| `contains` | husk `contains` (global field) | **Regenerated from the account** each pass |
| the account | husk body, `## Review` section | **Extends** — the previous list is input |

`contains` is regenerated rather than accumulated, and that is a deliberate
departure worth naming. The requirement — that re-summarizing must not lose what
earlier passes knew — is satisfied by the *account* extending. Deriving the
one-sentence `contains` from the accumulated account (never from a re-read of an
elided transcript) means it inherits that completeness while staying what the
global field is documented to be: *"one sentence … the prime retrieval field for
search and listings"*. An accumulating `contains` would grow into a paragraph and
degrade the listing surface it exists to serve.

Output shape:

```ts
const ReviewOutputSchema = z.object({
  /** One line, information-dense, unique to this chat. Empty = keep existing. */
  title: z.string(),
  /** One sentence: what can be found in this conversation. Derived from notes. */
  contains: z.string(),
  /** The FULL updated account — previous notes, revised, plus what the new span adds. */
  notes: z.array(z.object({
    kind: z.enum(["decision", "open-thread", "follow-up", "learned"]),
    text: z.string(),
  })),
});
```

`notes` is returned whole rather than as a delta because a new span can *change*
an earlier item — an open thread gets resolved, a decision gets reversed. A
delta format could only append, which would leave the account accumulating
contradictions. The model is instructed to carry forward, revise, or drop, and
to merge the least durable items when the list exceeds a cap (~40) so it cannot
grow without bound.

Only the `## Review` section of the husk body is replaced; anything the
boxholder or an agent wrote outside it is preserved.

**Sensitivity is the prompt's job, and the prompt is the deliverable.** Titles
must read as if written for a semi-public audience, because session lists surface
where the conversation never does. The asymmetry that makes this load-bearing:

> The transcript lives at `~/.claude/projects/…` — outside the box, outside git,
> never pushed. The title lands on a `synced`-category card under
> `store/chat/web/` (`src/core/chat/husk.ts:21`), git-tracked and pushed to the
> box's git remote by the wakeup cycle. **The review moves content across a
> durability and exposure boundary the transcript never crossed** — and a title,
> once committed, is in git history whether or not it is later edited.

Prompt rules (the artifact to iterate; first draft):

- Name the *subject and shape* of the conversation, not its contents. "Sorting
  out a recurring billing problem" over the vendor, amount, or account.
- Write it as if read by someone standing behind the boxholder's shoulder who is
  not entitled to the details.
- For health, money, relationships, legal matters, employment, or anything the
  boxholder framed as private: name the *category* at most — never the
  particulars, never the other people involved.
- No names of people other than the boxholder. No amounts, no diagnoses, no
  addresses, no account or order identifiers.
- Distinctive enough to tell apart from the boxholder's other chats — a title is
  a way back to a conversation, so "A personal matter" fails the job even though
  it is discreet. Where discretion and distinctiveness genuinely conflict,
  discretion wins and the title says so plainly.
- Sentence case, no trailing period, roughly 4-9 words.

`contains` is held to the same standard and the same audience — it feeds search
and listings, so it is *more* exposed than the title, not less. The account is
held to a looser standard: it lives in the husk body, which is not a listing
surface, but it is still git-tracked and pushed, so the "no third-party names,
no identifiers" rules apply there too.

**Mechanical backstop.** Generated `title` and `contains` go through
`src/publish/leak-scan.ts` as a one-entry file map. A finding of kind `email`,
`credential` or `home-path` rejects the string; the pass keeps the previous value
and warns. This catches mechanical leaks only, and the code comment should say
so, quoting that module's own admission that prose PII is out of reach.

**Never overwrite a hand-edited title.** `state.titleHash` records the sha256 of
the title this pass wrote. On the next pass, if the husk's current title does not
hash to `titleHash`, a human or another agent changed it: the review updates
`contains` and the account but leaves `title` alone, and records that it is now
hands-off. Same reasoning as the template-merge policy, which decides *"is this
box on unmodified old stock, or did the boxholder edit the definition?"* by
comparing against a last-shipped hash (`src/cards/schema.ts`). A `titleHash` of
`null` — husk untitled, or titled by `ensureChatHusk`'s snippet path — is ours to
replace.

**Re-titling.** The model receives the existing title and may return `""` for
"still accurate, keep it". Titles churning every pass would make the history list
unstable to look at, so the default is stability and the model must actively
decide the title no longer covers the conversation.

Model and budget follow the retro observer exactly
(`src/core/retro/observer.ts:26-30`): `haiku`, `maxTurns: 4`, a hard
`maxBudgetUsd` ceiling. At ~45 eligible sessions on a first run and far fewer
nightly, cost is not a design constraint.

Behind a `ChatReviewer` interface with a scripted fake, per principle #10 and the
`RetroObserver` precedent (`src/core/retro/observer.ts:21-24`), so the whole pass
is doctestable without an LLM.

**Ordering guarantee.** The husk is written **before** the cursor advances. A
crash between them re-reviews that span (idempotent, since the model gets the
previous account and the same material) rather than skipping it forever.

**First implementation chunk.** `src/core/chat/review/reviewer.ts` (interface +
SDK implementation + prompt), `husk-write.ts` (husk read-modify-write through
`withCardLock` per code-style, including `## Review` section splicing), `run.ts`
(orchestration), `cb chat review run [--max-sessions] [--dry-run]` mirroring
`src/cli/commands/retro.ts:68-118`.

---

### Track C — One session-list codepath

**What.** Make `chat.sessions` title-aware, so generated titles actually appear
in the chat history dropdown.

**Why this needs to change.** Tracks A and B are invisible without it — see "The
bug this plan also closes". Two codepaths answering "what is this session called"
with different answers is a direct principle #8 violation, and the title-blind
one is the one the UI uses.

**Direction.** `chat-session-procedures.ts`'s `sessions` query resolves its label
the way `chat.ts:162` already does: husk `title` first, transcript snippet
second, id prefix last. The label-resolution logic becomes one exported helper
both call. Whether the two queries should merge entirely is left alone here —
they differ in enumeration source (history JSON vs husk cards), which is a real
behavioural difference: deleting a husk removes a session from the husk-based
picker but not the history-based one. This track unifies *labelling*, not
enumeration.

**First implementation chunk.** Extract `resolveSessionLabel`, call it from both,
route doctest asserting a husk title wins over a first-message snippet in
`chat.sessions`.

---

### Track D — The nightly schedule

**What.** Ship a default schedule so boxes can run the review overnight.

**Why this needs to change.** Without it the pass exists but never runs.

**Direction.** One new entry in `DEFAULT_SCHEDULES` (`src/core/box/defaults.ts`),
following the shipped `process-retrospective` entry's shape: an overnight `cron`,
a `notBefore` guard, `lockGroup: "retro"` (both passes walk every transcript in
`~/.claude/projects` and there is no reason to run them concurrently),
`runs: "cb chat review run"`, and `enabled: false` so it is opted into per box
rather than switched on by an upgrade.

Rollout is clean because the file is **net-new**: `installTemplateFile` takes the
`localContent === null` branch (`src/core/install-template-file.ts:331-338`),
writes the card, records its hash in the box's `config/template-versions.json`,
and returns `outcome: "fresh"`. The park-on-divergence hazard applies to
*changed* templates, not new ones, so no `priorStockHashes` entry and no manual
tracker seeding is needed.

**First implementation chunk.** The `DEFAULT_SCHEDULES` entry plus a line in
`docs/scheduler.md`'s example set.

---

## Subplans

None. The one candidate — the reviewer prompt — is not a subplan because it has
no decisions to settle that this document doesn't settle; it has *iteration* to
do, which is implementation work against real transcripts, not design work. If
the first pass over real sessions shows the prompt cannot hold discretion and
distinctiveness at once, that becomes a subplan then.

---

## Failure modes

> **Critical gap:** none unresolved. The one that would have been — a generated
> title silently leaking private content into git — is reduced (not eliminated)
> by the prompt, the leak-scan backstop, and hand-edit protection, and is
> accepted as a documented residual risk below.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Title accurately names a private topic (health, money, a third party) in a way no regex can catch | No — not testable | Prompt rules; boxholder can edit the husk title | **Silent** — accepted residual risk, see below |
| Transcript rewritten below the cursor (SDK auto-compaction, `--resume` fork, `~/.claude` cleared) | Yes — Track A doctest with a shrinking fixture | Zero the cursor, keep the account, re-review | Clear (`console.warn`) |
| Model drops or contradicts earlier account items when extending | Yes — Track B doctest asserting prior items survive an empty new span | Prompt instructs carry-forward-or-revise; prior account is in the prompt | Partially silent — the account is human-readable on the husk, so drift is visible on inspection |
| Account grows without bound over a long-lived session | Yes — Track B doctest at the cap | ~40-item cap; model merges least-durable items | Clear (the cap is visible in the output) |
| Husk written but cursor write fails (crash between) | No | Ordering: husk first, cursor second → the span is re-reviewed, not skipped | Clear by construction |
| Transcript deleted between eligibility and render | Yes — Track B doctest | Skip the session, no cursor write, retried next run | Clear (warn), matches `retro/scan.ts:65-68` |
| Model returns a title that fails leak-scan | Yes — Track B doctest | Keep previous title, still write `contains` and account | Clear (warn naming the finding kind) |
| Model call fails or exceeds budget | Yes — fake throws | `attempts += 1`; at `MAX_REVIEW_ATTEMPTS` the session is skipped permanently and reported | Clear, mirrors `retro/state.ts:19` |
| Boxholder hand-edits a title; review overwrites it | Yes — Track B doctest asserting hands-off | `titleHash` comparison | Clear — and it is the *absence* of an action |
| Husk missing for a session (never created, or deleted as editorial removal) | Yes | Skip; do not resurrect a husk the boxholder deleted | Clear (debug-level; deletion is intentional) |
| Two runs concurrently (manual `cb chat review run` during the scheduled one) | No | `withCardLock` on the husk; `lockGroup` on the schedule card | Partially silent — see below |
| `## Review` splice clobbers the boxholder's own body prose | Yes — Track B doctest with pre-existing body | Only the `## Review` section is replaced | Clear |

**Accepted residual risk — title discretion.** No mechanism can verify a
generated title is discreet enough, because the judgement is about content the
model has fully read and is being asked to describe carefully. The controls are
the prompt, a leak-scan backstop for mechanical leaks, the boxholder's ability to
edit any title (it is a card), and hand-edit protection so the edit sticks. The
plan adds no "sensitivity" flag and no redaction pipeline — nothing would consume
the flag, and per `src/publish/leak-scan.ts`'s own conclusion a regex layer would
produce false confidence rather than safety. A documented risk, not an oversight.

**Concurrent runs.** Two simultaneous runs would each do the LLM work and the
second would win the husk write — wasteful but not corrupting, since
`withCardLock` serializes the read-modify-write and the pass is idempotent by
construction. Not worth a cross-process lock; the schedule's `lockGroup` prevents
the realistic case.

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **ADDRESSED.** No new fields and no new tags:
  `title` and `contains` are `GLOBAL_CARD_FIELDS`, so there is no new choice for
  an agent to get wrong. The adjacent hazard — an agent writing prose into the
  husk body outside the `## Review` section — is harmless by design (that prose
  is preserved).
- **Stale ref** — **ADDRESSED.** The husk's `session` field may point at a
  transcript that is gone; `listChatHusks` tolerates this and `chat.ts:157-159`
  skips such sessions (*"log missing — session was cleaned up; nothing to
  resume, skip it"*). Review skips them too, and does **not** delete the husk — a
  husk whose transcript vanished stays browsable as a card, and its account is
  now the only record of the conversation.
- **Two agents touching the same card** — **ADDRESSED.** The chat agent may edit
  a husk while the nightly review writes to it. Handled by `withCardLock`
  (in-process serialization) plus the `titleHash` check, which turns a concurrent
  title edit into a permanent hands-off rather than a lost update.
- **Hand-edit drift** — **ADDRESSED.** A boxholder retitling a husk is the
  *expected* flow, not drift; `titleHash` makes it stick. Renaming the husk
  *file* is also expected and encouraged (`src/schemas/chat.ts:29`: *"renaming
  the file is safe and encouraged once the topic is clear"*) — `findChatHusk`
  tolerates it as long as the `_<shortid>` suffix survives, and a fully renamed
  husk drops out of review's reach, which is acceptable (it drops out of
  `ensureChatHusk`'s reach today).
- **Fabricated free-form value** — **GAP, partially.** An account is exactly the
  shape of output a model can confabulate: plausible "decisions" that were never
  decided — and the incremental design makes it worse, because a confabulated
  item is fed back as input on every subsequent pass and can entrench.
  Retro handles this by requiring `evidence` to be *"a LITERAL QUOTE copied from
  the transcript"* (`src/core/retro/observer.ts:44`). This plan does not carry
  quotes, because a title and a one-sentence `contains` have nowhere to put one.
  Mitigations: the prompt instructs that an empty `notes` array is the correct
  and common result (copying `observer.ts:48`: *"Do not invent observations. An
  empty list is the common, correct result for routine conversations."*), and the
  account is plain text on a card the boxholder can read and correct. Recorded as
  a gap rather than claimed solved. If run reports show entrenchment, the fix is
  a quote field on `notes` — which the incremental design makes *more* valuable,
  since a quote can be checked against the span it came from.
- **Validation error UX** — **ADDRESSED.** The only new validation surface is
  `ReviewOutputSchema` against the SDK's structured output, which
  `invokeStructured` already reports as a typed failure (`src/core/agent/json.ts`
  `validateStructuredResult`); a failure counts as an attempt and is reported in
  the run summary. Husk cards continue to validate through the normal card path —
  `title`/`contains` being global optional strings means a written review cannot
  make a husk invalid.
- **Partial migration / transition state** — **ADDRESSED.** No data migration.
  Existing husks are either untitled (most, because `ensureChatHusk` runs before
  a transcript exists) or carry a snippet title written at creation. Both have
  `titleHash: null` in fresh state, so both are ours to replace. Boxes that never
  enable the schedule keep exactly today's behaviour.

---

## NOT in scope

- **The issue's fan-out to other sinks.** The original issue lists hunches →
  hunch file, action items → questions queue, facts → person/topic cards, naming
  four sibling issues as consumers
  ([session hot-context](../../../issues/features/2026-05-19-session-hot-context.md),
  [hypothesis tracking](../../../issues/exploration/2026-05-19-hypothesis-tracking.md),
  [behavioral profile](../../../issues/exploration/2026-05-19-behavioral-profile.md),
  [memory-writing guidance](../../../issues/exploration/2026-05-19-memory-writing-guidance.md)).
  **None of those sinks exist yet.** Building a fan-out to unbuilt destinations
  would be designing four subsystems by implication. This plan delivers the
  engine and one destination that exists today (the husk); the `cursors` map is
  shaped so the fan-out can be added without reshaping state.
- **The issue's "Full" tier** — daily/weekly cross-session rollups. Same reason:
  needs a destination and an audience decision. Light and Medium tiers, as the
  issue defines them, are what this plan covers.
- **Merging chat review into the retro pass.** They read the same transcripts and
  a combined pass would halve the reads. Deferred because their eligibility
  models are genuinely different (retro: once ever, any chat; review: repeatable,
  size-gated, cursor-based), and forcing them together now would compromise the
  cursor design to fit retro's terminal state. Revisit once review has run in the
  field.
- **Reviewing non-web-chat sessions** (telegram/messaging threads, which have
  `chat-thread` cards, not husks). Different card, different lifecycle; adding it
  now doubles the write surface for no stated need.
- **Backfilling titles for the existing history.** A first run naturally picks up
  every eligible session, which *is* the backfill — under the same gate, so short
  old sessions stay snippet-labelled. Intended outcome, not a shortfall.
- **A UI for browsing or editing accounts.** The husk card renders today
  (`src/frontend/src/components/chat-husk/ChatHuskView.tsx`) and the `## Review`
  section renders as markdown within it. A dedicated surface is not required for
  the feature to be useful.
- **Deleting or trimming transcripts.** Space-reclaiming compaction is not what
  this is; `~/.claude` is untouched.

---

## Open design questions

- **Should a hand-edited *account* also be protected, the way the title is?**
  The title has `titleHash`; the `## Review` section does not, so a boxholder who
  corrects a confabulated note would see it overwritten next pass. Hashing the
  section is the same cheap trick, but it would also freeze the account
  permanently on first correction, which defeats the point of an extending
  record. **Lean:** ship without it, and instead feed the *current* section
  (whatever it now says, corrections included) back as the model's input — a
  correction then propagates forward instead of being reverted, which is the
  behaviour actually wanted. Worth confirming this reads as intended once there
  are real accounts to look at.
- **Should `contains` regeneration be gated on the account having changed?**
  Rewriting an identical sentence every pass dirties the card and the git history
  for nothing. **Lean:** yes, skip the write when the generated value equals the
  stored one — trivial, and it keeps `git log` on husks meaningful.
- **Does the ~40-item account cap want to be a size cap instead?** Item count is
  crude; a single note can be a paragraph. **Lean:** ship the count cap, revisit
  if real accounts show long items.
- **`cb chat review` vs a `cb review chat`-style top-level command.** **Lean:**
  subcommand of the existing `cb chat` family (`src/cli/commands/chat.ts:275`),
  since every other session-scoped operation already lives there.

---

## Knowledge audits

This plan introduces one agent-facing concept and touches a second:

1. **New:** the husk `title` and `## Review` section are machine-maintained, and
   hand-edits to the title are respected. An agent that rewrites husk titles in
   bulk would fight the review; an agent that believes titles are purely manual
   would not know a nightly pass exists.
2. **Existing, now load-bearing:** `src/schemas/chat.ts:31` already instructs
   *"set `title` and `contains` once the conversation has a topic"*. That needs a
   clause saying the nightly chat review also maintains them and that a hand-set
   title wins — otherwise the schema instruction and the new behaviour contradict
   each other in the agent's context.

Proposed entries in `src/dev/knowledge-audits.yaml` (format per the existing 236
entries — `id`, `prompt`, `expected_level`, `watch_for`, `correct_contains`,
`tags`):

```yaml
  - id: chat-husk-title-ownership
    prompt: "Who sets the title on a chat husk card, and what happens if I edit one by hand?"
    expected_level: knows_directly
    watch_for: "Says the nightly chat review maintains it AND that a hand-edited title is left alone"
    correct_contains: ["review", "hand"]
    tags: [chat, cards, chat-review]

  - id: chat-review-vs-compaction
    prompt: "What does 'compaction' refer to in this codebase?"
    expected_level: knows_directly
    watch_for: "Names the SDK context-window meaning, and does NOT confuse it with chat review"
    correct_contains: ["context"]
    tags: [vocabulary, chat-review]
```

Both land **run**, not just written: `pnpm knowledge-audit run --box <absolute
path to a test box> --filter chat-review`, with the status comment recorded in
`knowledge-audits.yaml` before the plan completes. (Note: `--box` takes a *path*;
a bare name resolves inside the monorepo.)

---

## Implementation order

1. **Track A** — `src/core/chat/review/state.ts`, `eligibility.ts`, the
   `renderSessionCompact` offset parameter and its move to a shared home, `cb
   chat review status`. No LLM. Independently verifiable; unblocks everything.
2. **Track B** — `reviewer.ts` (interface + fake + SDK impl + prompt),
   `husk-write.ts`, `run.ts`, `cb chat review run`. Depends on A.
3. **Prompt iteration** — run `cb chat review run --dry-run` and then a real run
   against the test box's transcripts, read the titles and accounts, revise the
   prompt. This is where the sensitivity requirement is actually met or missed,
   and where extension quality first becomes observable; budget real time for it
   rather than treating it as a code chunk. Depends on B.
4. **Track C** — unify session-list labelling. Independent of A/B in code, but
   sequenced after B so the doctest can assert against a title the review could
   plausibly have written. Without this, nothing is visible in the UI.
5. **Track D** — the `DEFAULT_SCHEDULES` entry + `docs/scheduler.md` mention.
   Last, because it turns on work the earlier chunks made correct.
6. **Docs + audits** — a `docs/chat-review.md` reference doc (the "how it works
   now" half), the `src/schemas/chat.ts` instructions clause from the Knowledge
   audits section, and the two audits **run**.

---

## Rollout shape

**Tests, named up front as design tools** (per `docs/testing.md`; tiers per
CLAUDE.md):

- `test/core/chat/review/eligibility.doctest.md` — **pure**. The gate: below
  threshold, above threshold, below minimum turns, cursor satisfied, cursor reset
  on a shrunk transcript. This test is what forces eligibility to be a pure
  function of (metadata, rendered length, state) rather than something that reads
  the disk itself.
- `test/core/chat/review/state.doctest.md` — **pure**. Missing file, corrupt
  JSON, schema mismatch; each starts fresh with a warning.
- `test/core/chat/render-span.doctest.md` — **pure**. Offset rendering: offset 0
  matches today's whole-transcript output (the regression anchor for retro's
  unchanged call site), a mid-transcript offset yields only later entries, an
  offset past the end yields empty.
- `test/core/chat/review/run.doctest.md` — **filesystem** (`makeTmpBox()`),
  scripted fake reviewer. Happy path; **prior account items survive a pass whose
  new span adds nothing** (the extension regression anchor); hand-edited title
  left alone; leak-scan rejection keeps the old title but still writes the
  account; pre-existing husk body prose preserved outside `## Review`; transcript
  vanishing mid-run; account cap enforced.
- `test/webapp/chat-sessions-label.doctest.md` — **route**
  (`makeTestServer()`). A husk title wins over the first-message snippet in
  `chat.sessions` — the assertion that Track C landed.

**Done-when**, as checkable assertions: `cb chat review status` reports 0 ready
on a box with only single-turn transcripts; a session that grows past 6,000 new
rendered chars reports ready and, after `cb chat review run`, has a non-empty
husk `title` and `contains` and a `## Review` section; running again immediately
reports 0 sessions; growing the session further and re-running *extends* the
account rather than replacing it; editing the title by hand and re-running leaves
it unchanged; the chat history dropdown shows the generated title.

**Knowledge audits** — both entries above land with the plan, run, with status
comments recorded. Neither is deferred.

**Migration** — none. No card shape changes (`title`/`contains` are global
optional fields), no on-disk data moves, no existing state file is rewritten. The
review state file is created on first run. A box that never enables the schedule
sees no behaviour change; a box that enables it sees titles improve on the ~5% of
sessions long enough to qualify, and can turn it back off with the schedule
card's `enabled` toggle without leaving anything half-migrated.

**Template rollout** — the new schedule card is net-new, so it installs cleanly on
every box via `installTemplateFile`'s fresh-install branch and needs no tracker
seeding (see Track D). It ships `enabled: false`; turning it on is a per-box
decision.
