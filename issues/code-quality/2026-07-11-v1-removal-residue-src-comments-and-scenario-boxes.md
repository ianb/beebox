---
title: "v1-removal residue: stale legacy-box src comments + flat scenario boxes"
workstream: unknown

area: beebox
---

Fallout from the box-shape v1 removal (`docs/plans/remove-box-shape-v1.md`,
steps 1a–1d). Step 1e (docs + layout-spec cleanup) handled the docs and the
`box-layout-spec.ts`/`box-layout-types.ts` `shapeNotes` field, but two kinds of
residue remain and were deliberately left out of that docs-scoped pass:

## 1. Stale "legacy box" comments over now-constant code (~24 sites, ~18 files)

`getBoxShape` is now strict and always sets `packageRoot = dirname(boxRoot)`, so
`relative(packageRoot, boxRoot)` is always `"content"`, `gitBoxPrefix` is always
`"content/"`, and `boxCodePaths` always points at `packageRoot/src/*`. Many
comments still describe the impossible legacy case (`packageRoot === boxRoot`,
`""` prefix, `boxRoot/views` / `boxRoot/tricks` alternatives, "no-op for a legacy
box"). The comments now mislead; some also sit over code that computes a
now-constant value generically and could be simplified. This is a code +
comment cleanup (needs the full suite to verify the simplifications), not a docs
edit, so it was left for a follow-up rather than reworded piecemeal.

Sites (verified stale-misleading): `core/asset-manifest-scan.ts:87`,
`core/init-rules.ts:66,77`, `core/compile-exposition-rules.ts:75,99`,
`core/install-validation-hooks.ts:120,176,220`, `core/list-cards.ts:86`,
`core/maps/precheck-listing.ts:101`, `core/box/skills.ts:61`,
`core/box/index.ts:37,73`, `core/agent-guide/index.ts:37`,
`core/docs-gen/index.ts:286`, `webapp/trpc/routers/health.ts:144`,
`webapp/routes/views.ts:25`, `webapp/views/compiler.ts:333`,
`cli/commands/trick.ts:6,118`, `lib/git.ts:109`, `hub/child-spawn.ts:82`,
`cli/commands/validate.ts:59`, `dev/lib/box-guard.ts:67`.

Leave as-is (not this cleanup): `core/box/index.ts:94` ("legacy box" = a box
lacking a migrations manifest, unrelated to shape), `cli/commands/view.ts:54`
("(v1)" = the `bbx view test` render-feature version), and
`lib/box-shape.ts:206-234` (`findLegacySchemaFiles` is a still-live stray-file
detector referencing the old location as historical fact).

## 2. Flat scenario boxes break under strict `getBoxShape`

The scenario fixtures `intake-basic`, `tick-basic`, `tick-chain` under
`~/src/boxes/scenarios/` are still flat, pre-v2 boxes (`.bbx-box` has no
`shapeVersion`, or is `{}`; no `content/` nesting). Step 1a converted the in-repo
test fixtures but not these external scenario dirs. Under strict `getBoxShape` a
marker without `shapeVersion >= 2` is a hard `BoxShapeError`, so any command that
resolves the shape on these scenarios now throws. They need converting to the v2
(`content/`-nested, `shapeVersion: 2`) layout. `docs/testing.md` was updated to
say they need conversion rather than describing them as a supported second shape.
