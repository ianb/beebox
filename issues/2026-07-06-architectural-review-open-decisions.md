# Architectural review — open boxholder decisions

Parked judgment calls from the architectural review
(`docs/implemented-plans/architectural-review.md`). All are safe in their current
landed state — surfaced here into the active issue queue because the plan
doc moves to `docs/implemented-plans/` on merge, where open questions get
buried. None blocks the merge.

1. **Router refactor depth.** `bin/router.ts` recurring race bugs (6 of its
   last 20 commits were concurrency fixes to the same comment-guarded
   machinery). **Phased (boxholder decision, 2026-07-09): the conservative
   phase is DONE** — commit `16ad6d11` (followups Track 8) extracted the
   doc-browser + HTML views into `bin/router-docs.ts` (router.ts 2019 → 1409
   lines) and promoted the four incident comments into
   `bin/docs/router-protocol.md` (pointer comments kept at each code site).
   **Still OPEN — the fuller option** (the hard-code scan's case): a formal
   `WorktreeState` transition function, injected clock/spawner, unit tests
   with fakes. The boxholder explicitly wants to keep going with the router
   work in later phases. Shared dev infra — coordinate with the boxholder.

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

6. **Barrels.** Plan leaned "adopt for dirs with 3+ files"; P3-d deferred,
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
