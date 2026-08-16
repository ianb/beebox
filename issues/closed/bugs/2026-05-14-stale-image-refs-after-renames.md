---
title: "stale image refs after renames"
workstream: unknown
area: callback-box
resolution: wontfix
---

> **Closed 2026-08-06 — the warning backstop is stiff enough (boxholder call).**
> `cb mv` rewrites refs correctly on the normal path; a rename that BYPASSES it
> still dangles refs, but every commit's pre-commit hook surfaces them loudly:
> `cb validate --staged` prints a yellow `(N broken refs)` count for staged cards,
> and a box-wide `cb validate --links` warn-only scan surfaces every dangling link
> to fix with `cb mv`. Deliberately non-blocking (refs go transiently stale). The
> stronger measures once considered — a pre-commit BLOCK on new broken refs, or a
> basename-based periodic repair job — are declined as not worth it; the visible,
> recurring warning is the accepted backstop. (The validator's broken-ref summary
> count landed earlier — `lint-format.ts` `countBrokenRefs`.)

Surfaced during the attach-layout migration test on the ledger box. Many archived capture-session cards reference their image children by the original `photo-NNN.image.card` form, but agents renamed those image cards to descriptive forms long ago (`photo-001-arrow-invoice.image.card`, etc.) without updating the session card's `<image-ref>` entries. ~1,166 broken refs on ledger trace back to this pattern.

The renames probably came from `cb mv` (or agent-issued renames) on the image cards alone, without touching the session card pointing at them. `cb mv` does rewrite cross-card refs, so a single rename via `cb mv` SHOULD propagate. Suggests this happened either before `cb mv`'s rewrite pass existed, or the renames bypassed `cb mv` (agents writing direct file moves, or using filesystem mv).

Catching it:

- `cb validate` already reports broken refs — but the noise level on ledger is high enough that the user hasn't acted on these. Maybe the validator could surface a stale-ref count summary at the top, and/or fail with non-zero exit when broken-ref count grows.
- A pre-commit hook could check that any commit touching an image card also updates any session card referencing it (or just refuses commits that introduce broken refs).
- A periodic cleanup job in wakeup could try to repair: for each broken ref pointing at `<old>.image.card`, look for an image card in the same dir whose `<filename>` matches the basename and the session's apparent ordering, and offer to repair.

## Research (2026-07-11)

Confirmed the mechanics referenced above:

- **`cb mv` does rewrite refs.** The rewriter is resolution-based, not a blind substring replace: `callback-box/src/core/rewrite-card-refs.ts`. It resolves every ref it finds against the card that holds it and rewrites it if the target is moving, covering all three ref-bearing forms in the codebase: frontmatter `ref:`/`refs:` entries, body `ref="…"` attributes (Markdoc tags like `{% source %}`), and inline markdown links/images (`[text](path)`, `![alt](path)`) — see the file's header comment (`rewrite-card-refs.ts:17-23`) and `moveOperations` callers in `callback-box/src/core/commands/move-operations.ts`. So a rename done *through* `cb mv` should not produce a dangling ref of this shape.
- **Raw `fs`/`git mv` bypasses the rewriter entirely** — there's no hook that intercepts a plain filesystem rename and no server-side check that a rename is accompanied by a ref update. The only backstop is the pre-commit hook (`callback-box/src/core/install-validation-hooks.ts:243`, installed by `cb init`), which runs `cb validate --staged`. Broken refs are warning-severity (`callback-box/src/core/card-lint.ts`, ~145-166) and `cb validate`'s exit code only counts errors (`countTotalErrors`, `callback-box/src/cli/commands/validate.ts` ~268-275) — so a commit that introduces a broken ref via a bypassed rename **warns but does not block**. This is the likely origin of the ~1,166 broken refs: agent- or human-issued renames that never went through `cb mv`.
- **`cb relink` does NOT repair card refs.** It's scoped to markdown-dossier inline links only: `callback-box/src/cli/commands/relink.ts` calls `repairBoxLinks` (`callback-box/src/core/link-repair.ts`), which walks `listBoxMarkdownFiles` and fixes broken *inline markdown links* (the CB002 lint rule) by basename match. It has no path into frontmatter `ref:`/`refs:` fields or body `ref="…"` attributes — the two forms that make up nearly all card-to-card refs. So `cb relink` is not a usable repair tool for this issue as-is.
- **No periodic repair job exists.** Nothing in the wakeup cycle or scheduler scans for broken refs and attempts basename-based repair; the idea in the third bullet above is still unimplemented.
- **The first bullet's ask is now implemented** — `cb validate`'s aggregate summary line calls out a broken-ref count separately so it can't hide inside the generic warning count. Implemented in `callback-box/src/cards/lint-format.ts` (`countBrokenRefs`, `formatLintResults` ~109-160): when there's at least one `type: "reference"` warning, the summary line gains a `(N broken ref(s))` clause, e.g. `15 files checked, 2 warnings in 0 files (1 broken ref)`; zero broken refs adds nothing. `--json` mode gets a matching top-level `brokenRefs` count (`callback-box/src/cli/commands/validate.ts` ~323-334). Exit-code semantics are untouched — broken refs still don't fail validation; that policy call remains open. Covered by two new doctest cases in `callback-box/test/core/card-lint.doctest.md`.

**Update (2026-07-30, box-root-paths Track F):** `cb mv`'s rewriter now also
covers `- ref:` items inside frontmatter block lists (a regex that previously
only matched inline/mapping form silently skipped them), and `cb validate
--canonical [--fix]` reports and normalizes non-canonical refs box-wide. Neither
closes this issue — a rename that bypasses `cb mv` still creates the broken refs,
and `--fix` normalizes form, it doesn't repair a dangling target.

Still open: whether/how to prevent bypassed renames from creating broken refs in the first place (pre-commit block? a `git mv` wrapper hook?), and whether to build the basename-based periodic repair job. Both need a design decision — this issue stays open.
