# Plan Engineering Review — architectural-review (codex cross-model pass)

Reviewer: OpenAI codex CLI (codex-cli 0.137.0, `model_reasoning_effort=high`),
read-only against the monorepo, 2026-07-05. Invoked via /codex plan mode.
All eight findings were accepted and folded into the plan the same day
(finding 7 partially — see its disposition). Dispositions recorded here;
the plan text is the source of truth for the revised directions.

## Findings and dispositions

### 1. Track P's `asserts` helper was unsound (HIGH)
**Citation:** plan Track P.1; `testing.md:608`.
**Issue:** `invariant(cond, msg): asserts cond` that may log-and-return in
prod lies to the type system — after a false condition returns, TS believes
a narrowing that didn't happen.
**Disposition: ACCEPTED, verified by inspection.** `invariant()` always
throws; prod degradation moved to a separate non-asserting
`checkInvariant(): boolean`. The flaw was introduced while applying the
dev/prod feedback — exactly the same-model blind spot a cross-model pass
exists to catch.

### 2. Track I's containment migration list was under-scoped (HIGH)
**Citation:** `wakeup-steps.ts` (under `cli/commands/`, not reactor),
`connectors/gmail-drafts.ts:260`, `core/nav.ts:93`,
`webapp/trpc/routers/views.ts:68`, `core/lint-node-refs.ts:112`.
**Issue:** four-site list missed five real resolver/reader sites; also a
path misattribution.
**Disposition: ACCEPTED.** List expanded; more importantly the closure
mechanism changed — fs-read wrappers typed to require `BoxRelativePath`
so the compiler enumerates sites instead of a grep list.

### 3. Track D.1 fixed the wrong boundary (HIGH)
**Citation:** `server.ts:76` (50MB multipart cap exists — verified);
`api-files.ts:68,197` (any box `.html` served as text/html, no
nosniff/attachment).
**Issue:** upload allowlist would break legitimate attachments while
leaving hand-added box HTML exploitable; the serving boundary is the fix.
**Disposition: ACCEPTED, both counter-claims verified.** Track rewritten:
serve-time attachment/nosniff for dangerous renderable types, explicit
preview path for the frozen/sandboxed modes.

### 4. Track H misclassified clerk.ts and capture-finalize (HIGH)
**Citation:** `clerk.ts:152` (new timestamped paths, `commitPaths` +
`isNothingToCommitError` — verified); `capture-session-store.ts:59`
(existing per-session lock).
**Disposition: ACCEPTED.** Lock scope narrowed to same-file
read-modify-write mutations; git commit/staging races split into a
separate audit with clerk's `commitPaths` as the model.

### 5. Typed EventMap decorative without a subscribe-boundary parser (MED-HIGH)
**Citation:** `event-bus.ts:122` (persisted rows re-read via JSON.parse);
`events.ts:26` (tRPC stream exposes `{event: string; data: unknown}`).
**Disposition: ACCEPTED.** Track B.4 now requires per-event zod at the
read/subscribe boundary + unknown-event sentinel, or the EventMap is
documented as producer-side ergonomics claiming no safety.

### 6. Track C's runtime-validation framing partly wrong (MEDIUM)
**Citation:** `card-io.ts:126,263` (parseCardText already zod-validates
frontmatter + body before the cast sites).
**Issue:** the `card.fields as unknown as X` casts are post-validation
type-propagation debt, not missing validation; re-parsing at every caller
adds ceremony without safety.
**Disposition: ACCEPTED — makes the track cheaper.** Primary fix is
generics through `parseCardText`/registry; `getCardFields` reserved for
paths that genuinely bypass `parseCardText`.

### 7. Track B's global Result migration is churn before a proven bug (MEDIUM)
**Disposition: PARTIALLY ACCEPTED.** The postpone-mass-conversion counsel
is declined — consolidate-over-blast-radius is a standing boxholder
preference, decided before this review. The concrete design point is
accepted: `AgentResult` carries transport fields on both arms and keeps
them as common fields in its union rather than being forced into the bare
two-arm shape.

### 8. Clock sweep conflated scenario time with deadline time (MEDIUM)
**Citation:** `cli/lib/time.ts:1` (scenario wall-clock);
`chat-session-registry.ts:324` (idle/ref deadline timing).
**Issue:** freezing liveness/deadline timers with `BBX_TIME` causes hangs
and non-eviction.
**Disposition: ACCEPTED.** Track P.2 rewritten as a two-clock taxonomy:
domain/scenario time → `getBoxTime*`; monotonic/deadline time → real time
with an injected timer seam (awake-timeout pattern), never `BBX_TIME`.

## Codex's single most important change

"Rewrite Phase 1 around the three concrete safety fixes only ... cut or
defer the broad type/lint/reorg migrations until those fixes land with
tests." **Disposition: already substantially the plan's shape** — Phase 1
leads with exactly those safety fixes; the type/lint infrastructure stays
in Phase 1 because later tracks depend on it, and the reorg is already
last. No change beyond the per-finding revisions above.

## Things codex checked and did not flag

The ref-containment gap, the todos race, push-subscriptions truncation,
and the batch-jobs prompt-inlining were all independently confirmed as
real ("the core bug is real"). No citation in the plan was found to be
fabricated; the errors found were scoping and framing, not invention.
