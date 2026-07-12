---
title: "v2 boxes: slug/box-name derived from basename(boxRoot) is \"content\" everywhere"
status: open
created: 2026-07-11
tags: [box-shape, v2, push, slug, correctness]
---

## Problem

Many code paths derive a box's slug / box-name from `path.basename(boxRoot)`.
For a **v2 (package) box** the operational root is `<pkg>/content`, so
`basename(boxRoot)` is the literal string **`"content"`** for *every* v2 box.
The real slug is `basename(packageRoot)` — which `cli/commands/serve.ts`
`defaultSlugFor` already does correctly (`basename(shape.packageRoot)` for v2),
and whose header comment explicitly warns about this exact gap ("passing a bare
dir instead would silently slug every v2 box 'content'").

The other sites did **not** get that correction. Found via the v1-removal work
(step 1a): once test fixtures build real v2 boxes, `push-output-cards.doctest.md`
collided because two boxes both slugged to `"content"` against the global,
slug-keyed push store (`~/.local/share/cb/push-subscriptions.json`). Worked
around in that test by isolating the store per box; the underlying code issue is
untouched and filed here.

## Sites using `basename(boxRoot)` as a slug/box-name (audit, verify each)

- `src/core/send-push.ts:80` — `boxSlug = basename(boxRoot)` → `endpointsForBox(boxSlug)`. Push lookup/delivery.
- `src/core/question-aging.ts:216` — `/${basename(boxRoot)}/browse/...` user-facing URL.
- `src/core/question-alert.ts:93` — `boxName = basename(boxRoot)`.
- `src/core/notify-boxholder.ts:39,75` — `endpointsForBox(basename(boxRoot))`.
- `src/core/schedule/health-alert.ts:68` — `boxName = basename(boxRoot)`.
- `src/core/chat/session/pool.ts:25` — returns `basename(boxRoot)`.
- `src/webapp/server-lifecycle.ts:20` and `src/webapp/server-main.ts:35` — `slug: basename(boxRoot)` (bare-dir fallback; `resolveBoxes`/`--slug` close this for the real serve path, but the fallback remains).
- `src/cli/commands/view.ts:170` — `boxSlug: basename(boxRoot)` passed to view props.
- `src/connectors/telegram.ts:304` — `boxSlug = basename(this.boxRoot)`.

(Not every hit is a bug — some may run where boxRoot is intentionally the package
dir, or where an explicit slug is threaded. Audit each.)

## Why it needs care (not a blind sed)

The push subscription **store is global and slug-keyed**, and existing
production data is keyed by whatever slug the *write* side (the subscribe API)
currently uses. Changing the *read* side (`send-push`) to `basename(packageRoot)`
without matching the write side would strand existing subscriptions. Any fix
must change the write and read slugs together, and consider a one-time migration
of the on-disk `push-subscriptions.json` keys. This is why it was NOT folded into
the v1-removal fixture step.

## Suggested direction

A single shared helper `boxSlug(shape | boxRoot)` = `basename(packageRoot)`, used
by every site that derives a slug from a box's location, plus a coordinated
write/read/migration plan for the push store. Verify against a real deployed v2
box whether push currently delivers at all (the read/write slugs may already be
consistently "content", meaning cross-box leakage rather than no-delivery).
