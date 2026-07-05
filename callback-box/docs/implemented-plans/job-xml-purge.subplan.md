# Job-Card XML Purge (subplan)

> **Landed** (2026-07). Implemented on `worktree-job-xml-purge`, merged to main.
> The verify step confirmed the "critical gap" was a **real silent bug**:
> frontmatter jobs reached the reactor agent stripped of their referenced cards
> and schema instructions. Two consumers this plan under-scoped were fixed
> alongside the enumerated ones: `wakeup-steps.ts` `cleanupStaleJobs` (matched
> the XML attribute `status="pending"`, so it silently skipped every frontmatter
> job — all live jobs — and never cleaned up stale ones; it had no test) and
> `collectExistingJobRefs` (carried a dead XML `ref="..."` fallback). A third
> buggy frontmatter producer the plan missed — `question-followup-job`
> (`question-ref: {ref}`) — is why the fix uses a generic `{ref}` walker
> (`card-io.collectRefs`) rather than per-schema extraction. Backfill got its own
> schema (`contains-backfill-job`), the reactor job body uses a plain fence, and
> a codex review follow-up hardened stale-cleanup to honor the schema-default
> `status`. The rest of the doc below is the original plan, preserved as-is.

Job cards were migrated to YAML-frontmatter (Phase 2) on the **producer** side,
but the reactor **consumer** side and one straggler producer still speak the old
XML format. This subplan finishes the purge: convert the last XML producer, make
the reactor read frontmatter, and delete the XML-regex paths — so "cards are not
XML" is true in code, not just in prose.

Discovered while working the prompt-surface plan
(`prompt-surface-ia-review.md`, Track 1). The parent plan's original Track 1
note claimed "job cards genuinely are still XML"; that is **wrong** and this
subplan supersedes it.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md` — "The format is **YAML frontmatter + markdown body**
  (Phase 2). Every schema is frontmatter; the legacy XML card format, its loader,
  and the `cardworks` package have been removed." The job-card XML remnant
  directly contradicts this stated reality.
- `callback-box/code-style.md` — no `any`, max-2 positional params, named-error
  catches; files ≤300 lines.
- *bias-toward-strict* (user memory) — parse frontmatter with the real card
  loader (`parseCardText`), not regex; fail-closed on a job we can't parse rather
  than silently degrade.
- The weight/clarity discipline: a ` ```xml ` fence that mislabels frontmatter is
  actively misleading context the agent pays for every reactor run.

## What already exists

**Producers — all frontmatter EXCEPT one:**

- `src/schemas/intake-job.tsx:77` — `createIntakeJobTemplate` returns
  `` `---\n${stringifyYaml(fields)}---\n` `` with `items: [{ref}]`. Covers the
  connector/intake path (rss/news/gmail/telegram jobs). **Frontmatter.**
- `src/schemas/chat-job.ts:80` — `createChatJobTemplate` likewise; `thread:
  {ref}`. **Frontmatter.**
- `src/cli/commands/wakeup-steps.ts:391` — the `contains-backfill` job is built as
  **XML**: `<contains-backfill-job created="..." source="..." priority="low">`
  with `<description>`, `<instructions>` (entity-escaped `&lt;`/`&gt;`), and
  `<item ref="..."/>` children via `escapeXmlAttr`. **The lone live XML
  producer.**

**Consumer — still XML-first, wrong for the frontmatter jobs above:**

- `src/core/reactor/batch-jobs.ts:75` — `buildJobDescription` wraps `job.content`
  in a ` ```xml ` fence. `:103` `extractRefs` matches `<item ref="...">` /
  `<thread ref="...">` by regex — **won't match** a frontmatter job's
  `items:\n  - ref: ...`, so referenced item cards are **not inlined** into the
  reactor prompt. `:116` `extractRootTag` matches `<tag>` — won't find a
  frontmatter type, so `getSchemaInstructions(rootTag)` gets nothing and the
  job-type schema instructions are **not injected**.
- `src/core/reactor/batch-jobs.ts:18` — `processBatchJobs` is the path all
  non-chat jobs take (`:1` "groups non-chat jobs"); confirmed via
  `engine.ts:36`.
- `src/core/reactor/chat-jobs.ts:99` — `extractThreadRef` matches `<thread ref>`;
  **dead** for current frontmatter chat jobs (their ref is `thread.ref` in YAML).
- `src/core/finish-job.ts:36` — `content.match(/<description>(.*?)<\/description>/s)`
  reads a job's description as XML; won't find frontmatter `description:`.
- `src/core/reactor/job-discovery.ts:44-53` — the **only** consumer that straddles
  correctly: frontmatter `priority:`/`source:` first, XML attribute fallback.

**On-disk legacy:** `~/src/boxes/test1/box/jobs/*.news.job.card` carry
`content-type: application/x-card+xml` and `<news-job>` bodies — **stale demo
data** (Feb/Mar 2026 dates), not what current code writes. New boxes never
produce these.

**Loader to reuse (don't rebuild):** `src/core/card-io.ts` `parseCardText` /
`splitCardContent` (from `src/cards/`) already parse frontmatter+body. The
frontmatter carries `items`/`thread` as structured data — read it via the schema
types (`IntakeJobFields`, `ChatJobFields`), not regex.

## Prior art (external)

None applicable — this is a purely internal format migration with no third-party
dependency. No external search performed; none warranted.

## Verify first (load-bearing — do before any edit)

Trace one real frontmatter intake job (a `.intake.job.card` with `items:`)
through `processBatchJobs` → `buildJobDescription` and confirm whether:

1. The referenced item cards are inlined into the reactor prompt (expected:
   **no**, because `extractRefs` is XML-only), and
2. The job-type schema instructions are injected (expected: **no**, because
   `extractRootTag` is XML-only).

Write a doctest asserting current behavior *before* the fix (red), so the fix is
provably a fix and not a guess. If the trace shows the refs/instructions **do**
reach the agent by some other path, the "latent bug" framing is wrong — stop and
re-scope (the purge becomes cosmetic-only: fence relabel + dead-code deletion).

This step decides whether the purge is a **bug fix** (re-inline refs + inject
instructions from frontmatter) or a **cosmetic cleanup** (just relabel the fence
and delete dead XML paths). Do not skip it.

## Tracks / scope

Single track, ordered chunks:

1. **Producer** — rewrite `wakeup-steps.ts` `contains-backfill` to frontmatter,
   matching `createIntakeJobTemplate`'s shape (`status`/`created`/`source`/
   `priority`/`items: [{ref}]`), with the instruction prose moving to the body
   (markdown) or a `description:` field. Consider adding a
   `createBackfillJobTemplate` in `src/schemas/` for symmetry, or fold into the
   intake template if the shapes converge. Kill `escapeXmlAttr` use here.
2. **Consumer — refs + type from frontmatter.** Rewrite `buildJobDescription` to
   parse the job with `parseCardText`, read `items`/`thread` refs from
   frontmatter, and derive the type from the **filename** (`.TYPE.job.card`) the
   way schemas do — feeding `getSchemaInstructions`. Replace the ` ```xml ` fence
   with the raw card text (no fence, or a ` ```yaml `/plain fence — decide in the
   chunk). Delete `extractRefs`/`extractRootTag` XML regex.
3. **Consumer — chat + finish.** Delete `chat-jobs.ts` `extractThreadRef` (read
   `thread.ref` from `ChatJobFields` instead if still needed). Rewrite
   `finish-job.ts:36` to read frontmatter `description:`.
4. **Discovery** — drop `job-discovery.ts`'s XML-attribute fallback once nothing
   on a live path emits XML (frontmatter-only).
5. **Prose backstop** — keep the single `agent-guide/cards.ts:32` line "Cards are
   not XML; anything that says so is stale" as the catch-all (per boxholder).

**Vocabulary lock-in:** job refs are `items: [{ref}]` (intake) and `thread:
{ref}` (chat) — the backfill producer must use `items: [{ref}]`, not invent a
third shape.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Frontmatter job's refs not inlined (current) | to be added (verify step) | no | **silent** — agent works from a job with no context |
| Schema instructions not injected (current) | to be added | no | silent |
| A legacy XML job on disk hits the frontmatter-only reader post-purge | add one | `parseCardText` throws → job errors visibly | clear (acceptable — legacy is test1-only) |
| Backfill producer emits a shape `parseCardText` rejects | schema validation on write | validate hook | clear |

**Critical gap (current, pre-fix):** `buildJobDescription` — frontmatter intake
jobs silently reach the agent without their referenced items or schema
instructions. The verify step confirms or refutes this; if confirmed, it is the
primary reason the purge is a fix, not a cleanup.

## Agent-flow / user-flow edge cases

- **Hand-edit drift** — a boxholder hand-writes an XML job: post-purge the reader
  rejects it (clear error). ADDRESSED (fail-closed, per bias-toward-strict).
- **Partial migration / transition** — during the purge window, `job-discovery`
  keeps its XML fallback until chunk 4; producers and consumers land in dependency
  order so no live job is ever read by the wrong parser. ADDRESSED (implementation
  order below).
- **Two agents / stale ref** — unchanged by this purge; refs still resolve the
  same way once read from frontmatter. Not in scope.
- **Legacy on-disk XML jobs** — only in test1 demo data; DEFERRED to "delete the
  fallback + note test1 is disposable" (NOT in scope: writing a migrator for a
  disposable demo box).

## NOT in scope

- **Migrating existing on-disk XML jobs.** They live only in test1 (disposable
  playground); new boxes never see them. Rationale: a migrator for demo data is
  cost with no production value. If a real box ever carried XML jobs, that's a
  separate one-off.
- **Touching the non-job XML that is deliberate protocol:** the `<chat-app>` /
  `<card-activity>` snapshot, `<speech>`/`<instructions>` voice markup, the
  frontend selection-serialize protocol. These are message/UI protocols, not
  cards — leave them.
- **The prompt-surface prose trims** (parent plan's other tracks) — separate
  worktree.

## Open design questions

1. **Fence for the job body in the reactor prompt** — none, ` ```yaml `, or plain
   text? *Lean: no fence or plain — the agent reads it as a card, and a `yaml`
   fence re-introduces a format label to maintain.*
2. **Backfill instruction prose home** — body markdown vs a `description:` field.
   *Lean: body markdown (it's multi-line instructions), matching how a doc/memo
   carries prose.*
3. **Whether `getSchemaInstructions` keys on the same type token** the filename
   yields (`intake` vs the old `intake-job` root tag). Resolve in chunk 2 by
   reading the registry.

## Implementation order

1. **Verify step** (doctest asserting current behavior) — decides fix vs cleanup.
2. **Chunk 1** producer (backfill → frontmatter).
3. **Chunk 2** consumer refs+type (the core fix).
4. **Chunk 3** chat + finish consumers.
5. **Chunk 4** drop discovery's XML fallback (last — nothing live emits XML by
   now).
6. **Chunk 5** confirm the `cards.ts` backstop line stays.

Each chunk is a commit; the plan ships as one piece when all land.

## Rollout shape

- **Tests first.** The verify-step doctest anchors current behavior; chunk 2's
  doctest asserts refs + instructions now reach the agent from frontmatter. Add a
  `finish-job` frontmatter-description test and a backfill-producer
  template test. Cover the reactor `buildJobDescription` path specifically — it's
  the critical-gap codepath.
- **No knowledge-audit** — this is infrastructural (job wire format), not an
  agent-facing concept the agent must recall. Skip-with-rationale.
- **No data migration** — see NOT in scope.

## Knowledge audits

None. This is internal wire-format plumbing; no agent-facing convention changes.
The one agent-facing statement ("cards are not XML") already exists at
`cards.ts:32` and stays.
