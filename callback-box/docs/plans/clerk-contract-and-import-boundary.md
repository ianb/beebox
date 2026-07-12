# Clerk↔Server Contract + Frontend Import Boundary

Resolves the last two build-item entries of the architectural review's open
decisions (`issues/decisions/2026-07-06-architectural-review-open-decisions.md`
items 2 and 5). Scoped 2026-07-12; both scoping reports' findings are folded
in below.

> **STATUS: IN IMPLEMENTATION (2026-07-12).**

## Track 1 — Clerk contract: generated-and-CI-checked

Ground truth (scoping): the entire contract is **two tRPC procedures**
(`clerk.commentaryDestinations`, `clerk.commentary` —
`callback-box/src/webapp/trpc/routers/clerk.ts:41-103`), consumed by
hand-built fetch in `callback-clerk/src/platform/clerk-api.ts:52-78` with
hand-declared shapes in `callback-clerk/src/domain/commentary.ts:30-47`.
Zero live drift (verified field-for-field). Every historical wire change
landed client+server in one commit; the skew risk is forward-looking. No CI
exists beyond the root pre-commit dispatcher, which currently does NOT run
clerk checks on a callback-box-only change — that's the enforcement gap.

Design (boxholder-approved direction: generated + CI-checked stub):

1. **Output schemas on the router.** Add zod `.output()` schemas to both
   procedures in `clerk.ts` (strict bias: output shapes become
   validated-at-runtime and snapshotable the same way inputs are, instead
   of inferred-only). Shapes exactly as today — `{ destinations:
   {dir,label,symbol}[] }` and `{ created: string[], open: string }`.
2. **Generator:** `bin/snapshot-clerk-contract.ts` imports ONLY the clerk
   router module's schemas (not AppRouter — avoids the transitive
   node-builtin type graph) and emits a checked-in, deterministic,
   generated TypeScript contract file
   `callback-clerk/src/contract/clerk-contract.generated.ts`: procedure
   names, query/mutation kind, input/output types (derived from the zod
   schemas via z.infer-shaped type printing or zod-to-ts-style emission —
   implementer picks the simplest reliable mechanism; a hand-rolled
   printer is acceptable for two procedures, but it must fail loudly on a
   zod construct it doesn't understand, never emit a wrong type). File
   carries a DO-NOT-EDIT header naming the generator.
3. **Clerk adopts the generated types:** `clerk-api.ts` and
   `commentary.ts`'s hand-declared `CommentaryPayload`/
   `CommentaryDestination` shapes convert to importing from the generated
   file (deleting the duplicates). Also fix the stale doc-drift: comments
   in `commentary.ts:2-4,73` point at the deleted raw-route file
   `webapp/routes/clerk.ts` — repoint to the tRPC router.
4. **Staleness gate:** a pre-commit branch in the root dispatcher
   (`.husky/` — follow the existing doc-check/path-leak-check idiom): when
   staged changes touch `callback-box/src/webapp/trpc/routers/clerk.ts`
   (or the generator, or the generated file), regenerate and
   `git diff --exit-code` the generated file — a mismatch blocks the
   commit with a message naming the regeneration command. Add a pnpm
   script for manual regeneration.
5. **Residual-skew handling (the gap no static check covers):** a deployed
   extension can lag/lead the live server. `clerk-api.ts` gets minimal
   runtime shape validation of responses (the existing local
   `domain/is-record.ts` level, not a zod dep unless clerk already has
   one) that turns an unexpected-shape response into a clear
   `ClerkApiError` telling the user to update/reload the extension —
   never a silent `undefined` ride (the scouted failure mode:
   `commentaryOpenUrl(boxUrl, undefined)` building `${boxUrl}/undefined`).
   Record in the issue close-out that this residual case is accepted and
   handled by degradation, not prevented.

Out of scope, recorded: no store-release versioning gate (clerk has no
release cadence today); no generalization beyond the clerk router until a
second consumer exists.

## Track 2 — Frontend import boundary: rule + type-only aliases + value fixes

Ground truth (scoping): 34 escaping imports across 27 files — 24 type-only
(runtime-erased, harmless), 10 value imports that genuinely bundle backend
source into the Vite client build (no `node:*` leakage TODAY, but no gate
prevents it — the live landmine). `@backend/*`→`src/webapp/*` and
`@shared/*`→`src/shared/*` are the only aliases; `@backend` is deliberately
tsconfig-only (no Vite entry) so it cannot carry value imports — a
load-bearing property to preserve. `src/frontend/src/ssr/render.tsx` is
quasi-backend (the `cb render` tsx entry, not part of the Vite build) and
gets exempted, not fixed. ESLint here has NO ts-aware import resolver
(known-broken `eslint-import-resolver-typescript`) — enforcement must work
on raw/node-resolvable paths; verify empirically.

Design decisions (aligned with the no-barrels ruling — no re-export
indirection where a direct path exists):

1. **Type-only aliases `@core/*` and `@schemas/*`** added to
   `src/frontend/tsconfig.json` paths ONLY — deliberately NOT to
   `vite.config.ts` `resolve.alias`, mirroring `@backend`: the alias
   physically cannot resolve at runtime, so a future value import through
   it fails the build instead of silently bundling backend code. Comment
   both configs with this contract. The 24 type-only sites (+ any the
   census missed) convert to `import type ... from "@core/..."` /
   `"@schemas/..."`. (Chosen over webapp `export type` re-exports: those
   are mini-barrels — indirection with an editorial layer nobody asked
   for. The existing events.ts re-export may stay or convert, implementer
   judgment.)
2. **Value imports (10 lines / 9 backend modules), per-site disposition:**
   - Already-`shared/` targets imported via raw paths (`boxRelativePath`
     ×2, `cardTypeFromName`, `buildChatContentBlocks`): rewrite to
     `@shared/...` — pure compliance fixes.
   - Pure, both-sides modules currently in backend-only homes:
     `core/model-ids.ts` (MODEL_ID), `core/parse-attrs.ts` (parseAttrs),
     backend `lib/filename.ts` (sanitizeFilename) → RELOCATE to
     `src/shared/` (git mv + backend import updates), which is exactly
     what `shared/` is for. Consult `docs/module-map.md` and keep it
     truthful (update it if the move shifts a documented boundary).
   - Backend-flavored values (`stripChatAppTags` in core/chat/features,
     `entrySelfNotes`/`decodeXmlAttr` in core/self-note, `VOICE_MODELS` in
     schemas/personality): implementer judgment per site — extract the
     pure piece to `shared/` if it separates cleanly; otherwise the
     frontend needs its own honest implementation or the feature's parsing
     belongs server-side. NO value re-exports through webapp (that bundles
     it anyway and adds indirection). Every disposition documented in the
     commit.
3. **The rule:** `import-x/no-restricted-paths` (plugin already loaded by
   the preset) in `src/frontend/eslint.config.mjs` — project-local
   addition, NOT a preset change (the preset header only gates weakening;
   flag possible future preset promotion in the issue close-out). Zones:
   target `src/frontend/src`, from all backend roots (`core`, `webapp`,
   `schemas`, `services`, `lib`, `cards`, `scenario`, `shared`), except
   the sanctioned alias paths; exempt `src/frontend/src/ssr/**`.
   MUST be verified empirically both ways: the raw `../../../core` form
   fails at every existing depth (2- to 4-deep), and `@core`/`@shared`
   alias imports plus ordinary intra-frontend `../lib/...` imports do NOT
   false-positive (the frontend has its own `lib/`; only resolved-path
   zones disambiguate it from backend `lib/` — if the broken resolver
   makes `no-restricted-paths` unable to do this reliably, fall back to
   `no-restricted-imports` with patterns, special-casing the `lib/` depth
   exactly, and say so).
4. **Follow-up filed, not bundled:** consolidating the frontend's local
   helper copies (`invariant.ts`, `error-guards.ts`, `is-record.ts`) into
   `shared/` now that a sanctioned path exists — file as an issue
   (`is-record` as the trivial pilot; the other two carry deliberate
   "frontend counterpart" framing to re-check before merging).

## Execution

Two parallel agents (disjoint territories):
- **W-clerk** (Track 1): callback-box/src/webapp/trpc/routers/clerk.ts,
  bin/snapshot-clerk-contract.ts, .husky/ dispatcher, callback-clerk/.
  Tests: the generator is deterministic (run twice, identical output); the
  staleness gate trips on an intentional schema change (verify then
  revert); clerk's suite + typecheck; trpc-clerk doctest still green
  (output schemas must not reject current responses).
- **W-boundary** (Track 2): src/frontend/, src/shared/, the relocated
  core/lib modules and their backend importers, frontend eslint config.
  Tests: full typecheck both configs; frontend suite; backend doctests
  covering relocated modules; the rule verified empirically (violation
  fails, alias passes) and the final tree lint-clean with zero disables
  for this rule.

Both: codex review foreground before final commit (adversarial: generator
emitting a subtly-wrong type; output schemas stricter than real responses;
relocations changing backend import graphs; the lint zones over- or
under-matching). Stage-own-files + plain `git commit` (no pathspec).
Close-out: items 2 and 5 marked decided+done in the open-decisions issue
(with the residual-skew acceptance and the preset-promotion question
recorded); helper-consolidation follow-up filed; this plan retired by the
finish flow.
