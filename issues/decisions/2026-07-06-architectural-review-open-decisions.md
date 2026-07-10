---
title: "Architectural review — open boxholder decisions"
---

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

4. **Markdoc walkers.** Three switches over Markdoc's 28-member vendor
   `NodeType` union are deliberately partial with graceful-degradation
   defaults (kept via justified single-line disables). Enumerate the vendor
   types for compile-time drift detection, or keep graceful degradation? A
   renderer must never crash on a new node type either way.

5. **Frontend import boundary.** ~28 raw `../../../core/...` imports bypass
   the `@backend`/`@shared` alias contract. Options: add `@core`/`@schemas`
   aliases (build-config churn across tsconfig+vite+eslint-resolver; doesn't
   *enforce*) or a frontend-local `no-restricted-imports` rule (a preset
   change needing sign-off; actually enforces). P3-d deferred this.

6. **Barrels.** Plan leaned "adopt for dirs with 3+ files"; P3-d deferred,
   judging the discoverability win already delivered by the directory
   grouping and not worth the export-visibility/cycle risk a barrel adds.
   Reversibly addable later. Decide: add barrels, or codify "no barrels."

7. **`.ts` `as`-ban.** Extend the `.tsx`-only `as` lint ban to `.ts` now
   that Track C removed the two dominant unsafe-cast shapes (`card.fields`
   and CLI args), or keep it guidance-only in `.ts`? Note `as never` (used
   in the frontend navigate consolidation) evades the current rule.

Behavior-sensitive deferrals from Track G (recorded, not decisions —
"do when touched"): DebugLog `useSyncExternalStore` port, FileView /
AgentViewRenderer 300-line splits, a `components/chat/interactive/` subdir.
