# Session digests: size-gated overnight compaction and generated titles

**Status:** active — designed 2026-07-28, nothing implemented

A nightly pass that looks at chat sessions which have accumulated enough *new*
material since it last looked, and writes two things back to the session's husk
card: a **title** (an information-dense one-liner that replaces the current
first-message-snippet label) and a **digest** (durable residue — decisions, open
threads, follow-ups). The gate is a watermark, not a boolean, so a conversation
that keeps growing gets re-titled and re-digested; a conversation that stops
growing is never re-read.

Filed as [overnight session compaction](../../../issues/features/2026-05-19-overnight-session-compaction.md);
this plan resolves that issue's `needs: [design]`.

---

## Stated preferences this plan trades against

- **`docs/engineering-principles.md`** — findings trace to:
  - **#4 Resilient AND never silent — and never resilient to the impossible.**
    The digest is a best-effort enrichment pass; every degradation
    (unreadable transcript, observer failure, leak-scan rejection) must leave
    the session usable and say so, not fail the run and not fail silently.
  - **#8 One way to do each thing.** There are currently *two* session-list
    codepaths with different labelling behaviour (Track C). Adding a title
    without unifying them would make it three.
  - **#10 Testability is architectural.** The observer goes behind an
    interface with a scripted fake, as `RetroObserver` already does
    (`src/core/retro/observer.ts:21-24`).
  - **#12 The maintainer is usually an agent.** "Compaction" already means
    something else in this codebase; reusing it would cost every future agent
    a disambiguation (Track A vocabulary lock-in).
- **`callback-box/CLAUDE.md`** — the "don't add features beyond what the task
  requires" rule bounds the digest's fan-out (see NOT in scope); the
  time-discipline rule (`getBoxTime`, not `new Date()`) applies to every
  timestamp this plan writes.
- **`callback-box/code-style.md`** — max 2 positional params, no default
  parameters, no `any`, explicit return types on exports, `Result` vs throw.
- **Most recent shipped precedent: box retrospectives**
  (`docs/implemented-plans/box-retrospectives.md`, `src/core/retro/`). It is
  the same shape of thing — a scheduled walker over chat transcripts that runs
  a cheap tool-less LLM pass and records results with dedupe. Where this plan
  deviates from that precedent, it says why.

---

## What already exists

**Reused as-is:**

- `src/core/retro/render.ts:57` `renderSessionCompact(logPath)` — dialogue plus
  tool one-liners, tool results dropped, middle elided over
  `MAX_RENDERED_CHARS = 40_000` (line 21). This is exactly the rendering the
  digest wants, and its output size is the unit this plan's threshold is stated
  in. **Reuse**, promoted out of `retro/` to a shared home (Track A).
- `src/cli/lib/session.ts:205` `getSessionMetadata({sessionId, logPath, snippetMaxLen})`
  → `userTurns`, `assistantTurns`, `firstUserSnippet`, already filtering
  plumbing messages, SDK compaction summaries and self-notes
  (`foldUserMetadata`, lines 158-177). **Reuse** for the turn-count half of the
  gate and for the snippet fallback.
- `src/core/agent/index.ts` `createAgent(...).invokeStructured(schema, opts)` —
  the "one cheap scoped LLM call with a Zod-validated result" helper. The retro
  observer's use is the template: `src/core/retro/observer.ts:69-76` passes
  `model: "haiku"`, `maxTurns: 4`, `maxBudgetUsd: MAX_BUDGET_USD`. **Reuse**.
- `src/core/chat/husk.ts:42` `findChatHusk(boxRoot, sessionId)` and
  `src/core/chat/husk.ts:128` `listChatHusks(boxRoot)` — husk lookup and
  enumeration, already surfacing `title` (`ChatHuskEntry.title`, line 119).
  **Reuse** as the read/write target.
- **`title` needs no schema change.** It is a global card field:
  `src/cards/schema.ts` `GLOBAL_CARD_FIELDS` declares
  *"`title` — human-readable display title."* as `z.string().optional()` on
  every card type, so `src/schemas/chat.ts:16-22` not listing it is correct,
  not a gap. `contains` is global too — *"one sentence stating what can be
  found inside this card; the prime retrieval field for search and listings"* —
  which is precisely where a one-sentence digest summary belongs. **Reuse both;
  add no fields.**
- `src/publish/leak-scan.ts` — a **pure** function over a text file map
  returning `LeakFinding[]` for home-dir paths, non-allowlisted emails,
  credential shapes and absolute URLs. **Reuse** as the mechanical backstop on
  generated titles (Track B), by handing it a one-entry map.
- `src/schemas/scheduled-script.tsx:48` `ScheduledScriptSchema` +
  `cb tick` (`src/cli/commands/tick.ts`) — how a nightly job is expressed.
  Shipped schedules are **defined in code**, not as template card files:
  `DEFAULT_SCHEDULES` in `src/core/box/defaults.ts` (the retro entry ends at
  line 272), installed per box by `installSchedules` (line 282) through
  `installTemplateFile`. **Reuse**; the digest adds one entry to that array.

**Deliberately NOT reused (rebuilt, with reasons):**

- `src/core/retro/state.ts` — retro's walker state is a **terminal** predicate:
  `isSessionSettled` (line 43) returns true for `status: "done"` and *"A session
  marked `done` is never re-observed"* (lines 5-6). The digest is the opposite:
  a session must be re-read every time it grows past the threshold again. The
  state file is therefore a new one with a watermark shape, not a reuse of
  `RetroState`. The *loading discipline* — missing file starts fresh, corrupt
  file warns and starts fresh (`loadRetroState`, lines 56-82) — is copied.
- `src/core/retro/discovery.ts` — retro's qualification is
  "is this a chat, is it quiet, is it unsettled" (lines 99-117) with no size
  notion. The digest needs "how much *new* rendered material since the
  watermark", which `discoverSessions` cannot express. New function, sharing
  the quiescence constant.

**The bug this plan also closes.** There are two session-list codepaths with
different labelling:

- `src/webapp/trpc/routers/chat.ts:162` — husk-based, title-aware:
  `let label = husk.title ?? husk.session.slice(0, 8);` with the transcript
  snippet used only *"if (husk.title === undefined)"* (line 163). The doc
  comment states the intent: *"a husk `title` beats the transcript snippet"*
  (line 136).
- `src/webapp/trpc/routers/chat-session-procedures.ts:74-80` — history-JSON
  based, **title-blind**: `let label = sessionId.slice(0, 8);` … `if
  (meta.firstUserSnippet) label = meta.firstUserSnippet;`. It never reads a
  husk.

`src/frontend/src/api-chat.ts:158` (`trpcClient.chat.sessions.query()`) is the
title-blind one, and it is what `SessionListButton.tsx` renders. So generated
titles would be invisible in the chat history dropdown until Track C lands.

---

## Prior art (external)

- **"Anchored incremental summarization" is the named pattern for the
  watermark design** — maintain a persistent structured document and extend it
  per new span rather than regenerating from scratch, avoiding the O(n²) cost
  of re-summarizing the whole conversation each pass.
  [Memory Consolidation and Summarization Techniques](https://apxml.com/courses/agentic-llm-memory-architectures/chapter-3-designing-memory-systems/memory-consolidation-summarization),
  [Memory in the Age of AI Agents](https://arxiv.org/pdf/2512.13564).
  This plan uses the weaker "re-read from the top, cap by elision" variant
  rather than true incremental extension — see Open design questions for why,
  and what would make us switch.
- **Production evidence that incremental beats bulk** — Airbnb's deployed
  incremental case-summarization reported ~3% lower handling time vs bulk
  summarization, up to ~9% on complex cases.
  [Incremental Summarization for Customer Support via Progressive Note-Taking and Agent Feedback](https://arxiv.org/pdf/2510.06677).
  Weak support: their metric is human handling time, not summary quality, and
  their spans are support cases, not open-ended chat. Recorded so the next
  person doesn't re-find it and over-read it.
- **Auto-titling from the first prompt, with a manual override, is the
  industry-standard pattern** — sidebar/history entries titled from the opening
  message and user-editable.
  [AI Chat UI Best Practices for 2026](https://thefrontkit.com/blogs/ai-chat-ui-best-practices).
  That is what this box already does; the prior art confirms the baseline, not
  the improvement.
- **No prior art found for sensitivity-aware title generation.** Searches for
  privacy-conscious chat titling returned only prompt-sanitization and PII-
  redaction work — [Sanitizing Sensitive Prompts for LLMs](https://arxiv.org/html/2504.05147v2),
  [When Prompts Leak Secrets](https://www.keysight.com/blogs/en/tech/nwvs/2025/08/04/pii-disclosure-in-user-request) —
  which is a different problem (scrubbing tokens *before* the model sees them,
  not asking the model to write a *discreet* label about content it has fully
  read). This is an empty search, and it is a finding: the titler prompt
  (Track B) is the artifact carrying the whole requirement, with no external
  design to copy. It should be iterated against real transcripts, not written
  once.
- **The project's own precedent says the regex backstop cannot carry this.**
  `src/publish/leak-scan.ts` states it in its header: the scan *"does NOT
  meaningfully cover"* PII or secrets *"in prose form"*, and *"the human
  file-by-file preview is the only real gate"*. Applied here: leak-scan catches
  a title that accidentally contains an email or an API key; it cannot catch a
  title that accurately and discreetly-but-not-discreetly-enough names a
  medical or financial topic. Only the prompt and the boxholder's edit can.

---

## Tracks / scope

### Track A — Eligibility: the watermark gate (`src/core/digest/`)

**What.** A discovery function that returns the sessions worth reading tonight,
plus the per-session state file that makes "worth reading" mean "grew since
last time" rather than "never read".

**Why this needs to change.** Nothing today expresses "how much new material
has this session accumulated". Retro's walker answers a once-ever question
(`src/core/retro/state.ts:5-6`: *"A session marked `done` is never
re-observed"*). Running an LLM pass over every session nightly is not viable:
of 777 measured box transcripts, ~90% are single-turn non-chat invocations
(scheduled tasks, reactor runs) that share `~/.claude/projects/`.

**Direction.**

Vocabulary lock-in: this subsystem is called **digest**, never "compaction".
"Compaction" is already taken in this codebase for the SDK's context-window
compaction — `src/cli/lib/session-text.ts:22-27` `isCompactionSummary()` detects
*"This session is being continued from a previous conversation that ran out of
context."* Two meanings for one word in a codebase whose maintainer is usually
an agent (principle #12) is a cost paid on every future read. `digest` /
`cb digest` / `.callback-box/digest/` throughout.

Measured in `renderSessionCompact` output characters — the unit that is
actually sent to the model, deterministic, and already computed. Distribution
across the same 777 transcripts:

| p50 | p75 | p90 | p94 | p95 | p97 | p99 | max |
|---|---|---|---|---|---|---|---|
| 662 | 1,076 | 1,989 | 5,161 | 21,917 | 82,605 | 232,906 | 641,383 |

Cumulative counts: `≥2,000` → 76 sessions (9.8%), `≥4,000` → 57 (7.3%),
`≥6,000` → 45 (5.8%), `≥8,000` → 40 (5.1%), `≥12,000` → 39 (5.0%),
`≥20,000` → 39 (5.0%). The plateau at exactly 39 from 12k to 20k is a hard
cluster of genuinely long conversations.

```ts
/** New rendered-transcript chars required before a session is re-digested. */
export const DIGEST_CHAR_THRESHOLD = 6_000;
/** Real user turns required before a session is digested at all. */
export const DIGEST_MIN_USER_TURNS = 2;
```

6,000 sits in the flat region: moving it to 4,000 adds ~12 sessions, moving it
to 8,000 removes ~5, out of 777. **The threshold is deliberately not a tuned
number** — its job is to exclude the single-turn mass, and any value in
4k–8k does that identically. Recording this here so a future reader doesn't
mistake it for a value that was fitted and must be preserved.

State at `.callback-box/digest/state.json`, one entry per session:

```ts
const DigestSessionStateSchema = z.object({
  /** parseSessionLog entry count at the last successful digest — the watermark. */
  entryCount: z.number().int(),
  /** renderSessionCompact length at the last successful digest. */
  renderedChars: z.number().int(),
  /** sha256 of the title we wrote, so a hand-edit is detectable. See Track B. */
  titleHash: z.string().nullable(),
  at: z.string(),
  /** Consecutive failures; at MAX_DIGEST_ATTEMPTS the session is skipped. */
  attempts: z.number().int(),
});
```

A session qualifies when: it is quiet (reuse `QUIESCENCE_MS` from
`src/core/retro/discovery.ts:23`), has `≥ DIGEST_MIN_USER_TURNS` real user
turns, and `renderedChars - state.renderedChars ≥ DIGEST_CHAR_THRESHOLD` (with
absent state treated as `renderedChars: 0`, so a first look uses the same
threshold).

**Watermark reset.** `entryCount` going *down* between runs means the transcript
was rewritten, not appended (SDK auto-compaction rewriting history, a `--resume`
fork, or `~/.claude` being cleared and partially restored). That is a real
possibility, not an impossible state, so it degrades rather than asserts: the
state entry is discarded and the session is treated as never digested. Logged
at `console.warn` per the logging policy — a degradation that stayed visible.

Loading discipline copied verbatim in spirit from
`src/core/retro/state.ts:56-82`: missing file → fresh; unparseable JSON → warn
and fresh; schema mismatch → warn and fresh. The worst case of a lost state
file is one extra LLM pass per session, which is cheap and idempotent by
design.

**First implementation chunk.** `src/core/digest/state.ts` +
`src/core/digest/eligibility.ts` + `cb digest status` (mirroring
`src/cli/commands/retro.ts:53-66` `statusCommand`, including its `--check` flag
for procedure prechecks) + a pure doctest over eligibility with fixture
transcripts. No LLM call in this chunk; the gate is independently verifiable.

---

### Track B — The titler and the digest pass

**What.** One tool-less structured LLM call per qualifying session, returning a
title, a one-sentence `contains`, and digest residue; written to the session's
husk card.

**Why this needs to change.** The current label is the first user message,
copied once at husk creation and never revised —
`src/core/chat/husk.ts:81` calls `readSnippetTitle` inside `ensureChatHusk`,
which runs at session-id assignment, *before there is a transcript*. Its own
comment concedes this: *"No transcript yet (brand-new session) or unreadable —
the husk starts untitled"* (lines 63-65). So in practice most husks have no
title at all and every list falls back to the first-message snippet — which is
worst exactly where it matters, on the long sessions that drifted from their
opening line.

**Direction.**

Output shape:

```ts
const DigestOutputSchema = z.object({
  /** One line, information-dense, unique to this chat. Empty = keep existing. */
  title: z.string(),
  /** One sentence: what can be found in this conversation. */
  contains: z.string(),
  /** Durable residue: decisions made, open threads, follow-ups. May be empty. */
  notes: z.array(z.object({
    kind: z.enum(["decision", "open-thread", "follow-up", "learned"]),
    text: z.string(),
  })),
});
```

Written to the husk: `title` → the global `title` field, `contains` → the global
`contains` field, `notes` → a `## Digest` section in the husk body, replaced
wholesale each pass (the notes describe the whole conversation, so appending
would duplicate). Anything the boxholder or an agent wrote in the body *outside*
that section is preserved.

**Sensitivity is the prompt's job, and the prompt is the deliverable.** The
requirement: titles must read as if written for a semi-public audience, because
session lists surface in places the conversation itself never does. The
asymmetry that makes this load-bearing:

> The transcript lives at `~/.claude/projects/…` — outside the box, outside
> git, never pushed. The title lands on a `synced`-category card under
> `store/chat/web/` (`src/core/chat/husk.ts:21`), which is git-tracked and
> pushed to the box's git remote by the wakeup cycle. **The digest moves
> content across a durability and exposure boundary that the transcript never
> crossed** — and a title, once committed, is in git history whether or not it
> is later edited.

Prompt rules (the artifact to iterate; first draft):

- Name the *subject and shape* of the conversation, not its contents. "Sorting
  out a recurring billing problem" over the vendor, amount, or account.
- Write it as if it will be read by someone standing behind the boxholder's
  shoulder who is not entitled to the details.
- For health, money, relationships, legal matters, employment, or anything the
  boxholder framed as private: name the *category* at most, never the
  particulars, never the other people involved.
- No names of people other than the boxholder. No amounts, no diagnoses, no
  addresses, no account or order identifiers.
- Distinctive enough to tell apart from the boxholder's other chats — a title
  is a way back to a conversation, so "A personal matter" fails the job even
  though it is discreet. If discretion and distinctiveness genuinely conflict,
  discretion wins and the title says so plainly.
- Sentence case, no trailing period, roughly 4-9 words.

`contains` is held to the same standard and the same audience — it feeds search
and listings, so it is *more* exposed than the title, not less.

**Mechanical backstop.** The generated `title` and `contains` are run through
`src/publish/leak-scan.ts` as a one-entry file map. A finding of kind `email`,
`credential` or `home-path` rejects the string; the pass keeps the previous
title and warns. This catches the mechanical leaks only, and the code comment
should say so, quoting that module's own admission that prose PII is out of
reach.

**Never overwrite a hand-edited title.** `state.titleHash` records the sha256 of
the title this pass wrote. On the next pass, if the husk's current title does
not hash to `titleHash`, a human or another agent changed it: the digest updates
`contains` and the body notes but leaves `title` alone, and records that it is
now hands-off. This is the same reasoning the template-merge policy uses —
`src/cards/schema.ts` describes deciding *"is this box on unmodified old stock,
or did the boxholder edit the definition?"* by comparing against the
last-shipped hash. A `titleHash` of `null` (husk untitled, or title written by
`ensureChatHusk`'s snippet path) is treated as ours to replace.

**Re-titling.** The model receives the existing title and may return `""` to
mean "still accurate, keep it". Titles churning on every pass would make the
history list unstable to look at, so the default is stability and the model has
to actively decide the title no longer covers the conversation.

Model and budget follow the retro observer exactly
(`src/core/retro/observer.ts:26-30`): `haiku`, `maxTurns: 4`, a hard
`maxBudgetUsd` ceiling. At ~45 eligible sessions across all boxes on a first
run and far fewer nightly, cost is not a design constraint.

Behind an interface (`Digester`) with a scripted fake, per principle #10 and
the `RetroObserver` precedent (`src/core/retro/observer.ts:21-24`), so the whole
pass is doctestable without an LLM.

**First implementation chunk.** `src/core/digest/digester.ts` (interface + SDK
implementation + prompt), `src/core/digest/husk-write.ts` (the husk
read-modify-write, through `withCardLock` per code-style), `src/core/digest/run.ts`
(orchestration), `cb digest run [--max-sessions] [--dry-run]` mirroring
`src/cli/commands/retro.ts:68-118`. Doctests: the fake-digester happy path, the
hand-edited-title hands-off path, and the leak-scan rejection path.

---

### Track C — One session-list codepath

**What.** Make `chat.sessions` title-aware, so generated titles actually appear
in the chat history dropdown.

**Why this needs to change.** Tracks A and B are invisible without it — see
"The bug this plan also closes" above. Two codepaths answering "what is this
session called" with different answers is a direct principle #8 violation, and
the title-blind one is the one the UI uses.

**Direction.** `chat-session-procedures.ts`'s `sessions` query resolves its
label the way `chat.ts:162` already does: husk `title` first, transcript snippet
second, id prefix last. The label-resolution logic becomes one exported helper
that both call, rather than two similar blocks. Whether the two queries should
merge entirely (they differ in enumeration source: history JSON vs husk cards,
which is a real behavioural difference — deleting a husk removes a session from
the husk-based picker but not the history-based one) is left alone here; this
track unifies *labelling*, not enumeration.

**First implementation chunk.** Extract `resolveSessionLabel`, call it from
both, route doctest asserting a husk title wins over a first-message snippet in
`chat.sessions`.

---

### Track D — The nightly schedule

**What.** Ship a `scheduled-script` template so boxes can run the digest
overnight.

**Why this needs to change.** Without it the pass exists but never runs.

**Direction.** One new entry in `DEFAULT_SCHEDULES`
(`src/core/box/defaults.ts`), following the shipped `process-retrospective`
entry's shape: a `cron` overnight, a `notBefore` guard, `lockGroup: "retro"`
(both passes walk every transcript in `~/.claude/projects` and there is no
reason to have them do it concurrently), `runs: "cb digest run"`, and
`enabled: false` so it is opted into per box rather than switched on by an
upgrade.

Rollout is clean because the file is **net-new**: `installTemplateFile` takes
the `localContent === null` branch (`src/core/install-template-file.ts:331-338`),
writes the card and records its hash in the box's
`config/template-versions.json`, returning `outcome: "fresh"`. The
park-on-divergence hazard applies to *changed* templates, not new ones, so no
`priorStockHashes` entry and no manual tracker seeding is needed.

**First implementation chunk.** The `DEFAULT_SCHEDULES` entry plus a line in
`docs/scheduler.md`'s example set.

---

## Subplans

None. The one candidate — the titler prompt — is not a subplan because it has
no decisions to settle that this document doesn't settle; it has *iteration* to
do, which is implementation work against real transcripts, not design work. If
the first pass over real sessions shows the prompt cannot hold discretion and
distinctiveness at once, that becomes a subplan then.

---

## Failure modes

> **Critical gap:** none unresolved. The one that would have been —
> a generated title silently leaking private content into git — is reduced (not
> eliminated) by the prompt, the leak-scan backstop, and hand-edit protection,
> and is accepted as a documented residual risk below.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Title accurately names a private topic (health, money, a third party) in a way no regex can catch | No — not testable | Prompt rules; boxholder can edit the husk title | **Silent** — accepted residual risk, see below |
| `entryCount` shrinks (SDK auto-compaction rewrote history, `--resume` fork, `~/.claude` cleared) | Yes — Track A doctest with a shrinking fixture | Discard state, re-digest from scratch | Clear (`console.warn`) |
| Transcript deleted between eligibility and render | Yes — Track B doctest | Skip the session, no state write, retried next run | Clear (warn), matches `retro/scan.ts:65-68` |
| Digester returns a title that fails leak-scan | Yes — Track B doctest | Keep previous title, still write `contains`/notes | Clear (warn naming the finding kind) |
| Digester call fails or exceeds budget | Yes — fake throws | `attempts += 1`; at `MAX_DIGEST_ATTEMPTS` the session is skipped permanently and reported | Clear, mirrors `retro/state.ts:19` |
| Boxholder hand-edits a title; digest overwrites it | Yes — Track B doctest asserting hands-off | `titleHash` comparison | Clear — and it is the *absence* of an action |
| Husk missing for a session (never created, or deleted as editorial removal) | Yes | Skip; do not resurrect a husk the boxholder deleted | Clear (debug-level; deletion is intentional) |
| Two digest runs concurrently (manual `cb digest run` during the scheduled one) | No | `withCardLock` on the husk; `lock-group` on the schedule card | Partially silent — see below |
| State file written but husk write fails (crash between) | No | Watermark advances without residue → that growth is never digested | **Silent** — mitigated by ordering: husk write first, state write second, so a crash re-digests rather than skips |
| Digest body section clobbers boxholder's own body prose | Yes — Track B doctest with pre-existing body | Only the `## Digest` section is replaced | Clear |

**Accepted residual risk — title discretion.** No mechanism can verify that a
generated title is discreet enough, because the judgement is about content the
model has fully read and is being asked to describe carefully. The controls are:
the prompt, a leak-scan backstop for mechanical leaks, the boxholder's ability to
edit any title (it is a card), and hand-edit protection so an edit sticks. The
plan does not add a "sensitivity" flag or a redaction pipeline — there is
nothing that would consume the flag, and per `src/publish/leak-scan.ts`'s own
conclusion a regex layer would produce false confidence rather than safety. This
is a documented risk, not an oversight.

**Concurrent runs.** Two simultaneous digest runs would each do the LLM work and
the second would win the husk write — wasteful but not corrupting, since
`withCardLock` serializes the read-modify-write and the digest is idempotent by
construction. Not worth a cross-process lock; the schedule's `lock-group`
prevents the realistic case.

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **ADDRESSED.** No new fields and no new tags:
  `title` and `contains` are `GLOBAL_CARD_FIELDS` (`src/cards/schema.ts`), so
  there is no new choice for an agent to get wrong. The one adjacent hazard —
  an agent writing digest notes into the husk body outside the `## Digest`
  section — is harmless by design (that prose is preserved).
- **Stale ref** — **ADDRESSED.** The husk's `session` field points at a
  transcript that may be gone; `listChatHusks` already tolerates this and
  `chat.ts:157-159` skips such sessions (*"log missing — session was cleaned up;
  nothing to resume, skip it"*). The digest skips them too, and does **not**
  delete the husk — a husk whose transcript vanished stays browsable as a card.
- **Two agents touching the same card** — **ADDRESSED.** The chat agent may edit
  a husk while the nightly digest writes to it. Handled by `withCardLock`
  (in-process serialization) plus the `titleHash` check, which turns a
  concurrent title edit into a permanent hands-off rather than a lost update.
- **Hand-edit drift** — **ADDRESSED.** A boxholder retitling a husk is the
  *expected* flow, not drift; `titleHash` makes it stick. A boxholder renaming
  the husk *file* is also expected and encouraged (`src/schemas/chat.ts:29`:
  *"renaming the file is safe and encouraged once the topic is clear"*) —
  `findChatHusk` tolerates it as long as the `_<shortid>` suffix survives, and a
  fully renamed husk simply drops out of the digest's reach, which is acceptable
  (it also drops out of `ensureChatHusk`'s reach today).
- **Fabricated free-form value** — **GAP, partially.** A digest is exactly the
  shape of output a model can confabulate: plausible "decisions" that were never
  decided. Retro handles this by requiring `evidence` to be *"a LITERAL QUOTE
  copied from the transcript"* (`src/core/retro/observer.ts:44`). This plan does
  **not** carry quotes on digest notes, because a title and a `contains`
  sentence have nowhere to put one. Mitigation: the prompt instructs that an
  empty `notes` array is the correct and common result (copying
  `observer.ts:48`: *"Do not invent observations. An empty list is the common,
  correct result for routine conversations."*), and the husk links back to the
  transcript so a note is checkable. Recorded as a gap rather than claimed
  solved; if run reports show confabulated notes, adding a quote field to
  `notes` is the fix.
- **Validation error UX** — **ADDRESSED.** The only new validation surface is
  `DigestOutputSchema` against the SDK's structured output, which
  `invokeStructured` already reports as a typed failure
  (`src/core/agent/json.ts` `validateStructuredResult`); a failure counts as an
  attempt and is reported in the run summary. Husk cards continue to validate
  through the normal card path — `title`/`contains` being global optional
  strings means a written digest cannot make a husk invalid.
- **Partial migration / transition state** — **ADDRESSED.** There is no data
  migration. Existing husks fall into two states: no title (most, because
  `ensureChatHusk` runs before a transcript exists) and a snippet title written
  at creation. Both have `titleHash: null` in fresh digest state, so both are
  treated as ours to replace. Boxes that never enable the schedule keep exactly
  today's behaviour.

---

## NOT in scope

- **The issue's fan-out to other sinks.** The original issue lists hunches →
  hunch file, action items → questions queue, facts → person/topic cards, and
  names four sibling issues as consumers ([session hot-context](../../../issues/features/2026-05-19-session-hot-context.md),
  [hypothesis tracking](../../../issues/exploration/2026-05-19-hypothesis-tracking.md),
  [behavioral profile](../../../issues/exploration/2026-05-19-behavioral-profile.md),
  [memory-writing guidance](../../../issues/exploration/2026-05-19-memory-writing-guidance.md)).
  **None of those sinks exist yet.** Building a fan-out to unbuilt destinations
  would be designing four subsystems by implication. This plan delivers the
  engine and one destination that exists today (the husk); the fan-out is a
  follow-on plan written when there is somewhere to fan out *to*.
- **The issue's "Full" tier** — daily/weekly cross-session rollups. Same reason:
  it needs a destination and an audience decision. Light and Medium tiers, as
  the issue defines them, are what this plan covers.
- **Merging the digest into the retro pass.** They read the same transcripts and
  a combined pass would halve the reads. Deferred because their eligibility
  models are genuinely different (retro: once ever, any chat; digest: repeatable,
  size-gated), and forcing them together now would compromise the watermark
  design to fit retro's terminal state. Revisit once the digest has run in the
  field. See Open design questions.
- **Titling non-web-chat sessions** (telegram/messaging threads, which have
  `chat-thread` cards, not husks). Different card, different lifecycle; adding
  it now doubles the write surface for no stated need.
- **Backfilling titles for the existing history.** A first run naturally picks up
  every eligible session, which *is* the backfill — but it does it under the
  same gate, so short old sessions stay snippet-labelled. That is the intended
  outcome, not a shortfall.
- **A UI for browsing or editing digests.** The husk card renders today
  (`src/frontend/src/components/chat-husk/ChatHuskView.tsx`) and the body notes
  will render as markdown within it. A dedicated surface is not required for the
  feature to be useful.
- **Deleting or trimming transcripts.** "Compaction" in the space-reclaiming
  sense is not what this is; `~/.claude` is untouched.

---

## Open design questions

- **Should the digest re-read the whole transcript, or only the new span?**
  This plan re-reads from the top each pass (capped by
  `renderSessionCompact`'s 40k elision), which is the simpler and more accurate
  choice for a *title* — a title is about the whole conversation, and a title
  written from the tail alone would drift. The cost is re-reading up to 40k
  chars per pass on an active session. The prior-art "anchored incremental"
  pattern would instead feed the previous digest plus only the new span.
  **Lean:** keep the full re-read; revisit if a box shows sessions being
  digested many times. The switch is contained to `digester.ts` and the prompt.
- **Should retro and digest become one pass?** **Lean:** no, for now — see NOT
  in scope. The concrete thing to watch is whether both passes' discovery
  functions drift apart in what they consider "a chat session"; if they do, the
  shared primitive should move before the passes merge.
- **Is `notes` earning its place in v1?** The title and `contains` are the
  user-visible win; the notes are the durable residue the issue actually asked
  for, but with no downstream consumer they are read only by whoever opens the
  husk. **Lean:** keep them — they are nearly free once the pass exists, and
  they are the evidence for whether the fan-out follow-on is worth writing.
- **`cb digest` vs a subcommand of something existing.** `cb retro` is the
  closest sibling. **Lean:** its own command family, matching how `retro` got
  one; revisit if the two passes merge.

---

## Knowledge audits

This plan introduces one agent-facing concept and touches a second:

1. **New:** the husk `title` is now machine-maintained and hand-edits are
   respected. An agent that "helpfully" rewrites husk titles in bulk would fight
   the digest, and an agent that believes titles are purely manual would not
   know a nightly pass exists.
2. **Existing, now load-bearing:** `src/schemas/chat.ts:31` already instructs
   *"set `title` and `contains` once the conversation has a topic"*. That
   instruction needs a clause saying the digest also maintains them and that a
   hand-set title wins — otherwise the schema instruction and the new behaviour
   contradict each other in the agent's context.

Proposed entries in `src/dev/knowledge-audits.yaml` (format per the existing
236 entries — `id`, `prompt`, `expected_level`, `watch_for`, `correct_contains`,
`tags`):

```yaml
  - id: chat-husk-title-ownership
    prompt: "Who sets the title on a chat husk card, and what happens if I edit one by hand?"
    expected_level: knows_directly
    watch_for: "Says the nightly digest maintains it AND that a hand-edited title is left alone"
    correct_contains: ["digest", "hand"]
    tags: [chat, cards, digest]

  - id: digest-vs-compaction
    prompt: "What does 'compaction' refer to in this codebase?"
    expected_level: knows_directly
    watch_for: "Names the SDK context-window meaning, and does NOT confuse it with the session digest"
    correct_contains: ["context"]
    tags: [vocabulary, digest]
```

Both land **run**, not just written: `pnpm knowledge-audit run --box <absolute
path to a test box> --filter digest`, with the status comment recorded in
`knowledge-audits.yaml` before the plan completes. (Note: `--box` takes a
*path*; a bare name resolves inside the monorepo.)

---

## Implementation order

1. **Track A** — `src/core/digest/state.ts`, `eligibility.ts`, `cb digest
   status`. No LLM. Independently verifiable; unblocks everything.
2. **Track B** — `digester.ts` (interface + fake + SDK impl + prompt),
   `husk-write.ts`, `run.ts`, `cb digest run`. Depends on A.
3. **Prompt iteration** — run `cb digest run --dry-run` and then a real run
   against the test box's transcripts, read the titles, revise the prompt.
   This is where the sensitivity requirement is actually met or missed; budget
   real time for it rather than treating it as a code chunk. Depends on B.
4. **Track C** — unify session-list labelling. Independent of A/B in code, but
   sequenced after B so the doctest can assert against a title the digest could
   plausibly have written. Without this, nothing is visible in the UI.
5. **Track D** — the `DEFAULT_SCHEDULES` entry + `docs/scheduler.md` mention.
   Last, because it turns on work the earlier chunks made correct.
6. **Docs + audits** — a `docs/session-digests.md` reference doc (the
   "how it works now" half), the `src/schemas/chat.ts` instructions clause from
   the Knowledge audits section, and the two audits **run**.

---

## Rollout shape

**Tests, named up front as design tools** (per `docs/testing.md`; tiers per
CLAUDE.md):

- `test/core/digest/eligibility.doctest.md` — **pure**. The gate: below
  threshold, above threshold, below minimum turns, watermark satisfied,
  watermark reset on a shrinking `entryCount`. This test is what forces
  eligibility to be a pure function of (metadata, rendered length, state)
  rather than something that reads the disk itself.
- `test/core/digest/state.doctest.md` — **pure**. Missing file, corrupt JSON,
  schema mismatch; each starts fresh with a warning.
- `test/core/digest/run.doctest.md` — **filesystem** (`makeTmpBox()`), scripted
  fake digester. Happy path; hand-edited title left alone; leak-scan rejection
  keeps the old title but still writes `contains`; pre-existing husk body prose
  preserved outside `## Digest`; transcript vanishing mid-run.
- `test/webapp/chat-sessions-label.doctest.md` — **route**
  (`makeTestServer()`). A husk title wins over the first-message snippet in
  `chat.sessions` — the assertion that Track C actually landed.

**Done-when**, as checkable assertions rather than prose: `cb digest status`
reports 0 ready on a box with only single-turn transcripts; a session that grows
past 6,000 new rendered chars reports ready and, after `cb digest run`, has a
non-empty husk `title` and `contains` and a `## Digest` body section; running
`cb digest run` a second time immediately reports 0 sessions; editing the title
by hand and re-running leaves it unchanged; the chat history dropdown shows the
generated title.

**Knowledge audits** — both entries above land with the plan, run, with status
comments recorded. Neither is deferred.

**Migration** — none. No card shape changes (`title`/`contains` are global
optional fields), no on-disk data moves, no existing state file is rewritten.
The digest state file is created on first run. A box that never enables the
schedule sees no behaviour change; a box that enables it sees titles improve on
the ~5% of sessions long enough to qualify, and can turn it back off with the
schedule card's `enabled` toggle without leaving anything half-migrated.

**Template rollout** — the new schedule card is net-new, so it installs cleanly
on every box via `installTemplateFile`'s fresh-install branch and needs no
tracker seeding (see Track D). It ships `enabled: false`; turning it on is a
per-box decision.
