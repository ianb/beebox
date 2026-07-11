# Architectural Review — Findings and Improvement Plan

**Status:** implemented 2026-07 — all tracks A–P landed on the
`architectural-review` worktree and merged to `main`; the genuinely-open
judgment calls below were carried forward to
[`issues/decisions/2026-07-06-architectural-review-open-decisions.md`](../../../issues/decisions/2026-07-06-architectural-review-open-decisions.md)
rather than left buried in this now-historical plan.

A whole-monorepo architectural review (2026-07-05), run as ~17 parallel scan
agents plus direct tooling (knip, madge), synthesized into an improvement plan.
This document is both the review's record and the plan for acting on it —
kept here as the historical record of that work.

> **STATUS: IN IMPLEMENTATION (updated 2026-07-06, historical).** Boxholder-approved;
> implementing on the `architectural-review` worktree.
>
> - **Phase 1 — safety fixes + enforcement infrastructure: COMPLETE.** The
>   `assertNever`/`invariant`/`checkInvariant` helpers (`src/lib/invariant.ts`),
>   the Result convention (`src/lib/result.ts`), `withCardLock`
>   (`src/lib/card-lock.ts`), containment (`src/lib/box-containment.ts` +
>   `resolveContainedRef` in `core/ref-exists.ts`), the typed env boundary
>   (`src/lib/env.ts`), and the preset's `switch-exhaustiveness-check` +
>   `no-floating-promises`/`no-misused-promises` rules are all landed and live.
> - **Phase 2 — type-structure retrofits: COMPLETE.** Cast helpers
>   (`cardFields`, `parseCommandArgs`), `fenceForPrompt`
>   (`src/lib/prompt-fence.ts`), and the boundary/union work built on Phase 1.
> - **Phase 3 — wide/mechanical + documentation: IN PROGRESS.** The
>   documentation deliverables (Track M code-style additions,
>   `docs/engineering-principles.md`, Track N cb-codehealth checks, Track O
>   /finish review pass, the engine-dev knowledge audits) are landing now;
>   L consolidation and the remaining F rules are in flight.
>   **Track G (module reorganization): DONE** (2026-07-06). Layering moves
>   (box-config→core, cli/lib generic utilities→lib, view-types out of
>   types/), the full core/ prefix-cluster regroup into subdirs (agent/, box/,
>   chat/+chat/session/, docs-gen/, external/, markdoc/, schedule/,
>   transcription/, triage/, views/), the frontend lib/ extraction
>   (audio/patmatch/selection/trpc), page-local subdirs (capture/, browse/),
>   the ViewRenderer→AgentViewRenderer + chats→session-pickers renames, the
>   single-feature loose-component fold, and the two dead REST exports all
>   landed commit-per-cluster with typecheck/lint green between each. Circular
>   count unchanged (15, documented leaf-splits only). Decisions: **no
>   barrels** (would change export visibility / risk cycles for no
>   discoverability gain the dir grouping doesn't already give); **prefix
>   stripping applied** (files in a subdir drop the redundant prefix).
>   Deferred (with reason): the frontend `@core`/`@schemas` import-boundary
>   mechanism (aliases = build-config churn across tsconfig+vite+eslint;
>   no-restricted-imports = preset change needing boxholder sign-off — pick
>   one), the DebugLog `useSyncExternalStore` port and the
>   FileView/AgentViewRenderer 300-line splits (behavior-sensitive surgery,
>   out of the mechanical scope), and a `components/chat/interactive/` subdir
>   for the ~20 `InteractiveChat-*` files.
>
> Genuinely-open decisions still needing a boxholder call: router remediation
> depth (Q7), the clerk↔server contract (Q1), the chat-thread SDK-narrowing
> intent (Q2), the markdoc walkers, and the barrels convention (Q4, pending
> P3-d). The original synthesis record — all 17 scans + 4 external-research
> agents, 2026-07-05, with load-bearing citations (ref containment, card write
> races, push-subscriptions truncation, silent catches, dead REST route,
> zero-assertNever, missing setErrorHandler, hand-written fields interfaces,
> ChatMessage shape) verified directly against source — is preserved below;
> scan-report citations should still be re-verified before acting on a
> specific line number.

## Preface: the rules we're reviewing against

Every finding and every track in this plan traces to one of these principles.
They come from three sources: `callback-box/code-style.md`, the monorepo
`CLAUDE.md`s, and the boxholder's stated preferences during this review. Where
a principle is new (not yet written down anywhere), it's marked **(new)** — one
output of this plan is deciding where each new principle should live.

1. **Types are structure.** Prefer types that make illegal states
   unrepresentable: discriminated unions over flat interfaces with correlated
   optional fields; literal unions over bare `string` discriminators; branded
   types where a `string` carries an identity that could be cross-wired
   (paths, IDs, refs). **(new — extends code-style.md's `any`/`as` rules)**
2. **Exhaustiveness is enforced, not hoped for.** Every dispatch over a closed
   set (switch, if-chain, lookup object) must fail to compile when a member is
   added. Idioms: `assertNever`, `Record<Union, Handler>` with `satisfies`,
   `@typescript-eslint/switch-exhaustiveness-check`. **(new)**
3. **Validate at boundaries and during parsing.** Disk reads, LLM output,
   HTTP bodies, third-party API responses, config files, and env vars each
   get validated into typed data exactly once, at the boundary, with loud,
   localized failure. `JSON.parse(...) as X` is the anti-pattern (parsing
   without validating); `schema.safeParse` with an explicit failure path is
   the pattern. Config is untrusted content too.
4. **Resilient AND never silent — and never resilient to the impossible.**
   Degradation is allowed for failures that can genuinely happen; invisible
   degradation is not, and *seemingly-impossible* states get hard failure,
   not resilience — don't limp past a broken invariant. Every catch block
   either rethrows, returns a typed failure, or logs — and "logs" means at
   a level someone will see, carrying enough context (box, card, operation)
   to debug from the log line alone. Dev/test fail hard where prod may
   degrade (invariant checks strict in dev and tests, except in tests that
   exercise the degradation path itself). (code-style.md Error Handling,
   sharpened by boxholder during this review.)
5. **Failure paths visible in signatures where callers branch.** When callers
   genuinely dispatch on failure kinds, return a discriminated Result
   (`{ok: true, ...} | {ok: false, reason: ...}`) instead of throwing. When
   callers can't act on the failure, exceptions (typed error classes, `cause`
   chaining) are correct. One Result shape convention, not two.
6. **Right-sized defensiveness.** No handling for states the types prove
   impossible — assert/crash loudly instead of inventing a fallback value.
   Defense concentrates at real boundaries (rule 3); interior code trusts its
   types. A `?? default` on a value that can't be nullish converts a bug into
   silent wrong behavior — which violates rule 4. **(new — calibrates the
   known AI-overdefensiveness failure mode)**
7. **Hierarchy is a discoverability contract.** You should be able to predict
   where something lives, and conclude from its absence that it doesn't
   exist. Directories whose names promise content they don't hold (a decoy
   `audio/`), and clusters that encode their directory in filename prefixes
   (`chat-session-*.ts` × 15), both break the contract.
8. **One way to do each thing.** Competing idioms (two Result field names,
   three duration parsers with three failure behaviors, four tool-name
   dispatch copies) are drift generators. Consolidate over blast-radius fear;
   duplication is only kept when copies genuinely co-evolve independently —
   and then the divergence is documented at the site (`bin/box-entry.ts` is
   the model).
9. **Formal structure for essential complexity.** Where hard code can't be
   made simple, make it explicit: state machines (xstate where async actor
   coordination is the problem, plain discriminated-union + transition
   function otherwise), documented lock tables, invariant assertions,
   protocol docs. Hard work maintaining structure is good when the
   difficulty is essential.
10. **Testability is architectural, and deeper than usual taste.** Seams
    (clock injection, fs/agent injection points, pure cores extracted from
    IO shells) are built into production code deliberately, even where
    conventional style would call it over-engineering. Test-only
    affordances must not widen the prod security surface — gate them
    behind an explicit process flag (the `CB_TIME`/stubs pattern) so a
    seam is inert unless deliberately enabled.
11. **Enforcement beats convention, and the preset is ours.** A rule that
    matters gets a lint rule or a type, not a paragraph.
    personal-vibe-check effectively belongs to this project — extending it
    with new rules is normal work, not a special event. A written rule
    that's widely violated is either a dead letter (delete it) or a debt
    list (schedule it) — never ambient guilt. Suppression is sometimes
    right: infrequent, signaled, line-level only (never file- or
    rule-level), with a justification — and when a legitimate exception
    recurs, encode it into the rule itself rather than accumulating
    disables. Where lint can't express a rule, a review rule (Track O)
    is the fallback enforcement tier.
12. **The maintainer is usually an agent.** Structures that catch agent
    mistakes at compile time pay double here: an agent can't hold tribal
    knowledge between sessions, so anything enforced only by memory of past
    conversations will eventually be violated. **(new)**

## Stated preferences this plan trades against

- `callback-box/code-style.md` — error handling (never-silent, custom error
  classes, minimal catches), `as`-discipline ("treat `as` like Rust's
  `unsafe`"; centralize in typed helpers), max-2 positional params, only
  export what's needed.
- `callback-box/CLAUDE.md` — validation contract; "all cross-process locks go
  through `src/lib/file-lock.ts`"; raw-routes-are-debt.
- Monorepo `CLAUDE.md` — never weaken lint rules; noisy output is a bug;
  issues/ as parking lot.
- Boxholder preferences stated during this review: bias toward strict;
  consolidate over blast-radius fear; resilient-and-never-silent; pro
  deep-testability; open to branded types and trusted/untrusted content
  marking; wants Result types; wary of over-defensiveness.

## What already exists (reuse these; they're the house style at its best)

The review found the codebase's strong points as consistently as its gaps.
These are the internal exemplars each track should extend rather than rebuild:

- **`src/lib/file-lock.ts`** — cross-process locking done right (PID +
  boot-epoch liveness, atomic `wx` acquisition, self-healing). Track H builds
  on its documented in-process/cross-process distinction.
- **`core/agent-json.ts` (`validateStructuredResult`)** — the model LLM-output
  boundary: zod `safeParse`, never throws, clean `{success: false}` signal.
- **`hub/hub-config.ts`, `core/box-shape.ts` (via cli), `cli/commands/upgrade.ts`** —
  strict, fail-closed, transactional config/disk boundaries.
- **`core/place-mark.ts` `MarkResult`** — a genuine two-arm discriminated
  Result union; the shape Track B standardizes on.
- **`src/services/` interface/real/fake triad** — narrow external-API
  surfaces with injection seams; the pattern Track D's connector validation
  slots into.
- **`frontend/src/machines/`** — six mature, typed xstate machines, all live,
  docs in sync (`docs/composer-input-machine.md`). xstate's home; not to be
  extended server-side.
- **`bin/router.ts` `EntryState`** — plain discriminated-union lifecycle with
  guarded transitions and generation-identity race checks; the target pattern
  for Track J's backend state work.
- **`bin/box-entry.ts:11-20`** — documented, reasoned cross-package
  duplication; the template for any duplication we decide to keep.
- **The error-class lint rule** — zero bare `throw new Error(` anywhere;
  ~90 purpose-named error classes. The throw side needs no work.
- **`webapp/server-box-scope.ts:151` tRPC global `onError`** — the logging
  boundary raw Fastify routes are missing (Track E copies it).
- **agent-doctest's tsconfig** — the strictest in the workspace
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …); the ceiling
  Track F raises other packages toward.

## Prior art (external)

PENDING — four dedicated research agents running (results synthesized here
before the affected tracks' designs are final). The principle: tracks that
*extend house patterns* (E, G, H, K, L) need no external research; tracks
that *introduce new mechanisms* get serious research before we build:

1. **Trust marking (Track I) — DONE.** Key results (full report in session
   research archive):
   - The proven shape is two-part: blessed producers + **banned raw sink**
     (Google SafeHtml/safevalues via safety-web conformance checks; Trusted
     Types via CSP). "A branded type with no sink-side enforcement is
     decorative." Kern, "Securing the Tangled Web" (CACM 2014,
     https://queue.acm.org/detail.cfm?id=2663760) is the origin evidence.
   - **No mainstream TS taint-typing library exists** — everyone does manual
     branding at explicit boundary functions; our plan's shape matches
     practice.
   - **Path containment: no CVE-clean maintained library exists** —
     `resolve-path` has CVE-2018-3732; `@fastify/static`'s own containment
     shipped a traversal bug in 2026 (GHSA-pr96-94w5-mx2h). Verdict:
     hand-roll ~20 lines (`path.resolve` + `decodeURIComponent` first +
     `=== root || startsWith(root + path.sep)` + `fs.realpath` both sides),
     exhaustively tested: prefix-collision (`root` vs `root-evil`),
     percent-encoding, trailing separators, macOS `/var`→`/private/var`
     symlinks.
   - **Fencing:** CommonMark dynamic fence length (one more backtick than
     the longest run in content) is well-specified; no adoptable library.
     Microsoft Spotlighting (https://arxiv.org/abs/2403.14720) measures
     delimiting/datamarking at >50%→<2% attack success; Anthropic's own
     position: no agent is immune — fencing stops masquerade-as-structure,
     not instruction-following; pair with least-privilege tool access
     (OWASP dual-LLM guidance).
   - **Serialization boundaries launder brands** (JSON round-trips silently
     re-cast) — each such crossing is a required re-validation point.
2. **Result + branded types (Tracks B/C) — DONE.** Decisions:
   - **Result: hand-rolled, no library.** `lib/result.ts` is ~20 lines: the
     `MarkResult`-shaped two-arm union + `ok()`/`err()` constructors and at
     most 2-3 helpers, added only when a third caller wants them. Rationale:
     every Result library pays an interop tax at each throw-based boundary
     (DB rollback, Sentry, framework middleware all expect throw —
     documented by teams running neverthrow in production:
     https://runharbor.com/blog/2025-11-24-why-we-dont-use-effect-ts), and
     the one thing a library would buy us — must-use enforcement — is an
     unofficial third-party ESLint plugin regardless of which library, so
     the dependency buys combinator sugar we don't want and nothing we
     need. Effect rejected outright. Precedent for exactly this choice:
     https://engineering.spendesk.com/posts/ts-error-handling/.
   - **Result consumption is enforced by review, not lint** (no
     first-party must-use rule exists): Track O checklist item — a
     Result-returning call whose `.ok` is never read is a defect. Revisit
     as a custom lint rule if it recurs.
   - **The Result/exception boundary is a rule, not a vibe:** failures the
     caller branches on → Result. Broken invariants → throw (rule 4's
     hard-failure case; wrapping them in `err` lets the program "continue
     indefinitely in this broken state" —
     https://medium.com/@ethanresnick/fixing-error-handling-in-typescript-340873a31ecd).
     Infrastructure failures → throw (matches our existing boundary
     handlers). No TS-core movement on typed throws — this division is
     permanent, not transitional.
   - **Branding: zod `.brand()` wherever a zod boundary already exists**
     (one declaration = validation + nominal type); strict unique-symbol
     brands for the rest; weak/"flavored" branding never as an end state.
     Brands are runtime-erased — JSON round-trips unchanged, and every
     deserialization re-establishes the brand via the producer (same
     conclusion as research item 1). Log lines can't show brands, so
     brand-check failures throw named error classes.
   - **Wire-protocol union migration** (no direct prior art found —
     reasoned, not sourced): discriminant stays a top-level field. Before
     Track B's ChatMessage change, check deploy coupling in deploy.sh —
     frontend and backend ship together, so the transitional
     `old | new` dual-shape state should be skipped entirely; if some skew
     window exists after all, the transitional union is time-boxed via an
     issues/ entry.
3. **Env module (Track D.8) — DONE.** Key results:
   - **Hand-rolled zod, no library.** t3-env's specialty (client/server
     bundler split) doesn't apply; envalid = second validation vocabulary +
     default `process.exit` + unconfirmed secret redaction; znv's real
     value (boolean coercion — `z.coerce.boolean()` treats `"false"` as
     true — and all-errors reporting) is ~20 lines to replicate vs a
     pre-1.0 dependency. No library models parent-computes-child-env; our
     `hub/child-env.ts` stays a separate hand-written outbound function
     taking *validated* values in.
   - Shape: per-entrypoint schemas via `baseSchema.extend(...)` (CLI /
     server / hub), a `loadEnv(schema, source = process.env)` *function*
     (not a top-level parsed constant — keeps tests off the module-cache
     dance), secret-name set driving redaction in the error formatter
     (never echo values), called as the entrypoint's first substantive
     import.
   - Gotchas: `emptyStringAsUndefined` semantics (audit current reads
     treating `""` as unset); esbuild `define` silently stops replacing
     `process.env.X` in files that `import process from "node:process"`
     (esbuild#2671) — audit before centralizing; migrate secrets first so
     redaction is proven before anything sensitive routes through.
   - No retrofit postmortems exist (search came up empty) — tolerated
     `process.env` escape hatch with a marker comment during transition
     is the reasoned default, not sourced practice.
3. **Exhaustiveness (Track A) — DONE.** Key results:
   - Exact config for the preset (matches the rule authors' own strict
     stance — issues #10307 wontfix, #3616):
     `considerDefaultExhaustiveForUnions: false` (a bare default does NOT
     count as exhaustive — the load-bearing option),
     `requireDefaultForNonUnion: true`,
     `allowDefaultCaseForExhaustiveSwitch: true` (so
     `default: assertNever(x)` stays legal). Rule covers switches only —
     if/else chains need manual assertNever in the final else.
   - Type-aware rule: if it's the preset's first type-aware rule, budget
     for tsc-speed linting (`projectService: true`, narrow globs); run a
     full-repo isolated dry pass before flipping to error; pin a recent
     typescript-eslint (option behavior was literally inverted in one 2024
     release, #10222).
   - **Wire-tolerance pattern** (resolves the SSE union question): don't
     widen the discriminant and don't add a silent assertNever mode —
     extend the union with a sentinel `{type: "unknown"; raw: unknown}`
     variant produced ONLY by the boundary parser; downstream switches
     stay strictly exhaustive with the sentinel as a real handled case
     (log + count it, so a parser bug can't hide indefinitely). Source:
     Speakeasy forward-compatible-unions writeups.
   - **Record-dispatch limit:** the correlated-types gap (TS#30581) —
     per-variant payload types don't survive a plain
     `Record<Kind, Handler>`; use it for shared-signature dispatch,
     switch+assertNever where handlers need per-variant arg types.
   - **ts-pattern: skip for now** (mature, 900k weekly downloads, but
     introducing it simultaneously with the first exhaustiveness idiom is
     double new-idiom churn); revisit per-union if nested matching needs
     emerge. No named large-repo precedent configs surfaced — lean on the
     rule authors' documented position + our own dry-run numbers, not
     "repo X does this."
4. **Env module (Track D.8):** znv / t3-env / envalid / hand-rolled zod;
   the parent-computes-child-env case (we have `hub/child-env.ts`); test
   override patterns vs frozen-at-import; per-entrypoint schemas (CLI vs
   server vs hub); secrets-redacting failure UX; retroactive-migration
   writeups.

## Tracks

Ordered by implementation dependency, then surface size. Tracks A–C are the
enforcement infrastructure everything else leans on; D–J are applications;
K–N are cross-cutting adoption. **PENDING scans may add tracks or reshape
D/G/L.**

### Track A — Exhaustiveness infrastructure

**What.** Add the missing exhaustiveness discipline: one shared
`assertNever(x: never): never` helper; enable
`@typescript-eslint/switch-exhaustiveness-check` in personal-vibe-check
(configured to reject `default:` as an exhaustiveness dodge on real unions);
convert pure dispatch tables to `Record<Union, Handler>`.

**Why.** The scan found **zero** instances of any exhaustiveness idiom in the
entire repo, despite it being a stated preference. The ~9 union switches that
look protected are only accidentally so (forced return types); every
`void`-returning switch silently ignores new union members. Two concrete
drifts already exist: `chat-thread-session.ts:109` vs
`chat-session-messages.ts:229` (same SDK union, one missing `user` and
`stream_event` cases), and four hand-synced tool-name dispatch copies
(`cli/lib/session-content.ts:38`, `dev/lib/session-report.ts:171`,
`dev/lib/test-runner.ts:300`, `frontend/.../activity-rendering.tsx:91`), one
of which has already diverged.

**Direction.** (1) `assertNever` in a shared location importable by all four
packages (likely personal-vibe-check exports it, or `lib/` + re-exports).
(2) Lint rule on in the shared preset — this is a preset change, which per
CLAUDE.md needs the boxholder's explicit sign-off; this plan is that request.
(3) Fix the fallout the rule surfaces, converting dispatch-table cases to
`Record` form. (4) Resolve the two known drifts as part of the fallout pass
(the `adaptSdkMessage` pair needs an intent decision: is thread-session's
narrowing deliberate?).

**Traces to:** rules 2, 8, 11, 12.

**First chunk.** Add `assertNever`; enable the rule in the preset; fix
compile/lint fallout in one package (agent-doctest, smallest) to validate the
configuration; then sweep callback-box.

### Track B — Discriminated unions for core protocol types + one Result convention

**What.** Retrofit the flat "optional-field bag" types into discriminated
unions, and unify the two Result shapes (`ok:` vs `success:`) into one
convention in a new `lib/result.ts`.

**Why.** `ChatMessage` (`core/chat-session-messages.ts:81-109`) is the entire
chat wire protocol as one interface with ~10 optional fields whose validity
depends on `type`; `AgentResult`/`StructuredAgentResult`
(`core/agent-types.ts:48-72`) enforce success⇔data-present only in a doc
comment; `ChatMessageContent.type` is bare `string` requiring an `as` cast to
construct. The EventBus (`core/event-bus.ts:39`) has 18 event names with
untyped payloads. Result-shaped returns exist in ~15 files under two field
conventions.

**Direction.** (1) `lib/result.ts` with the `MarkResult`-style two-arm shape;
migrate `ok:`/`success:` families to it (mechanical, caller churn accepted per
consolidate-over-blast-radius — codex's postpone-until-a-bug counsel noted
and declined as a standing scope preference). Design caveat from codex
(accepted): the existing shapes are not all pure Results — `AgentResult`
carries transport fields (`output`, `exitCode`, `sessionId`) on BOTH arms;
its union keeps those as common fields with only the success-correlated
fields (`data`, `error`) split across arms, rather than forcing it into the
bare two-arm shape. (2) `ChatMessage` → 7-variant union keyed on `type`
(its own adapters already switch exhaustively — Track A's lint rule then
locks them). (3) `AgentResult` → success/failure union per the caveat
above. (4) EventBus → typed `EventMap` with `emit<K extends keyof
EventMap>` — with the codex-flagged boundary honored: the bus is persisted
and cross-process (`event-bus.ts:122` reads rows back through
`JSON.parse`; the tRPC stream exposes `{event: string; data: unknown}`,
`events.ts:26`), so a typed emit alone is decorative. Per rule 3, per-event
zod schemas validate at the read/subscribe boundary with an unknown-event
fallback (Track A's sentinel pattern) — or the EventMap is documented as
producer-side ergonomics only, claiming no safety. (5) Literal-union the
stringly fields the scans named: procedure `severity` (`warn|review|abort`),
the two step-status vocabularies, procedure-run status enum reuse at the
write boundary (`engine-run-card.ts:111`).

**Traces to:** rules 1, 2, 5, 8.

**First chunk.** `lib/result.ts` + migrate the procedure engine's
`{success, error}` family (the largest existing Result user).

### Track C — Kill `as unknown as`: z.infer + typed cast helpers

**What.** Derive card-field types from their zod schemas (`z.infer`) instead
of hand-written parallel interfaces, and replace the two dominant unsafe-cast
shapes with validated helpers.

**Why.** `card.fields as unknown as XFields` appears at ~15 sites (7 for
`ScheduledScriptFields` alone), rooted in `schemas/scheduled-script.tsx:111`
hand-declaring the interface parallel to the zod schema 40 lines above it.
`args as unknown as <Command>Args` repeats across ~10 CLI commands. Both are
exactly the "centralize in a single well-named typed helper" remedy
code-style.md already prescribes but never got. This is simultaneously the
top boundary-validation finding (drift is invisible to compiler AND runtime)
and the top code-style violation.

**Direction.** (1) In each schema file: `type XFields = z.infer<typeof
xFieldsSchema>` (delete the hand copy). (2) Reframed per codex review: the
`card.fields` casts are mostly *post-validation type-propagation debt*, not
missing validation — `parseCardText` already zod-validates frontmatter and
body (`card-io.ts:126,263`) before the cast sites run. So the primary fix
is carrying generics through `parseCardText`/the schema registry so
validated fields arrive typed and the casts disappear; a `safeParse`-ing
`getCardFields(card, schema)` helper (with the Track B Result shape on
failure) is reserved for the sites where fields genuinely arrive
unvalidated (anything bypassing `parseCardText`). This makes the track
cheaper, not weaker. (3)
`parseCommandArgs(args, schema)` for the CLI shape. (4) Frontend: the 22
`as never` casts at `navigate({search})` sites (ChatPage, HistoryPage,
InteractiveChat-ws, landmarks, etc.) — the codebase already built the
sanctioned centralized escape hatch once (`lib/routing.ts:12`'s `href()`)
and didn't extend it; add `from:` scoping or a typed `navigateTo()` helper
so the cast lives in one named place. Also `ssr/render.tsx:315-324`'s
double-cast noop tRPC client → `createSsrNoopTrpcClient()` helper. (5)
Consider extending the `.tsx`-only `as`-ban lint rule to `.ts` once the
dominant shapes are gone (boxholder decision; preset change) — note
`as never` evades the current rule entirely.

**Traces to:** rules 1, 3, 11; code-style.md's own `as` rule.

**First chunk.** `ScheduledScriptFields` → z.infer + helper, migrating its 7
cast sites; validates the pattern before the sweep.

### Track D — Boundary hardening (ranked by blast radius)

**What.** Bring the weak trust boundaries up to the standard the strong ones
(`agent-json.ts`, `hub-config.ts`, `box-shape.ts`) already set.

**Why/Direction (ranked).**
1. **Renderable-file serving** (revised per codex review — the original
   upload-allowlist framing fixed the wrong boundary and overclaimed:
   multipart uploads already have a 50MB cap, `server.ts:76`, and an
   upload allowlist would break legitimate arbitrary-file attachments
   while leaving hand-added box HTML exploitable). The real boundary is
   `/api/files/*`: it serves any `.html` in the box as `text/html`
   (`api-files.ts:68`) with no `nosniff`/attachment headers (`:197`)
   under Report-Only CSP — a stored-XSS path regardless of how the file
   got there. Fix at serve time: dangerous renderable types default to
   `Content-Disposition: attachment` + `nosniff`, with an explicit
   preview path for the trusted/frozen render modes that already have
   their own sandbox CSP.
2. **Connector inbound payloads** (Gmail/Calendar/Telegram) — zero runtime
   validation of third-party responses (we validate our *outbound* writes but
   not inbound). zod schemas at the `services/` layer, parsing raw responses
   once.
3. **`core/push-subscriptions.ts:46-56`** — parse-error and ENOENT share one
   catch returning `{}` (verified: non-ENOENT gets a `console.warn`, but the
   load still succeeds as empty); the next read-modify-write then overwrites
   the corrupted store, destroying all subscriptions. A warning that
   precedes data loss isn't resilience. Distinguish the cases; corrupt
   store aborts the write.
4. **`core/boxes-config.ts:40`** — uncaught JSON.parse on hand-editable
   config crashes the CLI. Mirror `box-config.ts`'s handling + minimal zod.
5. **Gemini JSON** (`describe-images-helpers.ts:315`,
   `scan-import-gemini.ts:217`) — the one non-Claude LLM boundary that
   bypasses the zod pattern; also a triple-duplicated shape description.
   Single zod schema as source of truth.
6. **`core/chat-schedules.ts:198`** — unvalidated persisted shape; corrupt
   `firesAt` → `NaN` timer fires immediately. zod per entry, skip invalid.
7. **Raw chat-send routes** (`chat-send-routes.ts:187`) — hand validation;
   already flagged as debt in CLAUDE.md. Lightweight zod at handler top.
8. **Typed env module** — 33 files read `process.env` ad hoc (~40 vars,
   secrets included), no startup validation, three files independently
   default `"http://localhost:3210"`. One zod-validated `env.ts` parsed at
   process start; migrate secrets + networking first. Fold in the
   `publicUrl` three-source cascade (`core/script-env.ts`) as an explicit
   `resolvePublicUrl()`.

**Traces to:** rules 3, 4, 6.

**First chunk.** Items 3+4 (small, high-damage, self-contained), then 1.

### Track E — Error-policy completion (the swallow side)

**What.** The throw side is done (lint-enforced typed classes). Finish the
other half: no silent drops, identity preserved across boundaries, one
logging-level policy.

**Direction.**
1. `server.setErrorHandler` in `webapp/server.ts` mirroring the tRPC
   `onError` — raw routes currently have no logging boundary at all (the
   tRPC comment documents a bug that hid for days for exactly this reason).
2. Fix the one genuinely silent catch: `chat-send-routes.ts:268`
   (`markMostActive(...).catch((_e) => {})` on the chat hot path).
3. `command-runner.ts` stops flattening typed errors to `.message` — carry
   the error object (or a tagged translation) to the CLI boundary so
   `instanceof` survives.
4. `cause` chaining convention: wrapping errors pass `{cause}` instead of
   interpolating `.message` (~15-20 files, opportunistic).
5. Logging-level policy written into code-style.md: `console.error` =
   human-investigates; `warn` = recovered-but-unexpected; `debug` = routine
   diagnostics (and per CLAUDE.md, routine success prints nothing);
   `console.log` = CLI user output only. 1000+ existing call sites migrate
   opportunistically, not as a sweep.
6. Evaluate a catch-must-log-or-rethrow lint approach for the ~489
   non-rethrowing catches (most are legitimate commented ENOENT-style
   absorbs; the rule needs an idiom that blesses those explicitly).

**Traces to:** rules 4, 5, 11.

**First chunk.** Items 1+2 (one hook, one line — closes the two live silent
paths).

### Track F — Lint preset + tsconfig strengthening

**What.** personal-vibe-check additions and workspace tsconfig alignment.
Every item here is a preset change requiring boxholder sign-off — this plan
is the request; nothing lands without it.

**Direction.** Priority-ordered additions:
`@typescript-eslint/no-floating-promises` (would already have caught real
clerk bugs), `no-misused-promises`, `switch-exhaustiveness-check` (Track A),
non-null-assertion restriction (the unguarded twin of the `as` ban),
`no-unnecessary-condition` (Track: over-defensiveness — PENDING scan will
calibrate), `strict-boolean-expressions` (mechanizes the existing hand-written
`!== undefined` convention), `jsx-a11y` (the "components own their a11y"
memory has no enforcement today), `promise-function-async`, `return-await`,
type-aware `no-shadow`. tsconfig: raise callback-clerk and the frontend
toward agent-doctest's flag set (`exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`); `bin/`'s explicit
`exactOptionalPropertyTypes: false` gets a justification comment or removal.

**Traces to:** rules 11, 12; bias-toward-strict.

**First chunk.** `no-floating-promises` + `no-misused-promises` alone
(highest value, bounded fallout), fix violations, measure the noise before
adding more.

### Track G — Module reorganization

**What.** Regroup the directories that break the discoverability contract;
fix the three layering violations.

**Direction.**
1. `core/`: 139 loose files → grouped subdirs (`chat/` + `chat/session/`,
   `agent/`, `docs-gen/`, `transcription/`, `box/`, `schedule/`, `views/`,
   `triage/`, `markdoc/`, `external/`), leaving ~25-30 genuine singletons
   loose. Mechanical but wide; do it in one commit-per-cluster series.
2. Frontend: populate the decoy `audio/` (13 audio/voice files currently in
   `lib/`); extract `patmatch/` (a coherent lexer/compiler pipeline),
   `selection/`, `trpc/` from the 50-file `lib/` grab-bag; fold the 48
   loose `components/` files into their matching existing subdirs;
   `pages/capture/` (6 loose files, the convention's biggest violator) and
   `pages/browse/` (fat page + its single-use components stranded in shared
   `components/browse/`); optionally `components/chat/interactive/` for the
   18-file `InteractiveChat-*` hyphen family; collapse one-file component
   dirs and rename `components/chats/` (session pickers) away from
   colliding with `components/chat/`.
3. Layering: move `webapp/box-config.ts` → `core/` (12+ upward imports
   fixed); promote `cli/lib/*` shared utilities into `src/lib/` (it's a
   second lib/ used by every layer); move `ActivityKind` out of
   `types/`→`core/` inversion.
4. Frontend boundary: add `@core/*`/`@schemas/*` aliases or a
   `no-restricted-imports` rule so the 26 raw `../../../core/...` imports
   become a visible, enforced contract.
5. Decide the barrel question one way (currently 10 dirs have `index.ts`,
   13+ multi-file dirs don't); leaning: barrels for dirs with 3+ files.
6. Rename top-level `lib/` vs `cli/lib/` collision resolved by (3); document
   the lib/shared/types boundary in one paragraph.
7. Frontend consistency point-fixes (small, batched into one commit):
   file-naming casing is split ~50/50 (`ack-badge.tsx` beside
   `BackgroundTasks.tsx`; `chatMachine.ts` beside `chat-actors.ts`) —
   codify PascalCase-for-single-component-files / kebab-otherwise in
   code-style.md, rename opportunistically; three semantic-palette
   violations (`CommitTimeline.tsx:128` blue→info, `ViewRenderer.tsx:275`
   gray→warm, `DebugLog.tsx:145`) and amend frontend.md's capture-surface
   exception wording; port DebugLog's hand-rolled listener store to
   `useSyncExternalStore` (the codebase standard, 3 exemplars); the
   FileView/ViewRenderer 300-line-cap splits along their existing seams.
8. The "view" heptonym (7 distinct concepts sharing the name) — fold
   renaming into the already-planned views-attach-to-cards consolidation;
   at minimum `ViewRenderer.tsx` → `AgentViewRenderer.tsx` now.

**Traces to:** rules 7, 11.

**First chunk.** Layering moves (item 3) — they unblock import-path churn
that item 1's regrouping would otherwise redo.

### Track H — Concurrency: per-card write serialization

**What.** In-process write locking for card read-modify-write paths, and a
lock inventory doc.

**Why.** `webapp/trpc/routers/todos.ts:57-88` does read→mutate→write with no
lock; two concurrent updates silently drop one. Scope narrowed per codex
review: `clerk.ts` was misclassified (verified — it creates NEW timestamped
card paths and handles commit races via `commitPaths` +
`isNothingToCommitError`, `clerk.ts:152`), and capture sessions already
hold a per-session promise lock (`capture-session-store.ts:59`). The lock
applies to *same-file read-modify-write* mutations only. The primitive
already exists in-repo (`withSessionLock`'s Map-chain pattern) and
CLAUDE.md already mandates file-lock.ts for the cross-process case.

**Direction.** A `withCardLock(path, fn)` helper (in-process
Map-of-Promises, per file-lock.ts's own in-process/cross-process
distinction) applied to every same-file RMW mutation route — audit tRPC
mutations for that specific shape, not for card-writing generally. Git
commit/staging races (two concurrent `git commit`s racing on
`.git/index.lock`) are a separate audit — clerk's `commitPaths` pattern is
the model there. Bound the capture-session lock map (release tied to
cleanup lifecycle). Add the lock-table doc to `file-lock.ts`'s module
comment: every lock file, its scope, hold duration — so the next lock
added has an ordering convention to consult.

**Traces to:** rules 4, 9; CLAUDE.md's lock mandate.

**First chunk.** `withCardLock` + todos.ts + the RMW-shape audit of the
remaining tRPC mutations.

### Track I — Trusted/untrusted content marking + ref containment

**What.** Branded trust types at the three chokepoints that already exist,
plus closing the one real gap the trust-flow scan found: ref path
containment.

**Why.** No trust distinction exists anywhere in the type system (zero hits
for any brand/Sanitized/Untrusted pattern), so every trust property —
sanitize-before-store, don't-auto-inline-email-bodies, contain-paths-in-box —
is convention-only. And one property is already broken: `ref` resolution has
no containment check. `core/ref-exists.ts:31-39` (the canonical resolver)
does plain string concatenation; `core/reactor/batch-jobs.ts:100-104` does
`path.join(boxRoot, ref)` then `fs.readFile` and inlines the result **into
the reactor agent's prompt**. A card with `ref: "../../../../etc/passwd"`
(hand-edited, or agent-written under adversarial instruction from injected
content) is an arbitrary local file read that feeds attacker-controlled bytes
into agent context. Every schema `ref` is bare `z.string()`. Relatedly:
prompt fencing is a fixed ``` ``` ``` wrapper with no backtick-run handling
(`batch-jobs.ts:93-104`), while `selection-serialize.ts:59-73` shows the team
already solved this exact problem at one boundary and didn't generalize.
Positive exemplar: the clerk capture pipeline
(extract→DOMPurify→Turndown, `extract-readable.ts:1-55`) and the frozen-page
sandbox CSP (`api-files.ts:22-40`) — real trust engineering already exists at
the highest-risk boundary.

**Direction.** (1) `resolveContainedRef(boxRoot, ref, fromPath):
BoxRelativePath | null` — branded return type, `null` on escape, the ONLY
producer. Migration list expanded per codex review (the original four-site
list was under-scoped): `core/ref-exists.ts`, `core/reactor/batch-jobs.ts`,
`core/rewrite-card-refs.ts`, `cli/commands/wakeup-steps.ts:132` (note:
under cli/, not reactor/), `connectors/gmail-drafts.ts:260`,
`core/nav.ts:93`, `webapp/trpc/routers/views.ts:68`,
`core/lint-node-refs.ts:112` — and the real closure is typing the
fs-read wrapper helpers to require `BoxRelativePath`, so the compiler
finds the sites a grep list would miss, rather than trusting any
enumerated list. (2)
`fenceForPrompt(content): PromptSafeText` — picks a fence longer than any
backtick run in the content; used everywhere untrusted text enters a prompt;
extend the existing `escapeText` pattern to the `<typed>`/`<speech>`
wrappers. (3) Schema-level distinction between refs safe to auto-inline and
opaque content refs (the gmail body-file separation is currently safe only
by accident of what `collectRefs` walks — force schema authors to choose:
`cardRef()` vs `opaqueContentRef()`). (4) `SafeHtml` branding is LOW
priority — no raw-HTML render path exists in callback-box today; formalize
in the clerk opportunistically. Scope discipline: brand only these
chokepoints, not every string; a bare `as BoxRelativePath` is already
scrutiny-worthy under the existing `as` convention.

**Traces to:** rules 1, 3, 12; boxholder's explicit trust-marking request.

**First chunk.** `resolveContainedRef` + migrate the four resolution sites —
smallest change, closes the real gap, validates the branded-type ergonomics
before the fencing work.

### Track J — Backend state formalization + hard-module structures

**What.** The backend lifecycle debts, using the `EntryState` pattern —
plain discriminated union + transition function. xstate stays contained to
the frontend (scan verdict: its six machines are healthy; server-side has no
async-actor-coordination problem to justify it). Extended by the hard-code
scan's module-by-module diagnosis.

**Direction.**
1. **Chat-session cluster** (the repo's highest-value hard target: 55
   commits of churn × concurrency × zero orchestration tests):
   `chat-session.ts:69-96`'s `busy`/`intentionalStop`/nullable-`run` cluster
   → `idle | starting | streaming | draining | closing` union with
   invariant-checked transitions; extract the shared run-lifecycle core
   from ChatSession/ChatThreadSession (admitted near-duplicates, drifting);
   then a `docs/chat-session-lifecycle.md` protocol doc for the
   park/drain/evict/queue contract (the frontend has machines + state docs;
   the backend has neither).
2. **Procedure statuses:** the z.enums already exist in
   `schemas/procedure-run.ts:37,47` but degrade to bare `string` in the
   engine (`engine-types.ts:60-67`, `engine-run-card.ts:24-55` — its own
   comment admits it); thread `z.infer` unions through + a transition
   table. A typo'd status currently writes to disk silently. Also extract
   `runAndValidate`'s 5-mutable-`let` retry loop
   (`engine-run-phase.ts:203-285`) into a named retry function. The
   engine's 11-file decomposition itself is good — don't merge it.
3. **Calendar sync:** one pure `SyncDecision` union
   (`remote-wins | local-wins | delete | noop`) computed in one function,
   replacing the conflict policy currently expressed three times inline
   (`google-calendar-sync.ts:156-226`, `-push.ts:120-180`, `-state.ts`);
   plus a conflict-policy protocol doc. This is also the test-seam fix —
   pure decision function, fs stays at thin adapters.
4. **Reactor:** `runOneCycle` (engine.ts:253-317) → named pipeline stages
   with typed results; dispatch returns an explicit processed count
   (current directory-diff count miscounts under concurrent job additions).
   Reactor DI is already the codebase's best — build on it.
5. **Search refresh:** assert the index-before-manifest crash-safety
   ordering (`refresh.ts:141-154`, currently comment-only) + one
   crash-between-writes test validating the self-healing claim.

**Traces to:** rules 1, 9, 10.

**First chunk.** Item 2 (mostly mechanical, cheap); item 1 second (delicate,
wants Track A/B infrastructure and Track P's invariant helper in place
first).

### Track P — Invariants, clock adoption, and orchestration test coverage

**What.** The test-seams half of the hard-code scan: make the existing
seams universal and put tests where the churn is.

**Direction.**
1. **`invariant(cond, msg): asserts cond` helper in `lib/`** — none exists
   (verified zero hits repo-wide) while ≥6 documented invariants are
   enforced by if+log, comments, or clamps that mask violations
   (`engine-run-phase.ts:252`'s review-severity rule; registry refCount's
   `Math.max(0,…)`; search's write ordering). Apply surgically at
   internal should-never-happen sites only; user-facing checks stay error
   results. Behavior (revised per codex review — an `asserts cond`
   function that can return when the condition is false is unsound, it
   lies to the type system): `invariant()` ALWAYS throws, in every
   environment, keeping the `asserts cond` signature. Rule 4's
   prod-degradation case gets a separate, non-asserting
   `checkInvariant(cond, msg): boolean` that logs loudly and lets the
   caller degrade explicitly — the type system never believes a check
   that didn't happen. `testing.md:608`'s "soft assertions" note is a
   testing idea, not a license to weaken `invariant`.
2. **Clock adoption sweep — two clocks, not one** (revised per codex
   review, which caught a real hazard: `cli/lib/time.ts` is *scenario*
   time — `CB_TIME`/stubs frozen — and freezing deadline/liveness timers
   with it causes hangs and non-eviction, e.g. the registry's idle/ref
   timing at `chat-session-registry.ts:324`). The taxonomy: (a)
   **domain/scenario time** — timestamps in cards, schedules, anything a
   test wants deterministic → `getBoxTime`/`getBoxTimeISO`; (b)
   **monotonic/deadline time** — idle sweeps, LRU eviction, busy
   timeouts, retry backoff → stays on real time, made testable by an
   *injected* clock/timer seam (the awake-timeout pattern), never by
   `CB_TIME`. Sweep the 223 direct wall-clock sites by classifying each
   into (a) or (b) — procedure engine and calendar-state are mostly (a);
   the chat-session cluster's 19 reads are mostly (b). The eventual lint
   rule bans bare wall-clock reads outside the two blessed modules
   (preset change — boxholder sign-off, Track F).
3. **DI stance (decided, not a gap):** external services get fakes (the
   existing triad), fs/git/clock stay concrete at thin adapters — the fix
   for untestable logic is extracting pure decision cores (Track J.3/J.4),
   not injecting fs everywhere.
4. **Module-level mutable singletons** (`schema-watcher.ts:28`,
   `chat-turn-buffer.ts:119`, `box-file-watcher.ts:16`, `script-env.ts:45`,
   `command-runner.ts:73`): per-singleton `resetForTest()` or fold into an
   owning class. Per rule 10, test affordances are flag-gated: a
   `resetForTest()` that isn't inert in prod (throws or no-ops unless the
   test flag is set, following the `CB_TIME`/stubs pattern) is surface
   area we don't ship.
5. **Coverage priorities** (the shape is leaf-heavy/orchestration-light —
   inverted relative to risk): cheapest big win is pool/registry/
   thread-session tests using the fake-backend helpers that already exist
   (`test/helpers/chat-session-spawner-helpers.ts`); then reactor
   `runOneCycle` control flow; then the calendar delete-cap/full-resync
   branches. The procedure engine is the exemplar (20-section doctest incl.
   resume/retry/expiry) — the pattern to replicate.

**Traces to:** rules 9, 10, 11.

**First chunk.** Items 1+2's first slice (helper + chat-session cluster
clock sweep), which unblocks item 5's registry tests.

### Track K — Dead code and half-used ideas

**What.** Fix the dead-code tooling, then delete what it and the manual scan
confirmed.

**Why/Direction.**
1. **Fix `knip.json` entries** — commit d22359c9 removed `src/cli/index.ts`
   as an entry on the false belief knip discovers it via the npm script; add
   it and `src/hub/hub-server.ts` (and `src/dev/**`) back. Verified: with
   corrected entries, the 144 false "unused files" collapse to 3 real ones.
   Wire `lint:knip` into a check path (nothing runs it today).
2. **Confirmed deletions:** deps `turndown`, `xml2js`, `@types/*` twins
   (deleted RSS connector), `@modelcontextprotocol/sdk` (deleted polyglot
   activity); `cli/lib/lock.ts` (wakeup mutex, zero callers);
   `core/procedure/dedent.ts`; `loadGoogleSecret`/`saveGoogleSecret`
   (`connectors/google-auth.ts:210-227`, @deprecated with zero callers);
   `webapp/routes/scheduler.ts` (Track L.1 — dead REST twin);
   `driveContentHash` (Track L.3).
3. **Duplicated agent-doctest tests:** `callback-box/test/doctest.test.ts`,
   `check.test.ts`, `serialize.doctest.md` — leftovers of the extraction,
   silently diverged from the canonical copies in `agent-doctest/test/`.
   Delete.
4. **Finish-or-kill decisions:** `core/scheduler.ts:39-46`'s @deprecated
   config functions are still the only thing the live scheduler commands
   call — finish the migration or drop the tag. `CB_DEV_NO_HUB` escape hatch
   (`bin/router.ts:113`) is past its self-declared "one release of
   insurance" — revisit for removal (boxholder call; shared router).
5. **Doc drift:** `docs/stack-decisions.md` cites deleted `sseMachine.ts`;
   `docs/landmarks.md` cites never-built renderer paths; a clerk docstring
   points at a deleted route file. Fix; note that `doc-check` doesn't catch
   prose-embedded stale filenames (possible cb-codehealth check, Track N).
6. The "~277 unused exports" backlog: knip's `exports` check stays excluded
   for schema-registration noise, but a one-time sampling pass on schema
   type exports (~15 flagged, `MemoStatus` spot-confirmed dead) is cheap.

Clean bill: TODO count is 3 total; env vars all traced live; `scenario/`,
`hub/`, `exports/` are real subsystems, not abandoned scaffolding.

**Traces to:** rules 7, 11.

**First chunk.** Item 1 (makes the tool trustworthy), then item 2 in one
commit.

### Track L — Duplication consolidation

**What.** The backend-duplication scan's ranked list plus items queued from
other scans. A meta-observation shapes this track: `content-hash`,
`file-exists`, and `public-url` were each *already consolidated once* (their
docstrings say so) and hand-rolled copies grew back — so this track pairs
each consolidation with an enforcement hook (Track N) where one is feasible.

**Direction (ranked by payoff; frontend items PENDING that scan).**
1. Delete `webapp/routes/scheduler.ts:20-186` — dead REST twin of the tRPC
   scheduler endpoints, zero callers (frontend confirmed tRPC-only), already
   drifted (missing `missingRequirements`). Deregister in
   `server-box-scope.ts:196`.
2. `loadPublicUrl(boxRoot)` consolidating the 4 copy-pasted box.json→env
   blocks (`webapp/routes/admin.ts:16`, `trpc/routers/admin.ts:21,80`,
   `admin-google.ts:44`) — fixes a live bug: all four bypass `getPublicUrl()`
   and thus ignore `CB_PUBLIC_URL`.
3. Point `schemas/registry.ts:390`'s inline hash at `lib/content-hash.ts`;
   delete dead `driveContentHash` (`google-drive.ts:326`).
4. `loadCardFrontmatter` delegates to `readCardFrontmatter` (two
   implementations of frontmatter-or-null, `frontmatter-field.ts:35` vs
   `card-io.ts:184`); add `parseFrontmatterObject` to `cards/` absorbing the
   4 near-identical connector copies (`preserve-agent-fields.ts:52`,
   `gmail-drafts.ts:210`, `chat-utils.ts:334`, `intake-utils.ts:105`).
5. `extensionToMimetype` in `lib/mimetype.ts` (the reverse direction is
   already consolidated there) absorbing 4-5 hand-rolled maps; callers keep
   their own fallback as an explicit arg.
6. `runCollectedChild` helper for the spawn/buffer/close shape
   (`reactor/subprocess.ts:16-73`'s 95%-identical pair, `wakeup.ts:35`,
   `upgrade.ts:131`).
7. `deliverPendingOutputCards` shared by the telegram/push outbound loops
   (~80 near-identical lines each).
8. `findPendingJobCard` + `timestampedJobFilename` shared by chat/intake job
   scanning (`chat-utils.ts:169`, `intake-utils.ts:79`); keep the
   create-vs-append policies separate.
9. Duration parser: telegram's null-returning copy delegates to
   `schemas/scheduled-script-duration.ts` (superset, typed throws),
   catch-and-null at the boundary; also fixes `calendar-utils.ts:340`'s
   silent default-to-days branch (exhaustiveness scan).
10. `fileExists()` swap-ins at the 4 connector sites still hand-rolling it.
11. Queued from other scans: model-ID literals ×3; `DEFAULT_PORT` bypassed
    twice; multipart builder ×3 (transcription); shared `KNOWN_TOOL_NAMES`
    for the tool-dispatch tables (with Track A's Record-dispatch);
    clerk↔server contract (open question 1 — the one candidate for *kept*
    duplication with `box-entry.ts`-style documentation).
12. Frontend duplication (from the frontend scan):
    - **`chat-shared.ts:12-17` hand-mirrors the backend's
      `buildContentBlocks`** ("Mirrors the server-side…" — comment-enforced
      sync of tokenization logic); move to the shared module — the
      shared-code path already exists and works (AppRouter import).
    - Legacy REST layer (`api.ts`/`api-core.ts`/`api-chat.ts` +
      `capture-api.ts`) beside tRPC: inventory, migrate what can be tRPC,
      document the residue (binary/auth endpoints) as deliberately REST.
    - Dual type→UI registries (`renderers/` + `file-types/`, near-identical
      dispatch, card types must register in both, drift is silent) → one
      registration API with two optional facets.
    - Draft-persistence lifecycle duplicated across `useDictationDraft` /
      `useEmissionPersistence` (same debounce constant, flush handler,
      adopt-legacy pattern) → one shared persist controller.
    - SSR's `state-registry-routes.ts` hand-shadows `router.tsx` (6 of 13
      routes, silent degradation) → derive from the route tree or add a
      registry-vs-routes validation test.
13. `app-shell.tsx:50-56` fetches the box list via bare useState/useEffect —
    no caching, and a rejected fetch leaves `loaded:false` forever, silently
    treating the box as existing (also a Track E/N silent-failure item) →
    tRPC query or react-query with an error state.

Explicitly NOT duplication (recorded so nobody "fixes" them): service-vs-
connector google pairs (layered by design), per-connector sync logic,
`cards/lint-format.ts`'s own ANSI codes (package-boundary isolation),
hub/router child-process utils (documented), the frontmatter parsing layer
split, `generate-docs-*` (documented leaf-split for the line cap).

**Traces to:** rules 8, 11.

**First chunk.** Items 1-3 (a deletion and two one-file fixes, one closing a
live bug).

### Track M — code-style.md and docs updates

**What.** Make the style guide match reality and close its gaps.

**Direction.** Add: logging-level policy (Track E), exhaustiveness rule
(Track A — currently lint-enforced switch constraints are documented
nowhere), async error-handling subsection (allSettled-vs-all,
file-lock pointer), the defensiveness policy (Track N), and the lint
suppression policy per rule 11: suppressions are infrequent, signaled,
line-level only, justified in the comment — and a recurring legitimate
exception gets encoded into the rule itself (personal-vibe-check is ours
to extend) instead of accumulating disables. Fix: replace "prefer explicit
types where it aids readability" with the checkable "explicit return types
on exported functions"; delete "use meaningful variable names" (filler);
document the `.ts`/.`tsx` `as`-ban asymmetry decision from Track C. Also:
the one-paragraph module-map doc after Track G lands, so future growth has
a contract to check against.

**Traces to:** rule 11.

### Track N — Defensiveness policy + cb-codehealth skill updates

**What.** Adopt the defensiveness policy (drafted below for boxholder
vetting → code-style.md via Track M), fix the silent-catch cluster the scan
found, and fold the recurring checks into cb-codehealth.

**The scan's verdict on the over-defensiveness complaint: it largely does
not reproduce here.** No redundant type checks on typed values, no invented
else-branch fallbacks, and all ~40 sampled `?? default` sites default
genuinely-optional parsed data (don't let a cleanup pass touch them). What
it found instead is the inverse failure: **silent catches disguised as
resilience** — `frontend/.../InteractiveChat-hooks.ts:129-359` (seven
`.catch(() => {})` on polls: a dead backend means the UI silently freezes),
`InteractiveChat-actions.ts:121` (a user's "restart process" click swallows
failure entirely). These dodge the catch-must-log lint by using arrow form.

**Proposed policy (scanner draft, condensed — boxholder vets, then Track M
lands it):**
1. Untrusted-boundary data (disk/YAML/HTTP/subprocess/LLM) may default,
   narrow, catch-with-fallback freely; prefer `safeParse` where a schema
   exists.
2. A default may only replace a value the type system says can be absent —
   `?? x` on a required field is a type-system lie; fix the type instead.
3. Every non-rethrowing catch logs, or carries a one-line justification
   comment (the existing `/* ignore */`-with-reason convention).
4. UI polling is not exempt — retry-resilience and observability are
   different properties; log even when the poll retries.
5. User-initiated actions never silently no-op: toast/inline error or at
   minimum a logged error.
6. Discriminated-union dispatch: `assertNever`, never an invented default
   (Track A enforces).
7. Process-supervision code keeps the biggest defensive budget, each catch
   commented with the race it absorbs (`bin/router.ts` is the model).
8. Before adding a check, ask what produced the value: same-repo typed code
   → assertion or nothing; disk/network/another process → keep the check.

**cb-codehealth additions** (recurring-pattern checks from this review, so
regressions surface without a 17-agent pass): knip with corrected entries;
`madge --circular`; `as unknown as` count; silent-catch grep including the
arrow form `.catch((\s*(_?\w*)?\s*) => {})`; the exhaustiveness inventory
(switches over unions without assertNever); re-grown-duplicate check for the
already-consolidated helpers (content-hash/file-exists/public-url formulas);
prose-embedded stale file references in docs (Track K.5's gap).

**Traces to:** rules 4, 6, 11.

**First chunk.** Fix the eight frontend silent catches + adopt-or-amend the
policy text.

### Track O — /finish per-merge review step

**What.** A diff-scoped review checklist run by /finish before merge,
targeting the patterns this review shows are *still being written* — not
just old-code residue.

**Why.** Blame-dating the pattern instances (2026-07-05) shows recurrence in
new code: June+July 2026 alone added 7 `as unknown as`, 5 silent
`.catch(() => {})`, 11 `JSON.parse(...) as`, 2 hand-rolled `fs.access`
existence checks. (May counts are ambiguous — the monorepo merge rewrote
blame — but June/July are post-improvement new code.) Separately, three
helpers that were already consolidated once (`content-hash`, `file-exists`,
`public-url`) regrew hand-rolled copies. One-time cleanup without a
recurring check demonstrably doesn't hold here.

**Ordering principle: lint first, review second.** Anything expressible as a
lint rule belongs in Track A/F, not this checklist — a /finish step is for
what lint can't express, and items graduate OFF this list as their lint rule
or helper lands. Diff-scoped only (changed lines, not the whole tree).

**The checklist (initial):**
1. New `as unknown as` or `JSON.parse(...) as` — require the Track C helper
   or a justification comment. *(Graduates when Track C + the `.ts` as-ban
   decision land.)*
2. New silent catch in any form — `.catch(() => {})`, `catch { }`,
   `.catch((_e) => {})` with empty body — must log or carry a reason
   comment. *(Partially graduates with a lint approach from Track E.6.)*
3. New switch/if-chain over a union without `assertNever`. *(Graduates when
   Track A's lint rule lands.)*
4. New helper that duplicates `lib/` — existence checks, hashing, publicUrl,
   mimetype maps, spawn-and-collect, duration parsing. The check is a
   question: "did you grep lib/ and shared/ first?" *(Never fully graduates —
   this is the regrowth pattern lint can't see.)*
5. New `process.env` read outside the env module. *(Activates when Track D.8
   lands.)*
6. New raw Fastify route where tRPC would do (existing CLAUDE.md debt rule,
   now checked at merge rather than remembered).
7. New ref-to-path resolution not via `resolveContainedRef`; new card
   read-modify-write without `withCardLock`. *(Activate when Tracks I/H
   land.)*
8. New interface hand-written parallel to a zod schema instead of `z.infer`.
9. New type with 3+ optional fields whose validity co-varies — prompt:
   should this be a discriminated union?
10. Changed docs: prose-embedded file references still resolve (the gap
    doc-check doesn't cover).

**Traces to:** rules 11, 12; the regrowth evidence above.

**First chunk.** Add the checklist to the /finish skill as a review pass;
tune after a few merges (drop anything that never fires or always
false-positives — a checklist item that's noise is worse than absent,
per the noisy-output-is-a-bug rule).

## Subplans

None yet. Candidates if they grow their own design questions: Track I
(trust-marking type design), the clerk↔server contract decision in Track L.

## Failure modes

Current-state critical gaps the tracks close (listed so the plan's own
changes don't regress them; both verified against source 2026-07-05):

> **Critical gap (current):** concurrent card writes silently drop updates
> (Track H; `todos.ts:57-88` verified — read→mutate→write→commit, zero lock
> imports) — no test, no handling, silent.

> **Critical gap (current):** ref resolution has no path containment
> (Track I; `ref-exists.ts:31-39` and `batch-jobs.ts:100-104` verified) —
> arbitrary file read feeding agent prompts; no test, no handling, silent.

> **Critical gap (current):** corrupt push-subscriptions store is destroyed
> by the next write (Track D.3; verified — warns, then loads as `{}`) —
> warned but not prevented; no test.

Plan-introduced failure modes:

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Track A lint rule surfaces a switch whose "missing" case is deliberate narrowing (e.g. `chat-thread-session.ts`) and the fixer adds a wrong assertNever that throws on live traffic | dry-run pass before `error` | intent decision per switch (open Q2) | clear (throws) |
| Track C `z.infer` types differ from the hand-written interfaces they replace (the diff IS the drift) — a field silently becomes required/optional and callers change behavior | typecheck surfaces each diff | each diff gets an explicit bug-or-intent call in the commit message | clear (compile error) |
| Track I containment breaks a legitimate ref form (attach refs, box-root-absolute `/…` refs) and cards go dark | containment unit tests enumerate all three documented ref forms + escape cases | `null` return → existing broken-ref lint warning path | clear (lint warning) |
| Track I fencing changes prompt bytes → reactor/chat agents behave differently on previously-working cards | doctest the fence function; spot-check a real box prompt before/after | fence only changes delimiter length, not content | silent (behavioral) — mitigate with a before/after prompt diff on test1 |
| Track H `withCardLock` serializes writes that were previously concurrent → latent deadlock if a locked path awaits another locked path | lock helper doctest incl. reentrancy case | Map-chain locks don't block the event loop; document no-nested-locks rule | clear (hang is observable) |
| Track G file moves break non-TS references: doc links, dynamic imports, knip/lint config globs, `.claude/` rules paths | doc-check catches doc links; grep for dynamic import strings per moved cluster | commit-per-cluster so bisection is cheap | mixed — doc-check is clear; dynamic imports need the grep |
| Track D.8 env module import-ordering: a module caches an env-derived value at import time before loadEnv runs | entrypoint-order check per entrypoint | loadEnv as first substantive import (research: verified hazard class) | silent — needs the explicit check |
| Track B wire-protocol union migration desyncs frontend/backend message handling mid-rollout | n/a if deployed atomically (single-deploy — verify against deploy.sh before starting) | sentinel `unknown` variant absorbs skew | clear (sentinel is logged + counted) |
| Track F `no-floating-promises` fallout is large and fixes are rubber-stamped `void` prefixes that re-silence errors | measure fallout on dry run | policy rule 3/4 (every void'd promise needs `.catch` or justification) | the risk IS silent — review the fixes, not just the rule |

## Agent-flow / user-flow edge cases

- **Two agents touching the same card** — ADDRESSED: Track H's exact
  subject; currently a live gap in the running system, not just the plan.
- **Hand-edit drift** (boxholder edits a card into an invalid shape) —
  ADDRESSED by current design (verified: per-card try/catch, bad card
  listed "unknown", scan continues) and *extended* by Track D items 3/4/6
  (the stores where hand-corruption is currently destructive or crashing).
- **Stale ref** — ADDRESSED: Track I's `resolveContainedRef` returns null
  → existing broken-ref lint path; behavior unchanged for missing targets.
- **Wrong tag / wrong field from an agent** — ADDRESSED at parse boundaries
  (cards already fail-closed per schema); Track C closes the post-parse
  cast gap where a wrong-but-parseable shape currently flows through.
- **Fabricated free-form value** — GAP, unchanged by this plan: nothing
  here addresses honesty of agent-authored content; out of scope
  (architecture review, not content policy).
- **Validation error UX** — PARTIAL: Track E's error-context work improves
  log lines; agent-facing validation messages not specifically audited —
  DEFERRED (note in open questions if it bites).
- **Partial migration / transition state** — ADDRESSED per-track: Track B's
  wire union names its transitional state explicitly; Track C is
  compile-error-driven (no silent window); Track G is commit-per-cluster;
  Track D.8 keeps a marked escape hatch. No track expects to stop midway.

## NOT in scope

- **Server-side xstate adoption** — scan verdict: no coordination problem to
  justify it; plain unions suffice (Track J).
- **Retiring xstate** — the frontend fleet is healthy and earning its keep.
- **Full env-var migration in one pass** — Track D.8 migrates secrets +
  networking; the long tail moves opportunistically.
- **Sweeping the 1000+ console.* calls** — policy lands (Track E.5), sites
  migrate as touched.
- **`bin/router.ts` restructuring beyond view-extraction** — load-bearing
  shared infra with incident-hardened concurrency logic; conservative
  handling only, and any change coordinates with the boxholder (shared
  router).
- **The ~277 unused-exports backlog as part of this plan** — Track K decides
  its disposition; executing it is separate work.
- **Frontend data-fetching/state re-architecture** — PENDING the frontend
  scan; presumptively out unless it finds contested patterns.

## Open design questions

1. Clerk↔server contract: shared workspace package (version-skew risk) vs
   generated/checked stub vs documented duplication? (Track L)
2. Is `chat-thread-session.ts`'s SDK-message narrowing intentional? Behavioral
   implication: streaming/user-echo silently absent on the thread path.
   (Track A) — needs boxholder/domain answer.
3. Extend the `as`-ban lint to `.ts` after Track C, or keep guidance-only?
4. Barrels: adopt everywhere (3+ files) or drop the convention? Lean: adopt.
5. ~~Where do the **(new)** preface principles live?~~ — RESOLVED (2026-07-06,
   Track M): the twelve principles landed as `docs/engineering-principles.md`
   (the durable *why*), the mechanical rules stayed in `code-style.md`
   (logging levels, exhaustiveness idiom, defensiveness, suppression, the
   `as`/cast conventions) — the split the lean anticipated. cb-plan's "until
   it lands" pointer was updated to reference the doc.
6. ~~`default:`-rejection strictness~~ — RESOLVED by research: strict
   (`considerDefaultExhaustiveForUnions: false`) with
   `default: assertNever(x)` permitted; wide/shallow unions use
   Record-dispatch instead of long case lists.
7. **Router remediation depth** (boxholder call — shared infra): the
   conservative position (extract the ~570-line embedded doc-browser and
   HTML views only) vs the hard-code sub-analysis position (also: formal
   `WorktreeState` transition function replacing comment-enforced
   invariants, injected clock/spawner, unit tests with fakes — its evidence
   being that 6 of the router's last 20 commits are recurring race fixes to
   the same machinery, i.e. the conservatism is what keeps costing). Either
   way, promote the four incident comments into a short protocol doc.

## Knowledge audits

The plan introduces agent-facing conventions: `assertNever`/exhaustiveness
idiom, the Result convention, `getCardFields`, `withCardLock`, the logging
policy, trust-marking types (Track I). Each gets a `knows_directly` entry in
`knowledge-audits.yaml` when its track lands; drafted per-track at synthesis.
Purely internal moves (Track G reorganization, Track K cleanup) skip with
rationale: discoverability is the fix itself; no recall convention involved.

## Implementation order

Three phases; chunks are commit boundaries, not ship boundaries.

**Phase 1 — safety fixes + enforcement infrastructure** (small, high-damage,
and the things every later track leans on):
1. E.1+E.2: Fastify `setErrorHandler` + the chat-send silent catch (two
   live silent paths, one hook + one line).
2. D.3+D.4: push-subscriptions corruption handling + boxes-config parse
   guard.
3. I first chunk: `resolveContainedRef` + migrate the four resolution
   sites (closes the containment gap; validates branded-type ergonomics).
4. H first chunk: `withCardLock` + todos.ts + clerk.ts.
5. K.1+K.2: fix knip entries; delete the confirmed-dead list (incl. L.1's
   dead REST route) — shrinks everything later tracks touch.
6. A: `assertNever` + `switch-exhaustiveness-check` (dry-run first;
   agent-doctest as pilot package) + P.1's `invariant()` helper.
7. F first slice: `no-floating-promises`/`no-misused-promises` (measure
   fallout; fixes reviewed against policy rules 3-5, not rubber-stamped).

**Phase 2 — type-structure retrofits** (each leans on Phase 1's
enforcement):
8. B: `lib/result.ts` + procedure-engine migration → ChatMessage union
   (with the sentinel `unknown` variant) → AgentResult → EventBus map →
   the literal-union stringly fields.
9. C: `ScheduledScriptFields` z.infer pilot + `getCardFields` → schema
   sweep → CLI args → frontend `as never` consolidation.
10. J: procedure statuses (J.2) → chat-session state union + lifecycle
    extraction + protocol doc (J.1, after B and P.1) → calendar
    `SyncDecision` (J.3) → reactor stages (J.4) → search assertion (J.5).
11. P.2/P.5: clock sweep of chat-session cluster + procedure → registry/
    pool/thread-session tests → reactor control-flow tests.
12. D remaining: uploads allowlist (D.1) → connector inbound schemas (D.2)
    → Gemini zod (D.5) → chat-schedules (D.6) → chat-send zod (D.7) →
    env module (D.8, secrets first).
13. I remaining: `fenceForPrompt` + prompt assembly sites → the
    cardRef/opaqueContentRef schema distinction.

**Phase 3 — wide/mechanical + documentation:**
14. G: layering moves (box-config, cli/lib promotion, ActivityKind) →
    core/ regrouping commit-per-cluster → frontend regrouping →
    consistency point-fixes → barrels decision → alias/lint boundary for
    frontend imports.
15. L remaining: publicUrl, frontmatter helpers, mimetype, spawn helper,
    outbound-delivery, job-scan, duration parsers, frontend items
    (message-block mirror first — it's a live drift risk).
16. M: code-style.md updates + engineering-principles.md (open Q5) +
    module-map doc. N: policy adoption + frontend silent catches +
    cb-codehealth checks. O: /finish checklist.
17. Remaining F items one rule at a time, and the tsconfig raises.

Same-file sequencing: B before J.1 (both touch chat-session); C before D's
schema work; G's core/ regrouping LAST among code changes so nothing else
rebases across the moves.

## Rollout shape

- **Test posture:** each track's first chunk lands with its named test —
  containment unit tests (I), lock-helper doctest incl. reentrancy (H),
  fence doctest + before/after prompt diff on test1 (I), corrupt-store
  doctests (D.3/D.4), registry/pool tests via existing fake helpers (P.5),
  crash-between-writes search test (J.5). Lint-rule tracks (A, F) gate on
  a measured dry run instead of tests. Done-when for the plan overall: all
  tracks' first chunks landed + Phase 1 complete + no NEW instances of
  Track O checklist patterns in the final diff (self-applied).
- **Knowledge audits:** entries land with the tracks that introduce
  agent-facing conventions — `assertNever` idiom (A), Result convention
  (B), `getCardFields` (C), `withCardLock` (H), `resolveContainedRef` +
  fencing (I), logging policy (E.5/M), defensiveness policy (N). Run, not
  just written, per skill discipline. Tracks G/K/L skip with rationale:
  reorganization and deletion change discoverability, not recall
  conventions.
- **Migration:** no on-disk card-shape changes anywhere in this plan (Track
  B's wire union is transport-only; Track C changes types, not data) — no
  cb-migration needed. Verify the deploy coupling assumption (single-deploy
  frontend+backend via deploy.sh) before Track B's wire change; if
  confirmed, the transitional dual-shape state is skipped entirely.
- The plan ships as one unit from this worktree on the boxholder's explicit
  signal; preset/lint changes (A, F) and the router decision (open Q7) each
  need explicit boxholder sign-off before their chunks start.
