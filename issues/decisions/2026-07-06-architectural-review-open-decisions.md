---
title: "Architectural review — open boxholder decisions"
---

Parked judgment calls from the architectural review
(`docs/implemented-plans/architectural-review.md`). All are safe in their current
landed state — surfaced here into the active issue queue because the plan
doc moves to `docs/implemented-plans/` on merge, where open questions get
buried. None blocks the merge.

1. **Router refactor depth. DONE (phase 2 complete, 2026-07-11).** Phase 1
   (conservative, boxholder decision 2026-07-09): commit `16ad6d11` extracted
   the doc-browser + HTML views into `bin/router-docs.ts` and promoted the four
   incident comments into `bin/docs/router-protocol.md`. Phase 2 (the fuller
   option — formal lifecycle, injected effects, incident tests) then landed on
   `worktree-architectural-review`:
   - **Phase A** (`4b0659a5`): `bin/router-lifecycle.ts` (stable-shell handle,
     phase union, `LEGAL_TRANSITIONS` + guarded `transitionLifecycle`) +
     `bin/router-pidfile.ts` (per-name serialized store), adopted in `router.ts`;
     landed live-race fixes invariants #5 (guarded publication) and #6 (pidfile
     serialization) the four-invariant framing missed.
   - **Phase B** (`c16db52a`): split the lifecycle engine into
     `bin/router-core.ts` — `createRouterCore(effects, config)` owns the
     worktrees map and drives transitions through an injected `RouterEffects`
     surface; `router.ts` builds the real effects, wires the HTTP/WS server, and
     runs boot + signal handlers in an import-safe `main()` (importing binds no
     ports, installs no handlers). Tab-title refresh is now a `config.onStateChange`
     hook, not module-level monkey-patching.
   - **Phase C** (`2660c732`, hardened `f18dd6f2`): incident tests
     (`bin/router-core.test.ts` for invariants #2–#6 with a manual clock /
     controllable spawner / recording killGroup / manual probes; and
     `bin/router-lifecycle.test.ts` for the transition table), each proven
     non-vacuous by neutering the guard it covers.

   **Recorded non-goals / deliberate deferrals:** (a) stopping-phase status
   accuracy (handles unlinked before the transition — never observed on the map);
   (b) proxy-retry body-replay formalization (stays a request-level concern);
   (c) two honesty findings surfaced by the neutering (and confirmed by codex):
   invariant #4's stale-exit safety is doubly enforced (identity + phase) so the
   test guards the historical name-based-teardown regression, and invariant #5's
   failure-path clobber-prevention is now structural (transition-not-set), the
   guard's unique job being `stopping`-vs-`failed` routing; (d) the filed
   name-scoped dashboard-socket hazard
   ([bugs/2026-07-11-router-superseded-selfclean-kills-replacement-dashboard.md](../bugs/2026-07-11-router-superseded-selfclean-kills-replacement-dashboard.md)).
   Design record: `callback-box/docs/implemented-plans/router-state-formalization.md`.

2. **Clerk↔server contract.** The extension talks to the box via hand-built
   tRPC URLs + a hand-duplicated payload shape (no shared typed contract,
   unlike the in-repo frontend's `AppRouter` import). Options: shared
   workspace package (version-skew risk, since clerk deploys independently)
   / generated-and-CI-checked stub / documented intentional duplication
   (`bin/box-entry.ts` is the model). Decide the tradeoff explicitly.

3. **Thread-session SDK-message narrowing.** `chat-thread-session.ts`'s
   `adaptSdkMessage` deliberately narrows out `user`/`stream_event` — now
   made *visible* (explicit cases + a pointing comment) rather than
   accidental. If the narrowing is wrong, streaming/user-echo are silently
   absent on the thread path. Needs a domain answer.

4. **Markdoc walkers.** **Decided + done (boxholder decision, 2026-07-10):
   both properties, not a tradeoff** — commit `21e11b39` (`emit-nodes.ts`
   rewrite). `src/lib/invariant.ts` gained `tolerateNever(x: never, context)`,
   a non-throwing sibling to `assertNever`: compile time it demands a switch
   (or, here, a `satisfies Record<Union, Handler>`) handle every member of a
   *vendor* union (one we don't control, that can grow under a dependency
   bump); at runtime it `console.warn`s with context and returns instead of
   throwing, so a best-effort walker degrades instead of crashing. Use
   `assertNever` for our own closed unions (an unhandled member is our bug —
   fail loudly); use `tolerateNever` only for vendor unions where a crash on
   drift would be worse than a degraded result.

   `emit-nodes.ts`'s three former switches (all deliberately-partial, each
   behind a justified `switch-exhaustiveness-check` disable) are now one
   `Record<NodeType, NodeHandler>` dispatch table enumerating all 28 members
   of Markdoc's `NodeType` union, `satisfies`-checked so a new member fails
   the build. This is the `Record`-with-`satisfies` idiom from
   code-style.md's Exhaustiveness section, not literal `switch` statements:
   a 28-case `switch` in one function blows the `complexity` lint budget
   (25) regardless of how the cases are grouped — ESLint's `complexity` rule
   counts every `case` label, fallthrough or not — while the object literal
   carries none of that branching cost. Handlers that share behavior
   (`table`/`thead`/`tbody`/`tr`/`th`/`td`, `comment`, `error`, the generic
   `node` type) point at one shared `degrade` function (emit children, no
   wrapping), each with a comment naming what's lost (no grid/separators for
   tables, silent no-op for parse errors and comments). The dispatch is
   exhaustive at compile time via `satisfies`; `emitNode` still falls back to
   `tolerateNever` + `degrade` at runtime for the belt-and-suspenders case
   where a real AST node's `.type` disagrees with the declared union (a
   vendor-boundary value TS can't runtime-verify). Behavior is unchanged for
   every currently-used node type; new doctest coverage
   (`test/core/markdoc/emit-nodes.doctest.md`) exercises the table and
   parse-error degradation paths explicitly. **This pattern (enumerate the
   vendor union via `satisfies Record` + `tolerateNever` default) is now the
   house answer for vendor-union walkers** — reach for it before a partial
   switch + suppressed exhaustiveness lint.

5. **Frontend import boundary.** ~28 raw `../../../core/...` imports bypass
   the `@backend`/`@shared` alias contract. Options: add `@core`/`@schemas`
   aliases (build-config churn across tsconfig+vite+eslint-resolver; doesn't
   *enforce*) or a frontend-local `no-restricted-imports` rule (a preset
   change needing sign-off; actually enforces). P3-d deferred this.

6. **Barrels. Decided (boxholder, 2026-07-12): NO barrels — codified in
   `callback-box/code-style.md` ("it's just indirection").**
   Original framing: Plan leaned "adopt for dirs with 3+ files"; P3-d deferred,
   judging the discoverability win already delivered by the directory
   grouping and not worth the export-visibility/cycle risk a barrel adds.
   Reversibly addable later. Decide: add barrels, or codify "no barrels."

7. **`.ts` `as`-ban. Decided + done (boxholder decision, 2026-07-10): extend
   the ban to `.ts` and close the `as never` loophole.** The
   `no-restricted-syntax` `as` selector in `personal-vibe-check/eslint.config.mjs`
   now applies to both `.ts` and `.tsx` across every preset consumer (backend +
   frontend), enforced in both react modes via a shared `AS_BAN_SELECTORS`
   constant. Findings that reshaped the change: the `.tsx` ban was in fact only
   live for `react:false` (backend `.tsx`) — the frontend (`react:true`) `.tsx`
   had no `as` ban at all, and `as never` was already caught by the selector
   wherever the ban ran; it "evaded" only by living in `.ts`/frontend files the
   ban didn't cover, not by any selector gap. The XState v5
   `setup({ types: { … as Ctx } })` idiom (14 machine sites) is now rule-exempted
   by a narrow AST `:not(...)` clause so it stays legal without a disable, while a
   bare `{} as Ctx` elsewhere still fails. Burn-down on landing: ~75 previously
   invisible casts resolved (14 backend `.ts` + 61 frontend) — most via real
   fixes or blessed helpers (`errorMessage`/`toError`, `isRecord`, `busEventData`,
   zod `.unwrap()`, an `in`-narrow, a `z.enum` at a parse boundary), the residue
   as single-line justified disables; `code-style.md`'s `as`-assertions section
   rewritten accordingly (the ".ts/.tsx asymmetry" paragraph is now false and
   gone). Also consolidated the duplicate `core/card-io.ts` `isRecord` onto
   `lib/is-record.ts`. Landed on `worktree-architectural-review` in commit
   `defbd2c7` (ban + burn-down), hardened by `7077e5ef` (codex review tightened
   the XState exemption to empty-object casts only).

Behavior-sensitive deferrals from Track G (recorded, not decisions —
"do when touched"): DebugLog `useSyncExternalStore` port, FileView /
AgentViewRenderer 300-line splits, a `components/chat/interactive/` subdir.
