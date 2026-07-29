# Chat review: size-gated overnight compaction and generated titles

**Status:** active — designed 2026-07-28, revised after cross-model review; nothing implemented

A nightly pass that reads chat sessions which have accumulated enough *new*
material since it last read them, and writes back to the session's husk card:
a **title** (an information-dense one-liner replacing the current
first-message-snippet label), a one-sentence **`contains`**, and a **running
account** of what the conversation amounted to — decisions, open threads,
follow-ups.

The pass is **incremental**: it keeps a journal of which transcript spans it has
already applied, reads only the span past the last one, and *extends* the account
it wrote last time rather than regenerating it from a re-read. This is a
correctness requirement, not an optimization — see "Why incremental" below.

The account needs somewhere to live that isn't `contains` (which is capped at one
sentence and embedded for search), so the plan also adds one new **global card
field, `contains-evidence`** — optional on every card type, holding the detail a
card's `contains` was derived from. Generic by design; chat review is its first
consumer.

Filed as [overnight session compaction](../../../issues/features/2026-05-19-overnight-session-compaction.md);
this plan resolves that issue's `needs: [design]`.

**Revision note (2026-07-28).** A first draft of this plan was reviewed by
OpenAI's Codex against the real source. It falsified several load-bearing claims —
the size gate could not work as specified, the cursor could not guarantee
exactly-once, the crash-ordering was replayable rather than idempotent, the
concurrency story was wrong, and a cited function did not exist. Each is corrected
below and flagged **[rev]** at the point of change, so a reader can see what moved
and why rather than trusting a silently-patched document.

---

## Stated preferences this plan trades against

- **`docs/engineering-principles.md`** — findings trace to:
  - **#4 Resilient AND never silent — and never resilient to the impossible.**
    The review is a best-effort enrichment pass; every degradation (unreadable
    transcript, model failure, leak-scan rejection) must leave the session
    usable and say so, not fail the run and not fail silently.
  - **#8 One way to do each thing.** There are currently *two* session-list
    codepaths with different labelling behaviour (Track D). Adding a title
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
  parameters, no `any`, explicit return types on exports, `Result` vs throw, and
  specifically its locking rule: *"All cross-process locks go through
  `src/lib/file-lock.ts`"* while `withCardLock` is *"the in-process
  counterpart"*. The first draft got this wrong; see Track C.
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
elided"*, implemented by `elideMiddle` (line 42) and applied unconditionally at
line 64.

Measured across 775 box transcripts, in *pre-elision* rendered characters
(`scratch/chat-review-sizes.py` reproduces this):

| p50 | p75 | p90 | p94 | p95 | p97 | p99 | max |
|---|---|---|---|---|---|---|---|
| 665 | 1,087 | 1,987 | 5,177 | 21,933 | 82,827 | 233,084 | 642,205 |

**Of the 45 sessions that clear the gate, 33 are already over the 40k elision
cap — 73%.** So for most sessions that qualify for review at all, a from-scratch
re-read *cannot see the middle of the conversation*.

That makes regeneration lossy in a way that gets worse over a session's life, and
it is why the account extends rather than being rewritten: the material that
scrolled out of the render is already captured in the previous pass's account.
The span journal is what makes extension sound — it identifies exactly which
entries have been folded in, so extending can neither double-count nor skip.

This is the **anchored incremental summarization** pattern (see Prior art):
maintain a persistent structured document, extend it per new span.

**[rev] Pre-elision is the only usable unit.** The first draft stated this
distribution as `renderSessionCompact` *output* characters and defined the gate as
"total rendered length minus the length at the cursor". Both were wrong, and
together they disabled the feature on exactly the sessions it exists for:
`renderSessionCompact`'s output is clamped — the measured post-elision maximum
across the whole corpus is **40,049 chars** — so once a session passes 40k its
"total rendered length" stops growing and it would never accumulate another 6k,
forever. The gate therefore measures **the length of the new span**, rendered
without elision, and the renderer is refactored to expose that (Track A).

**Bootstrap.** The *first* review of an already-long session reads the whole
transcript in one span, elided if huge, because there is no prior account to
anchor to. This is deliberate and load-bearing: replaying an existing 642k-char
session as 107 sequential 6k spans would be absurd, so the first pass takes it
whole and the journal jumps to the end. The cost is that the bootstrap pass on a
long session is lossy in the middle — a one-time cost per session, on history that
predates the feature, and not worth engineering around. Every subsequent span is
a nightly increment, far below the cap.

---

## What already exists

**Reused as-is:**

- `src/core/chat/husk.ts:128` `listChatHusks(boxRoot)` — enumerates every husk
  with its `session`, `contextDir` and `title` (`ChatHuskEntry`, line 113).
  **[rev] This is now the discovery corpus** (Track A), replacing a scan of every
  transcript under `~/.claude/projects/`.
- `src/webapp/trpc/routers/chat.ts:149-152` — the husk→transcript resolution
  already written: `contextDir` picks the cwd, `getSessionLogPath(cwd, session)`
  gives the log. **Reuse** verbatim; extract it so both callers share it.
- `src/cli/lib/session-entry.ts:17` — every parsed entry carries a `uuid`.
  **Reuse** as the span journal's boundary identity (Track A).
- `src/lib/file-lock.ts` `acquireLock` / `releaseLock` (lines 275, 317) — the
  sanctioned cross-process lock. **Reuse** around the whole run (Track C).
- `src/core/agent/index.ts` `createAgent(...).invokeStructured(schema, opts)` —
  the "one cheap scoped LLM call with a Zod-validated result" helper. The retro
  observer's use is the template: `src/core/retro/observer.ts:69-76` passes
  `model: "haiku"`, `maxTurns: 4`, `maxBudgetUsd: MAX_BUDGET_USD`. **Reuse.**
- `src/publish/leak-scan.ts` — a **pure** function over a text file map returning
  `LeakFinding[]` for home-dir paths, non-allowlisted emails, credential shapes
  and absolute URLs. **Reuse** as the mechanical backstop on generated text.
- **`title` and `contains` are already global optional fields** —
  `src/cards/schema.ts` `GLOBAL_CARD_FIELDS` declares *"`title` — human-readable
  display title"* and *"`contains` — one sentence stating what can be found
  inside this card; the prime retrieval field for search and listings"*, each
  `z.string().optional()`. So `src/schemas/chat.ts:16-22` not listing them is
  correct, not a gap. **Reuse.**
- `src/schemas/scheduled-script.tsx:48` `ScheduledScriptSchema` + `cb tick`. Shipped
  schedules are defined in code — `DEFAULT_SCHEDULES` in `src/core/box/defaults.ts`
  (the retro entry ends at line 272), installed per box by `installSchedules`
  (line 282) through `installTemplateFile`. **Reuse**; add one entry.
- `src/cli/commands/chat.ts:275-282` — `cb chat` is already a command family.
  **Reuse** as the parent: `cb chat review`, not a new top-level command.

**Modified:**

- **`src/core/retro/render.ts` — split rendering from elision. [rev]** Today
  `renderSessionCompact(logPath)` parses, renders, and elides in one shot
  (line 57-65), so there is no way to ask "how long is this span really?". The
  refactor: `renderEntries(entries): string` (pure, uncapped) and
  `elideMiddle(text, max)` stay separate, with `renderSessionCompact` composed
  from them so retro's behaviour is byte-identical. Chat review gates on
  `renderEntries(span).length` and elides only what it hands the model. The module
  also moves out of `retro/` to a shared home, since two subsystems use it.
- **`parseSessionLog` must be called with an explicit `limit`. [rev]**
  `src/cli/lib/session.ts:322` defaults `limit` to **10,000 entries**, and
  line 339 slices `filtered.slice(offset, offset + limit)` *after* building the
  whole array. A long session silently truncates at 10k entries, and advancing the
  journal past that boundary would skip everything beyond. Every chat-review call
  passes an explicit limit and asserts `entries.length === total` via
  `invariant()`.

**Deliberately NOT reused (rebuilt, with reasons):**

- `src/core/retro/state.ts` — retro's walker state is a **terminal** predicate:
  `isSessionSettled` (line 43) returns true for `status: "done"`, and *"A session
  marked `done` is never re-observed"* (lines 5-6). Chat review must re-read a
  session every time it grows. New state file with a span-journal shape. The
  *loading discipline* — missing file starts fresh, corrupt file warns and starts
  fresh (`loadRetroState`, lines 56-82) — is copied.
- `src/core/retro/discovery.ts` — retro qualifies sessions by "is this a chat, is
  it quiet, is it unsettled" (lines 99-117), including a `<typed>`/`<speech>`-tag
  heuristic to tell chats from job runs. **[rev] Chat review needs none of that:**
  husk existence already answers "is this a web chat", so discovery enumerates
  husks and tests only quiescence and growth.

**`contains` is not a plain string field — the surrounding machinery constrains
this design.** Found while checking whether an accumulating `contains` was viable:

- `src/core/card-lint.ts:227-228` — *"Soft budget for the `contains` field — one
  concise sentence, not a summary essay"*, `CONTAINS_MAX_CHARS = 200`. Note it is
  a **`severity: "warning"`** (line 233), not a blocking error — so it documents
  intent but enforces nothing. An accumulating `contains` would warn on every card
  it touched.
- `src/core/search/query.ts:21-22` — `contains` is embedded and searched with
  `BOOST = { contains: 3, title: 2 }`, and the hybrid cutoff `SIMILARITY = 0.35`
  was *empirically validated* against real embeddings (lines 24-35: *"query↔target
  `contains` cosines ran 0.467-0.682, off-target median 0.161 / max 0.470"*).
  Changing what gets embedded perturbs a tuned, measured surface.
- `src/core/search/contains-state.ts:40` —
  `BASIS_EXCLUDED_FIELDS = new Set(["contains", "title", "type", "status"])`, the
  fields that *"never count toward the contains basis"* because they are the
  derived ones. **[rev] The mechanism is narrower than the first draft claimed** —
  see Track B.
- `src/connectors/preserve-agent-fields.ts:15` — `AGENT_FIELDS = ["contains"]`,
  re-injected before a connector sync rebuilds a card. `src/connectors/CLAUDE.md:19`:
  *"Adding a new agent-owned field to a connector-managed card type means adding it
  to that list, not just writing it once and hoping the next sync leaves it alone."*
- **`src/core/search/contains-update.ts:87` `updateContainsField` — [rev] the
  first draft cited a `setContains` that does not exist.** The real export is
  CLI-shaped (searchable-kind checks, `--text` errors, lines 33/87) and, decisively,
  writes the card **only when `contains` itself changed** (line 119:
  `const unchanged = fields["contains"] === text;`). An evidence-only update with
  an unchanged `contains` would be silently dropped. This is not an optional
  parameter away; Track B specifies the primitive that is actually needed.

**The bug this plan also closes.** Two session-list codepaths label differently:

- `src/webapp/trpc/routers/chat.ts:162` — husk-based, title-aware:
  `let label = husk.title ?? husk.session.slice(0, 8);`, snippet used only
  *"if (husk.title === undefined)"* (line 163).
- `src/webapp/trpc/routers/chat-session-procedures.ts:74-80` — history-JSON based,
  **title-blind**: `let label = sessionId.slice(0, 8);` … `if
  (meta.firstUserSnippet) label = meta.firstUserSnippet;`. It never reads a husk.

`src/frontend/src/api-chat.ts:158` (`trpcClient.chat.sessions.query()`) is the
title-blind one, and it is what `SessionListButton.tsx` renders. Generated titles
are invisible in the chat history dropdown until Track D lands.

---

## Prior art (external)

- **"Anchored incremental summarization" is the pattern this plan uses** —
  maintain a persistent structured document and extend it per new span rather than
  regenerating from scratch.
  [Memory Consolidation and Summarization Techniques](https://apxml.com/courses/agentic-llm-memory-architectures/chapter-3-designing-memory-systems/memory-consolidation-summarization),
  [Memory in the Age of AI Agents](https://arxiv.org/pdf/2512.13564).
  The cost argument is secondary here; the elision argument above is the binding one.
- **Production evidence that incremental beats bulk** — Airbnb's deployed
  incremental case-summarization reported ~3% lower handling time vs bulk
  summarization, up to ~9% on complex cases.
  [Incremental Summarization for Customer Support via Progressive Note-Taking and Agent Feedback](https://arxiv.org/pdf/2510.06677).
  Weak support: the metric is human handling time, not summary quality, and the
  spans are support cases, not open-ended chat.
- **Auto-titling from the first prompt, with a manual override, is the
  industry-standard pattern** —
  [AI Chat UI Best Practices for 2026](https://thefrontkit.com/blogs/ai-chat-ui-best-practices).
  That is what this box already does; the prior art confirms the baseline.
- **No prior art found for sensitivity-aware title generation.** Searches returned
  only prompt-sanitization and PII-redaction work —
  [Sanitizing Sensitive Prompts for LLMs](https://arxiv.org/html/2504.05147v2),
  [When Prompts Leak Secrets](https://www.keysight.com/blogs/en/tech/nwvs/2025/08/04/pii-disclosure-in-user-request) —
  a different problem (scrubbing tokens *before* the model sees them, not asking
  the model to write a *discreet* label about content it has fully read). This
  empty search is itself a finding: the reviewer prompt (Track C) is the artifact
  carrying the whole requirement, with no external design to copy.
- **The project's own precedent says the regex backstop cannot carry this.**
  `src/publish/leak-scan.ts` states it in its header: the scan *"does NOT
  meaningfully cover"* PII or secrets *"in prose form"*, and *"the human
  file-by-file preview is the only real gate"*.

---

## Tracks / scope

### Track A — Discovery and the span journal (`src/core/chat/review/`)

**What.** A discovery function returning the sessions worth reading tonight, plus
the per-session journal that makes "worth reading" mean "grew since the last
applied span".

**Why this needs to change.** Nothing today expresses "how much new material has
this session accumulated"; retro's walker answers a once-ever question.

**Vocabulary lock-ins.**

- The subsystem is **chat review** — `cb chat review`, `src/core/chat/review/`,
  `.callback-box/chat-review/`.
- It is **never called "compaction"**. That word is taken for the SDK's
  context-window compaction: `src/cli/lib/session-text.ts:22-27`
  `isCompactionSummary()` detects *"This session is being continued from a previous
  conversation that ran out of context."* Two meanings for one word, in a codebase
  whose maintainer is usually an agent (principle #12), is a cost paid on every
  future read.
- The **`chat` qualifier is load-bearing and not dropped**. Bare "review" in this
  repo means code review — `/code-review`, `cb-plan`'s review mode, the
  `docs/plans/<topic>.review.md` convention. Do not shorten to `cb review`.

**Direction.**

**Discovery is husk-first. [rev]** The first draft scanned all ~775 transcripts and
heuristically excluded non-chat runs. But this feature only ever *writes* husks,
and skips sessions whose husk is missing — so the husk list is already exactly the
in-scope corpus, and `listChatHusks` (`src/core/chat/husk.ts:128`) returns it. The
pass is: enumerate husks → resolve each transcript via the `contextDir` logic at
`chat.ts:149-152` → skip missing → test quiescence (reuse `QUIESCENCE_MS`,
`src/core/retro/discovery.ts:23`) → test growth. This deletes the `<typed>`/
`<speech>` chat-detection heuristic entirely, and with it the risk that
`getSessionMetadata.userTurns` — which counts *any* non-plumbing user text
(`session.ts:161-177`), not specifically web-UI turns — is mistaken for a
web-chat signal.

**The gate measures the new span, pre-elision.**

```ts
/** Pre-elision rendered chars of new material required to trigger a review. */
export const REVIEW_CHAR_THRESHOLD = 6_000;
/** Real user turns in the whole session before it is reviewed at all. */
export const REVIEW_MIN_USER_TURNS = 2;
```

Cumulative counts, pre-elision: `≥2,000` → 76 sessions (9.8%), `≥4,000` → 55
(7.1%), `≥6,000` → 45 (5.8%), `≥8,000` → 40 (5.2%), `≥12,000` → 39 (5.0%),
`≥20,000` → 39 (5.0%). The plateau at exactly 39 from 12k to 20k is a hard cluster
of genuinely long conversations. 6,000 sits in the flat region: moving it to 4,000
adds ~10 sessions, to 8,000 removes ~5, out of 775. **The threshold is deliberately
not a tuned number** — its job is to keep a nightly LLM call off trivial growth,
and any value in 4k–8k does that identically.

**The span journal. [rev]** The first draft stored an entry *index* and treated a
shrinking count as the only rewrite signal. That cannot hold: `parseSessionLog`
builds the whole filtered array and only then applies the offset numerically
(`session.ts:329-339`),
so any rewrite that replaces or reorders earlier entries while keeping the total
at or above the stored index silently shifts the boundary — re-reading material
already folded in, or skipping material never seen. Entries carry a `uuid`
(`session-entry.ts:17`); identity, not position, is the cursor.

```ts
const AppliedSpanSchema = z.object({
  /** sha256(sessionId + endUuid + prefixHash) — the idempotency key. */
  spanId: z.string(),
  /** uuid of the last entry folded into the account. */
  endUuid: z.string(),
  /** Index of that entry at write time — advisory only; endUuid is authoritative. */
  endIndex: z.number().int(),
  /** sha256 of every entry uuid up to and including endUuid — detects rewrites. */
  prefixHash: z.string(),
  at: z.string(),
});

const ReviewSessionStateSchema = z.object({
  /** Keyed by consumer; "metadata" is the only one this plan ships. */
  applied: z.record(z.string(), AppliedSpanSchema),
  /** Who owns the husk title. See Track C. */
  titleOwner: z.enum(["unmanaged", "generated", "manual"]),
  /** sha256 of the title we last wrote (null when we have never written one). */
  titleHash: z.string().nullable(),
  attempts: z.number().int(),
});
```

Resolving the next span, given a fresh parse:

1. No journal entry → **bootstrap**: the span is the whole transcript.
2. `endUuid` found at index *i* **and** the recomputed prefix hash over
   `entries[0..i]` matches → the span is `entries[i+1..]`. This is the normal path.
3. `endUuid` missing, **or** found with a mismatched prefix hash → the transcript
   was rewritten (SDK auto-compaction rewriting history, a `--resume` fork,
   `~/.claude` cleared and partly restored). Warn, discard the journal entry, and
   treat as bootstrap. **The account is kept** — it is now the only record of the
   material the rewrite destroyed.

**Idempotence, not just replay-safety. [rev]** The first draft ordered the husk
write before the journal write and called a crash between them "idempotent". It is
not: on retry the model receives the *already-extended* account plus the same span
again, and can duplicate or distort those notes. Retro avoids this by hashing
evidence and deduping (`src/core/retro/scan.ts:80-86`); chat review needs an
equivalent. The fix is to make the applied span visible **on the husk**: a
chat-schema field `review-span` holding the `spanId` last folded in. The pass then
short-circuits — if the computed `spanId` equals the husk's `review-span`, that
span is already in the account and the run only needs to re-advance the journal.
Husk write and `review-span` are one atomic card write, so the crash window can
only lose the journal, which the short-circuit then repairs.

**Cost.** With bootstrap-in-one-pass, a first run over the current corpus is ~45
model calls, and steady state is one call per session per night it grows past 6k.
(Replaying history span-by-span would instead be ~936 calls, median 14 and max 107
per session — the number that makes bootstrap load-bearing rather than a
concession.)

**Performance, accepted. [rev]** `parseSessionLog` re-reads and re-parses the whole
JSONL every night (`session.ts:329-338` builds the full array before any slicing),
so work over a session's life is quadratic. Accepted rather than engineered around: the largest transcript in the
corpus renders to 642k chars, parsing it is well under a second, and the pass runs
once a night on ~5% of sessions. Recorded so the next reader knows it was seen, not
missed. If a session ever makes this hurt, the fix is a resumable parse keyed on
byte offset, not a redesign of the journal.

Loading discipline copied in spirit from `src/core/retro/state.ts:56-82`: missing
file → fresh; unparseable JSON → warn and fresh; schema mismatch → warn and fresh.
Losing the journal costs one re-review per session, which the `review-span`
short-circuit makes free.

**First implementation chunk.** `src/core/chat/review/state.ts` +
`discovery.ts` + `span.ts` (span resolution and hashing) + the `render.ts`
split + `cb chat review status` (mirroring `src/cli/commands/retro.ts:53-66`,
including `--check`). No LLM call; the gate and the journal are independently
verifiable.

---

### Track B — A new global card field: `contains-evidence`

**What.** Add `contains-evidence` to `GLOBAL_CARD_FIELDS` — optional on every card
type, holding the accumulated detail its one-sentence `contains` was derived from.

**Why this needs to change.** The account needs a home, and `contains` cannot be
it: `CONTAINS_MAX_CHARS = 200` (`src/core/card-lint.ts:228`) documents it as one
sentence, and it is the embedded retrieval field whose scoring
(`src/core/search/query.ts:24-35`) was fitted against one-sentence text.

**Scope objection, recorded.** Cross-model review argued this is premature global
infrastructure — semantics added to every card type, plus search, connectors, docs
and agent knowledge, for a single consumer, when a chat-specific field or a sidecar
would do. That is a fair general prior. It is overridden here as a **deliberate
boxholder decision**: the field is wanted as a generic card affordance ("`contains`
can show its work") rather than as chat-review plumbing. Recorded so the trade is
visible rather than assumed.

**Vocabulary lock-in.** The key is **`contains-evidence`** — kebab-case, matching
every multi-word frontmatter key in the codebase (`context-dir`, `not-before`,
`lock-group`, `create-after-success`, `answered-at`, …; a scan of `src/schemas/`
found no camelCase or snake_case key). Type `z.string().optional()`.

**Direction — five wirings, not four. [rev]**

1. `src/cards/schema.ts` `GLOBAL_CARD_FIELDS` — the declaration, doc-commented as
   *derived detail backing `contains`*, not a second summary.
2. **`src/cards/schema.ts:260-265` `InferCardFields`** — the type-level contract
   hardcodes `Omit<{ title?: string; contains?: string }, keyof TFields>`. A third
   global field that is not added here exists at runtime but not in the inferred
   type, so every typed reader of a card's fields silently fails to see it. The
   first draft missed this entirely.
3. `src/core/search/contains-state.ts:40` `BASIS_EXCLUDED_FIELDS` — add
   `"contains-evidence"`, as correct general policy for a derived field.
4. `src/connectors/preserve-agent-fields.ts:15` `AGENT_FIELDS` — add it, per the
   rule quoted from `src/connectors/CLAUDE.md:19`. Husks are not connector-managed,
   so this does not matter today; it is the field's general contract.
5. A write primitive that can persist evidence — see below.

**[rev] The staleness-loop rationale was overstated.** The first draft called
omitting wiring #3 a silent self-sustaining bug, on the reasoning that extending
evidence would move the contains basis and flag `contains` stale forever. Tracing
it: `computeContainsBasis` (`src/core/search/contains-state.ts:91-103`) hashes the
**body** whenever the schema has one and the value is a string, and only falls
through to `canonicalFields` (the function that applies `BASIS_EXCLUDED_FIELDS`,
lines 113-117) for frontmatter-only cards. Chat husks *have* a body
(`src/schemas/chat.ts:21`), so on this feature's own cards the basis never sees
frontmatter at all and the loop cannot occur. For frontmatter-only card types the
exclusion does matter, but even there `updateContainsField` recomputes and rebases
after writing (`contains-update.ts:125-131`), so it would self-correct rather than
sustain. **The exclusion is still right** — a derived field has no business in the
basis that decides whether derived fields are stale — but it is policy hygiene, not
a bug fix, and the plan should not have claimed otherwise.

**The write primitive. [rev]** `updateContainsField` cannot carry this: it is
CLI-shaped (searchable-kind validation, `--text` error types, lines 33/87) and
returns early without writing when `contains` is unchanged (line 119). An
evidence-only extension — the common case, since `contains` often stays accurate
while the account grows — would be silently dropped. What is needed is a small,
honestly-named primitive that both callers can share:

```ts
/** Write derived contains fields atomically and rebase the staleness sidecar. */
export async function setDerivedContains(
  boxRoot: string,
  opts: { relPath: string; contains?: string; evidence?: string },
): Promise<{ changed: boolean }>;
```

It writes when *either* field differs, then rebases exactly as
`updateContainsField` does today (lines 125-131). `updateContainsField` becomes a
thin CLI-facing wrapper over it, so there stays one write path (principle #8)
rather than two that can disagree about the sidecar.

**Not searched, not embedded.** `contains-evidence` is deliberately not added to
`TEXT_PROPERTIES` or `BOOST` (`src/core/search/query.ts:22,43`). The vector half's
cutoff was validated against one-sentence text; admitting a long accumulating field
would change both the embedding corpus and the score distribution `SIMILARITY = 0.35`
was fitted to. Open question rather than closed, since it is a plausible want.

**No lint budget.** `lintContainsLength` stays scoped to `contains`. An evidence
field is *expected* to be long.

**No hand-edit protection**, per the boxholder: `contains` and its evidence are
machine-maintained and not expected to be hand-edited, unlike `title`. Stated as an
assumption the design rests on.

**First implementation chunk.** The declaration plus the five wirings; a lint
doctest asserting the 200-char budget still applies to `contains` and not to
`contains-evidence`; a type-level test that `InferCardFields` surfaces the new
field; and a search doctest asserting that writing evidence alone leaves the card's
`contains` un-stale **and actually persists** (the regression anchor for the
dropped-write bug).

---

### Track C — The reviewer: title, `contains`, and the running account

**What.** One tool-less structured LLM call per qualifying session, receiving the
previous account and *only the new span*, returning an updated title, `contains`,
and account; written to the session's husk.

**Why this needs to change.** The current label is the first user message, copied
once at husk creation and never revised — `src/core/chat/husk.ts:81` calls
`readSnippetTitle` inside `ensureChatHusk`, which runs at session-id assignment,
*before there is a transcript*. Its own comment concedes it: *"No transcript yet
(brand-new session) or unreadable — the husk starts untitled"* (lines 63-65). So
most husks have no title and every list falls back to the first-message snippet —
worst exactly where it matters, on long sessions that drifted from their opening
line.

**Direction.**

| Output | Home | Extends? |
|---|---|---|
| `title` | husk `title` (global field) | Replaced when stale, else kept |
| `contains` | husk `contains` (global field) | Regenerated from the evidence each pass |
| the account | husk `contains-evidence` (Track B) | **Extends** — the previous account is input |
| applied span | husk `review-span` (chat schema) | Replaced — the idempotency marker |

Putting the account in a field rather than a `## Review` body section means no body
splicing, no section-boundary parsing, and no risk of clobbering prose the
boxholder wrote. The husk body stays entirely theirs, as
`src/schemas/chat.ts:31` promises: *"use the body for durable notes about the
conversation"*.

**Output schema, with real constraints. [rev]** The first draft used unrestricted
strings and an unbounded array, then asserted elsewhere that caps were "enforced".
Nothing enforced them — and `CONTAINS_MAX_CHARS` is a lint *warning*
(`card-lint.ts:233`), not a gate. Constraints go in the schema, where
`invokeStructured` makes the model retry on violation:

```ts
const TITLE_MAX = 80;
const NOTES_MAX = 40;

const ReviewOutputSchema = z.object({
  /** One line. Empty string = keep the existing title. */
  title: z.string().max(TITLE_MAX).refine((t) => !t.includes("\n"), "title must be one line"),
  /** One sentence, within the lint budget. */
  contains: z.string().min(1).max(200),
  /** The FULL updated account — prior notes, revised, plus what the new span adds. */
  notes: z.array(z.object({
    kind: z.enum(["decision", "open-thread", "follow-up", "learned"]),
    text: z.string().min(1).max(280),
  })).max(NOTES_MAX),
});
```

Schema rejection surfaces as a typed failure from `invokeStructured`, which
counts as an attempt and is reported. **[rev2]** An earlier draft claimed a
retry-then-deterministic-truncation path; neither exists —
`agent/index.ts:138` validates and returns, it does not retry, and no truncation
was written. The honest behaviour is: violating output fails the session for that
night and is retried on the next, against the same span. The 4-9 word guideline
stays prose in the prompt, since enforcing it mechanically would produce worse
titles than accepting a ten-word one.

`notes` is returned whole rather than as a delta because a new span can *change* an
earlier item — an open thread gets resolved, a decision reversed. A delta could
only append, leaving the account accumulating contradictions. The model is
instructed to carry forward, revise, or drop, and to merge the least durable items
when it would exceed `NOTES_MAX`.

**Sensitivity is the prompt's job, and the prompt is the deliverable.** The
asymmetry that makes this load-bearing:

> The transcript lives at `~/.claude/projects/…` — outside the box, outside git,
> never pushed. The title lands on a `synced`-category card under `store/chat/web/`
> (`src/core/chat/husk.ts:21`), git-tracked and pushed to the box's git remote by
> the wakeup cycle. **The review moves content across a durability and exposure
> boundary the transcript never crossed** — and a title, once committed, is in git
> history whether or not it is later edited.

Prompt rules (the artifact to iterate; first draft):

- Name the *subject and shape* of the conversation, not its contents. "Sorting out
  a recurring billing problem" over the vendor, amount, or account.
- Write it as if read by someone standing behind the boxholder's shoulder who is
  not entitled to the details.
- For health, money, relationships, legal matters, employment, or anything the
  boxholder framed as private: name the *category* at most — never the particulars,
  never the other people involved.
- No names of people other than the boxholder. No amounts, no diagnoses, no
  addresses, no account or order identifiers.
- Distinctive enough to tell apart from the boxholder's other chats — a title is a
  way back to a conversation, so "A personal matter" fails the job even though it
  is discreet. Where discretion and distinctiveness conflict, discretion wins and
  the title says so plainly.
- Sentence case, no trailing period, roughly 4-9 words.

**All three generated fields are held to this standard, and all three are
leak-scanned. [rev]** The first draft scanned only `title` and `contains`, leaving
`contains-evidence` — the longest, most transcript-derived, equally git-committed
output — unguarded. `title`, `contains` and the rendered account all go through
`src/publish/leak-scan.ts` as a file map; a finding of kind `email`, `credential`
or `home-path` rejects that field, keeps its previous value, and warns naming the
finding kind. This catches mechanical leaks only, and the code comment should say
so, quoting that module's own admission that prose PII is out of reach.

**Title ownership is an enum, not a hash. [rev]** The first draft stored only
`titleHash: string | null` and claimed a mismatch was "recorded as permanently
hands-off" — but there was no value that could mean that: storing the human's hash
makes it ours to replace next pass, and `null` explicitly means "ours to replace".
A pre-first-review hand edit was also indistinguishable from the snippet title.
Ownership is now explicit:

- `unmanaged` — we have never written a title (includes the `ensureChatHusk`
  snippet). Ours to replace.
- `generated` — we wrote the current title, and `titleHash` matches it. Ours to
  replace when it goes stale.
- `manual` — the husk title does not hash to `titleHash`. A human or another agent
  changed it. **Never written again**, for the life of the session.

The transition to `manual` is one-way and checked on every pass. `contains` and
`contains-evidence` carry no such protection, per the boxholder's stated
expectation that they are not hand-edited.

**Re-titling.** The model receives the existing title and may return `""` for
"still accurate, keep it". Churning titles would make the history list unstable to
look at, so the default is stability.

**Cross-process locking. [rev]** The first draft claimed `withCardLock` serializes
two concurrent runs. It does not: `src/lib/card-lock.ts` is explicitly the
in-process counterpart, and `code-style.md` says so — *"a lost-update bug
`file-lock.ts` wouldn't even see, since both racers share a PID"* describes the
opposite direction, but the corollary holds: a manual `cb chat review run` racing
the scheduled one is two processes, and `withCardLock` sees neither. The schedule's
`lockGroup` only coordinates scheduled runs with each other, not with a human at a
terminal. So: **the whole run takes a cross-process lock via
`src/lib/file-lock.ts` `acquireLock`** (line 275), released in a `finally`; a run
that cannot acquire it exits reporting the holder from `inspectLock` (line 342)
rather than proceeding. `withCardLock` still wraps the individual husk
read-modify-write, for the in-process half.

Model and budget follow the retro observer (`src/core/retro/observer.ts:26-30`):
`haiku`, `maxTurns: 4`, a hard `maxBudgetUsd` ceiling.

Behind a `ChatReviewer` interface with a scripted fake, per principle #10 and the
`RetroObserver` precedent (`src/core/retro/observer.ts:21-24`).

**Write ordering.** Husk first (title, `contains`, `contains-evidence` and
`review-span` in one card write), journal second. A crash between them is repaired
by the `review-span` short-circuit on the next run.

**First implementation chunk.** `src/core/chat/review/reviewer.ts` (interface +
fake + SDK impl + prompt), `husk-write.ts` (the card write through `withCardLock`,
calling Track B's `setDerivedContains`), `run.ts` (orchestration + the file lock),
`cb chat review run [--max-sessions] [--dry-run]` mirroring
`src/cli/commands/retro.ts:68-118`.

---

### Track D — One session-list codepath, and making the output visible

**What.** Make `chat.sessions` title-aware, and make the husk view show what the
review wrote.

**Why this needs to change.** Tracks A-C are invisible without the first half — see
"The bug this plan also closes". The second half is a review finding: **the husk
renderer shows none of this today.** `src/frontend/src/components/chat-husk/ChatHuskView.tsx:17-20`
reads only `session`, `context-dir` and `title` from frontmatter, so `contains` and
`contains-evidence` would never appear in the normal card view. That turns the
failure table's "the account is human-readable, so drift is visible on inspection"
into a false claim — hallucinated decisions and leaked identifiers would be
invisible unless someone opened the raw file.

**Direction.** Two independent edits:

1. `chat-session-procedures.ts`'s `sessions` query resolves its label the way
   `chat.ts:162` already does: husk `title`, then transcript snippet, then id
   prefix. The logic becomes one exported helper both call. Whether the two queries
   should merge entirely is left alone — they differ in enumeration source (history
   JSON vs husk cards), a real behavioural difference. This track unifies
   *labelling*, not enumeration.
2. `ChatHuskView` renders `contains` and, collapsed by default, the
   `contains-evidence` account. This is the only surface where the boxholder can
   notice the review going wrong, so it is in scope here rather than deferred.

**First implementation chunk.** Extract `resolveSessionLabel`, call it from both, a
route doctest asserting a husk title beats a first-message snippet in
`chat.sessions`, and the `ChatHuskView` fields.

---

### Track E — The nightly schedule

**What.** Ship a default schedule so boxes can run the review overnight.

**Direction.** One new entry in `DEFAULT_SCHEDULES` (`src/core/box/defaults.ts`),
following the shipped `process-retrospective` entry: an overnight `cron`, a
`notBefore` guard, `lockGroup: "retro"` (both passes walk transcripts; no reason to
run them concurrently), `runs: "cb chat review run"`, and `enabled: false` so it is
opted into per box.

Rollout is clean because the file is net-new: `installTemplateFile` takes the
`localContent === null` branch (`src/core/install-template-file.ts:331-338`),
writes the card, records its hash in the box's `config/template-versions.json`, and
returns `outcome: "fresh"`. The park-on-divergence hazard applies to *changed*
templates, not new ones.

**First implementation chunk.** The `DEFAULT_SCHEDULES` entry plus a line in
`docs/scheduler.md`'s example set.

---

## Subplans

None. The one candidate — the reviewer prompt — has no decisions to settle that
this document doesn't settle; it has *iteration* to do, which is implementation
work against real transcripts. If the first pass shows the prompt cannot hold
discretion and distinctiveness at once, that becomes a subplan then.

---

## Failure modes

> **Critical gap:** none unresolved. The one that would have been — a generated
> title silently leaking private content into git — is reduced (not eliminated) by
> the prompt, the leak-scan backstop on all three generated fields, hand-edit
> protection, and Track D making the output visible in the husk view. It is
> accepted as a documented residual risk below.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Title accurately names a private topic in a way no regex can catch | No — not testable | Prompt rules; boxholder can edit the title; visible in the husk view (Track D) | **Silent** — accepted residual risk, see below |
| Transcript rewritten so an earlier entry changes but the total does not shrink | Yes — Track A doctest with a mutated-prefix fixture | `prefixHash` mismatch → bootstrap, keep the account | Clear (`console.warn`) |
| `endUuid` no longer present (history rewritten wholesale) | Yes — Track A doctest | Bootstrap, keep the account | Clear (`console.warn`) |
| Crash between husk write and journal write | Yes — Track C doctest replaying the same span | `review-span` on the husk short-circuits the re-apply | Clear by construction |
| Transcript exceeds `parseSessionLog`'s 10,000-entry default page | Yes — Track A doctest at the boundary | Explicit `limit`, `invariant(entries.length === total)` | Clear (throws) |
| Two runs concurrently (manual during scheduled) | Yes — Track C doctest on double-acquire | Cross-process `acquireLock`; second run exits naming the holder | Clear (message names the holder) |
| Model returns an over-long title / oversized account | Yes — Track C doctest with a fake returning violations | Zod `.max`/`.refine` → `invokeStructured` retry; then deterministic truncation | Clear |
| Model drops or contradicts earlier account items when extending | Yes — Track C doctest asserting prior items survive an empty new span | Prompt instructs carry-forward-or-revise; prior account is in the prompt | Partially silent — visible in the husk view (Track D) |
| Generated text carries an email/credential/home path | Yes — Track C doctest per field | Leak-scan on all three fields; keep previous value | Clear (warn names the finding kind) |
| Evidence-only update silently not persisted | Yes — Track B doctest | `setDerivedContains` writes when *either* field differs | Clear (would fail the doctest) |
| New global field invisible to typed readers | Yes — Track B type-level test | `InferCardFields` updated | Clear (compile error) |
| Model call fails or exceeds budget | Yes — fake throws | `attempts += 1`; at `MAX_REVIEW_ATTEMPTS` skipped permanently and reported | Clear, mirrors `retro/state.ts:19` |
| Boxholder hand-edits a title; review overwrites it | Yes — Track C doctest asserting hands-off | `titleOwner: "manual"`, one-way | Clear — the *absence* of an action |
| Husk missing or deleted (editorial removal) | Yes | Not in the discovery corpus at all — husks *are* the corpus | Clear by construction |
| A connector sync drops a card's `contains-evidence` | No — no connector-managed card sets it today | `AGENT_FIELDS` re-injects it | Clear (the field would visibly vanish) |

**Accepted residual risk — title discretion.** No mechanism can verify a generated
title is discreet enough; the judgement is about content the model has fully read
and is being asked to describe carefully. Controls: the prompt, leak-scan for
mechanical leaks, the husk view surfacing what was written, the boxholder's ability
to edit, and `titleOwner: "manual"` making that edit stick. No "sensitivity" flag
and no redaction pipeline — nothing would consume the flag, and per
`src/publish/leak-scan.ts`'s own conclusion a regex layer would produce false
confidence rather than safety.

---

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **PARTIALLY ADDRESSED.** `title` and `contains` are
  existing global fields, but `contains-evidence` is new, and a new optional field
  on *every* card type is a new way for an agent to be wrong: the plausible error is
  treating it as a second `contains` or as scratch space. Mitigations: the
  `GLOBAL_CARD_FIELDS` doc comment states it is derived detail backing `contains`,
  and a knowledge audit tests exactly this confusion. The husk *body* stays entirely
  the boxholder's, so there is no agent-vs-machine contention over it.
- **Stale ref** — **ADDRESSED.** A husk's `session` may point at a transcript that
  is gone; discovery skips it, and does **not** delete the husk — the card stays
  browsable and its account is now the only record of the conversation.
- **Two agents touching the same card** — **ADDRESSED.** The chat agent may edit a
  husk while the nightly review writes to it. `withCardLock` for the in-process
  half, `acquireLock` for cross-process, and `titleOwner` turning a concurrent title
  edit into permanent hands-off rather than a lost update.
- **Hand-edit drift** — **ADDRESSED.** Retitling a husk is the *expected* flow, not
  drift; `titleOwner: "manual"` makes it stick, including for an edit made before
  the first review (which the first draft would have silently overwritten).
  Renaming the husk *file* is also expected (`src/schemas/chat.ts:29`: *"renaming
  the file is safe and encouraged once the topic is clear"*) — `listChatHusks` reads
  the directory, so a renamed husk stays in the corpus.
- **Fabricated free-form value** — **GAP, partially.** An account is the shape of
  output a model can confabulate, and the incremental design makes it worse: a
  confabulated item is fed back as input every subsequent pass and can entrench.
  Retro requires `evidence` to be *"a LITERAL QUOTE copied from the transcript"*
  (`src/core/retro/observer.ts:44`); a title and a one-sentence `contains` have
  nowhere to put one. Mitigations: the prompt instructs that an empty `notes` array
  is the correct and common result (copying `observer.ts:48`), and **Track D makes
  the account visible in the husk view**, which is what turns this from silent to
  merely unguarded. If entrenchment shows up, the fix is a quote field on `notes` —
  more valuable under this design, since a quote can be checked against the span it
  came from.
- **Validation error UX** — **ADDRESSED.** `ReviewOutputSchema` violations surface
  through `invokeStructured` as typed failures (`src/core/agent/json.ts`
  `validateStructuredResult`) and drive a retry; exhausted retries count as an
  attempt and are reported in the run summary. Husks continue to validate normally —
  `title`/`contains`/`contains-evidence` are optional strings, so a written review
  cannot make a husk invalid.
- **Partial migration / transition state** — **ADDRESSED.** No data migration.
  `contains-evidence` and `review-span` are new optional fields, so every existing
  card stays valid untouched. Existing husks are untitled or carry a snippet title;
  both start at `titleOwner: "unmanaged"`. Boxes that never enable the schedule keep
  today's behaviour exactly.

---

## NOT in scope

- **The issue's fan-out to other sinks.** The original issue lists hunches → hunch
  file, action items → questions queue, facts → person/topic cards, naming four
  sibling issues as consumers
  ([session hot-context](../../../issues/features/2026-05-19-session-hot-context.md),
  [hypothesis tracking](../../../issues/exploration/2026-05-19-hypothesis-tracking.md),
  [behavioral profile](../../../issues/exploration/2026-05-19-behavioral-profile.md),
  [memory-writing guidance](../../../issues/exploration/2026-05-19-memory-writing-guidance.md)).
  **None of those sinks exist yet.** The `applied` map is keyed by consumer so the
  fan-out can be added without reshaping state.
- **The issue's "Full" tier** — daily/weekly cross-session rollups. Needs a
  destination and an audience decision.
- **Merging chat review into the retro pass.** They read the same transcripts.
  Deferred because their eligibility models differ (retro: once ever, any chat;
  review: repeatable, span-gated) and forcing them together would compromise the
  journal to fit retro's terminal state.
- **Reviewing non-web-chat sessions** (telegram/messaging threads, which have
  `chat-thread` cards, not husks).
- **Backfilling titles for the existing history.** A first run picks up every
  eligible session under the same gate, which *is* the backfill; short old sessions
  stay snippet-labelled.
- **A resumable/streaming transcript parse.** See Track A's performance note.
- **Deleting or trimming transcripts.** Space-reclaiming compaction is not what this
  is; `~/.claude` is untouched.

---

## Open design questions

- **Should `contains-evidence` be searchable or embedded?** Ruled out for now
  (Track B): the vector half's `SIMILARITY = 0.35` cutoff was fitted against
  one-sentence `contains` text. **Lean:** keep it out; if someone wants it, re-run
  the validation in `docs/plans/semantic-search.md` § Rollout rather than appending
  to `TEXT_PROPERTIES` and hoping.
- **Should `contains` regeneration be gated on the account having changed?**
  Rewriting an identical sentence every pass dirties the card and git history.
  **Lean:** yes — `setDerivedContains` already returns `changed`, so skip the write
  when neither field differs.
- **Does `NOTES_MAX = 40` want to be a size cap instead?** Item count is crude; the
  per-note 280-char cap bounds it indirectly. **Lean:** ship the count cap.
- ~~**Is the bootstrap pass's elision acceptable, or should long sessions be
  bootstrapped in chunks?**~~ **Settled (boxholder, 2026-07-28): accepted.** The
  first review of an already-long session reads it whole and elided, so the
  middle of a pre-existing 642k-char transcript is not summarized. Chunking it
  would cost ~16 sequential model calls per such session to recover history that
  predates the feature. Not worth it — getting old conversation logs perfect is
  explicitly not a goal. Every span after the bootstrap is a nightly increment
  far below the cap, so this affects backfill quality only, never ongoing
  accuracy.
