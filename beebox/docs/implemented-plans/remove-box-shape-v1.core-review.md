---
title: "1a+1b core review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)"
status: implemented
workstream: unknown
issues: []
---
# 1a+1b core review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)

Breakpoint review of the v1-removal core (steps 1a fixtures→v2, 1b strict
predicate) before building 1c/1d. Codex confirmed the linchpin is correct and
found three contained edge-caller issues, all fixed in a follow-up commit.

## Verdict on the core (verbatim highlights)

> The strict discriminator itself is correct: box-shape.ts:115 returns
> found:false only for marker-read ENOENT. Malformed JSON, marker EACCES, and
> other IO errors propagate. Parent package.json errors are wrapped as
> BoxShapeError, so they cannot be mistaken for a missing marker. box-guard and
> rebuildBoxSchemas handle legitimately marker-less paths correctly.
>
> I found no provisioning-order regression for real v2 boxes: fresh bbx init
> scaffolds the package before writing/reading the marker; re-init uses an
> existing marker; and bbx migrate --apply provisions a v2 box successfully
> before running migrations.
>
> The box-packageify tombstone is structurally sound: its stable registry name
> remains, pending calculation still sees it, --mark-applied box-packageify
> remains valid, a valid v2 box exits zero, and missing/pre-v2/malformed boxes
> exit nonzero.

## Findings + disposition

1. **High — `bbx serve` marker-less fallback crashed.** `defaultSlugFor`
   (serve.ts) called `getBoxShape` unconditionally, so a documented
   plain-directory invocation threw ENOENT instead of producing a basename slug.
   → FIXED: `defaultSlugFor` uses `getBoxShapeIfPresent` and falls back to
   `basename(boxRoot)` when no marker is present.

2. **High — csp-digest/csp-report read logs from the wrong tree.** Both dev
   tools are handed PACKAGE roots (`~/src/boxes/test1`), whose `.bbx-box` lives in
   `content/`; `getBoxShapeIfPresent(packageRoot)` returned found:false and the
   log path was built at the package root, not `content/`. Pre-existing, but 1b's
   rerouting preserved it while claiming to resolve v2 logs. → FIXED: new
   `resolveOperationalRoot(path)` helper (box-shape.ts) resolves a package-root OR
   content-root path to the operational content root (rethrowing malformed/IO);
   both csp tools use it.

3. **Medium — engine-version doctest passed for the wrong reasons + built a
   box-in-box.** It called `makeTmpBox()` "legacy" (now v2), got `installed:null`
   only because the fixture lacked `node_modules/beebox`, and wrote
   `package.json`/`content/.bbx-box` under the content root (`box.path("content")`
   → `content/content`). → FIXED: rewritten to install a fake engine at the real
   `box.packageRoot/node_modules/beebox` and read via `box.root`; sections
   reframed to the actual v2 semantics.

4. **Coverage risk (not a bug):** no test for the tombstone or the ENOENT-only
   helper. → ADDRESSED: added `getBoxShapeIfPresent` (found / ENOENT→found:false /
   malformed→throws) and `resolveOperationalRoot` (package→content, content→self,
   non-box→passthrough) coverage to box-shape.doctest.md.

All four landed with the core still green; the fixes touch production `serve` and
the csp dev tools plus two doctests.
