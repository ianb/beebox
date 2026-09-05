---
title: "Clerk↔Server Contract + Frontend Import Boundary"
status: implemented
workstream: unknown
issues: []
---
# Clerk↔Server Contract + Frontend Import Boundary

Resolves the last two build-item entries of the architectural review's open
decisions (`issues/closed/decisions/2026-07-06-architectural-review-open-decisions.md`
items 2 and 5). Scoped 2026-07-12; codex plan review 2026-07-12 (11 valid
findings, all folded in — the design below is post-review).

## Track 1 — Clerk contract: generated-and-CI-checked

Ground truth: the entire contract is **two tRPC procedures**
(`clerk.commentaryDestinations`, `clerk.commentary` —
`beebox/src/webapp/trpc/routers/clerk.ts:41-103`), consumed by
hand-built fetch in `beebox-clerk/src/platform/clerk-api.ts:52-78` with
hand-declared shapes in `beebox-clerk/src/domain/commentary.ts:30-47`.
Zero live drift today. The enforcement gap: the pre-commit dispatcher runs
checks per-subtree, so a beebox-only change never exercises clerk.

1. **Leaf contract-schema module** (codex 1): the zod schemas move to a new
   `beebox/src/webapp/trpc/routers/clerk-contract.ts` that is
   SELF-CONTAINED — imports zod and nothing else (no fs/git/landmark
   graph). It exports `commentaryInput`, `commentaryOutput`,
   `commentaryDestinationsOutput` (new — `{ destinations: { dir: string;
   label: string; symbol: string | null }[] }`, matching `DestinationInfo`
   exactly including the `| null`). `clerk.ts` imports the leaf and wires
   `.input()`/`.output()`. Self-containment is load-bearing: it makes the
   leaf the single file whose content determines the wire shape, which is
   what the staleness gate triggers on.
2. **`.output()` semantics pinned** (codex 3): default zod object behavior
   (strip unknown keys) — the schema is authoritative; adding a response
   field REQUIRES updating the leaf schema or the field never ships. Add
   a `commentaryDestinations` case to `trpc-clerk.doctest.md` (currently
   only `commentary` is covered) proving current responses pass the new
   output schemas.
3. **Generator** `bin/snapshot-clerk-contract.ts` (codex 2): imports ONLY
   the leaf module. Emission mechanism pinned: `z.toJSONSchema` (zod v4
   built-in) → a tiny JSON-Schema→TS printer supporting exactly the
   construct whitelist the leaf uses (object, string, array, optional,
   nullable, literal/enum if added later) and THROWING on anything else
   (so a future schema using an unsupported construct fails generation
   loudly, never emits a wrong type). Input types from the input schema's
   input side; output types from output schemas. Deterministic output
   (stable key order); emits
   `beebox-clerk/src/contract/clerk-contract.generated.ts` with a
   DO-NOT-EDIT header naming the generator and the pnpm script.
   Generated-file hand-edits: never (codex 11).
4. **Clerk adopts the generated types**: `CommentaryPayload` /
   `CommentaryDestination` duplicates in `commentary.ts` are deleted in
   favor of generated imports. Pinned (codex 11): `timestamp` follows the
   generated (optional) type — clerk continues to always send it, but its
   type no longer over-constrains. Fix the stale doc-drift
   (`commentary.ts:2-4,73` points at the deleted raw-route file).
5. **Staleness gate** (codex 4): pre-commit dispatcher branch fires when
   staged changes touch the LEAF module, the generator, the generated
   file, or the hook branch itself; regenerates and diffs — scoped to the
   generated path only (`git diff --exit-code --
   beebox-clerk/src/contract/clerk-contract.generated.ts`), never a
   bare diff (shared-checkout noise). Recorded, accepted misses: zod
   version bumps and TS-version changes can alter emission — the
   deterministic-generator test (run twice, byte-identical) plus the
   whitelist-throw are the mitigation; a full re-generate happens whenever
   anyone touches the contract anyway.
6. **Residual-skew handling** (codex 9, spec pinned): `trpcQuery`/
   `trpcMutation` currently do an unchecked `res.json()` cast. They gain
   envelope validation (JSON parse guarded; `result.data` present via the
   local `is-record` guard) and each call site validates the
   procedure-specific minimal shape (destinations: array of records with
   string `dir`; commentary: string[] `created` + string `open`) —
   hand-written against the generated types, commented as the runtime
   twin of the snapshot. Failure → `ClerkApiError` with a
   reload/update-the-extension message; never a silent `undefined` ride.
   Recorded in the close-out: deployed-skew is accepted and handled by
   degradation, not prevented.

Out of scope, recorded: no store-release versioning gate; no
generalization beyond the clerk router until a second consumer exists.

## Track 2 — Frontend import boundary: rule + type-only aliases + value fixes

Ground truth: ~34 escaping imports across 27 files — ~24 type-only
(erased, harmless), ~10 value imports genuinely bundling backend source
into the Vite client build (counts approximate; the implementer
re-enumerates as step one — codex 8). No `node:*` leakage today, but no
gate prevents it. `@backend/*`→`src/webapp/*` (tsconfig-only, no Vite
entry — cannot carry value imports; preserve this property) and
`@shared/*`→`src/shared/*` (tsconfig + Vite) are the only aliases.
`src/frontend/src/ssr/**` is quasi-backend (the `bbx render` tsx entry) —
exempt, not fixed. ESLint here has NO working ts-aware import resolver.

1. **Type-only aliases `@core/*`, `@schemas/*`** in
   `src/frontend/tsconfig.json` paths ONLY — deliberately absent from
   `vite.config.ts` (mirrors `@backend`; a value import through them
   breaks the client build instead of silently bundling). Both configs
   commented with the contract. Convert the type-only sites. Verified
   caveat (codex 6): tsx-based paths (`bbx render`, any tsx-run tests) may
   honor tsconfig paths and execute a value import the Vite build would
   reject — the implementer empirically checks what `tsx` does with a
   deliberate value-import probe through `@core` and documents the result
   in the config comment; the lint rule (below) is the guard that doesn't
   depend on build behavior.
2. **Value imports, dispositions PINNED** (codex 7 — verified per module):
   - `boxRelativePath` ×2, `cardTypeFromName` (one raw site; one already
     compliant), `buildChatContentBlocks`: rewrite to `@shared/...`.
   - `core/model-ids.ts` (zero imports) and `lib/filename.ts`
     (self-declared dependency-free): `git mv` to `src/shared/`, update
     backend importers.
   - `core/parse-attrs.ts`: move to `src/shared/` KEEPING its
     `lib/invariant.js` import — module-map allows `shared/` importing
     bundler-safe `lib/` modules and `invariant.ts` is one; verify
     against `docs/module-map.md` and update that doc if it's silent on
     shared→lib.
   - `VOICE_MODELS`/`VoiceModel`: currently imported from the HEAVY
     `schemas/personality.tsx`, dragging the whole personality
     schema/compile graph into the client bundle today (the worst live
     offender). The value actually lives in the near-leaf
     `schemas/personality-fields.ts`. Fix: relocate the
     `VOICE_MODELS`/`VoiceModel` definitions to
     `src/shared/voice-models.ts`; `personality-fields.ts` re-imports
     from there; frontend imports `@shared/voice-models`.
   - `stripChatAppTags`: `core/chat/features.ts` is zero-import but owns
     more than this function — extract `stripChatAppTags` (and whatever
     `parseSelfNotes` needs) to `src/shared/chat-tags.ts`; `features.ts`
     imports it back.
   - `core/self-note.ts` (`entrySelfNotes`, `decodeXmlAttr`): after the
     chat-tags extraction its only deps are shared/chat-tags +
     lib/invariant — relocate the whole module to
     `src/shared/self-note.ts`.
   Every move updates backend importers and runs their doctests.
3. **The rule** (codex 5 — mechanism decision reversed by the review):
   `import-x/no-restricted-paths` resolves import paths and SILENTLY
   SKIPS unresolvable ones — with this repo's broken ts resolver, alias
   imports would pass by accident, not by design, and would silently
   flip to violations if the resolver is ever fixed. So the PRIMARY
   mechanism is plain **`no-restricted-imports` with patterns** in
   `src/frontend/eslint.config.mjs` (project-local; the preset only gates
   weakening — record the possible future preset promotion in the
   close-out): patterns banning the raw relative spellings at every
   real depth (`../../core/*` through `../../../../core/*`, same for
   `webapp`, `schemas`, `services`, `shared`, `cards`, `scenario`, and
   the specific `../../../../lib/*` depth — the frontend's own `lib/` is
   shallower, so the exact-depth pattern cannot false-positive; verify).
   Spelling-based is also honest about intent: the raw spellings are
   banned, the alias spellings are legal. Exempt `src/ssr/**` via the
   flat-config files/ignores mechanics. Verify empirically both ways:
   every existing raw depth fails; alias + intra-frontend relative
   imports pass; final tree lint-clean with zero disables for this rule.
4. **Follow-up filed, not bundled:** consolidating the frontend's local
   helper copies (`invariant.ts`, `error-guards.ts`, `is-record.ts`) into
   `shared/` now that the pattern exists (`is-record` as pilot; the other
   two carry deliberate "frontend counterpart" framing to re-check).

## Execution

Two parallel agents; **shared-file ownership pinned** (codex 10): neither
agent touches the open-decisions issue or this plan's status — the
orchestrator does both after both agents land.

- **W-clerk** (Track 1): clerk router + new leaf module, generator in
  bin/, .husky/ dispatcher branch, beebox-clerk/. Tests: generator
  determinism (twice, byte-identical); staleness gate trips on an
  intentional leaf-schema change (verify, revert); output schemas pass
  current responses (doctest incl. the new destinations case); clerk
  suite + typecheck; envelope-validation unit coverage.
- **W-boundary** (Track 2): src/frontend/ configs + sites, src/shared/
  additions, the relocated modules and their backend importers,
  docs/module-map.md if touched. Tests: both typechecks; frontend suite;
  backend doctests covering every relocated module's importers; the rule
  verified empirically per §3; the tsx-probe result documented.

Both: codex review foreground before final commit (adversarial: generator
emitting a subtly-wrong type; output schemas rejecting real responses;
relocations breaking backend import graphs; lint patterns over/under
matching). Stage-own-files + plain `git commit` (no pathspec —
lint-staged hazard). Close-out (orchestrator): items 2 and 5 decided+done
with the residual-skew acceptance, the resolver-accident note, and the
preset-promotion question recorded; helper-consolidation follow-up filed;
plan retired by the finish flow.
