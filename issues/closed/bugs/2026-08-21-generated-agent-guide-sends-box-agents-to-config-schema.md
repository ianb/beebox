---
title: "Generated agent guide sends box agents to config/schemas/, a directory the schema loader ignores"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-user-stories-refresh — user-story catalog verification
resolution: implemented
---

**What is wrong.** Box-local card types are loaded only from the package root's `src/schemas/`. `schemas/registry.ts` rebuildBoxSchemas reads `boxCodePaths(shape).schemasDir`, and `lib/box-shape.ts:242` defines that as `path.join(shape.packageRoot, "src/schemas")`; `core/schema-watcher.ts:38` watches the same single helper. There is no fallback branch, and every box is shapeVersion 2 (getBoxShape hard-errors on anything older), so `content/config/schemas/` is dead for all boxes. But the generated agent guide still names it: `core/agent-guide/cards.ts:175` emits 'New card types can be defined in `config/schemas/` using cardSchema() ... see `config/schemas/CLAUDE.md` for how.' That sentence is live in a real box's guide today — `content/.callback-box/agent-guide.md:302` in the test1 clone — 143 lines above the correct Box-Owned Code table (line 445, `| Schemas | ../src/schemas/ |`) rendered by `core/agent-guide/box-shape.ts` boxCodeLocationSection. The two sections contradict each other, and the actionable, imperative one is the wrong one.

**User-visible consequence.** A box agent following its own guide writes `content/config/schemas/<type>.ts`. Nothing loads it: the loader never reads that dir, and `lib/box-shape.ts:205-213` documents that the PostToolUse validate hook also exits 0 silently there because a `.ts` under config/schemas isn't a card path. The new card type simply never appears — no error at write time, no error at server start. The guide also points at `config/schemas/CLAUDE.md`, which does not exist in a v2 box (`cb init` writes SCHEMAS_CLAUDE_MD_V2 into `src/schemas/` instead — core/box/templates.ts:184); in the test1 clone `content/config/schemas/` holds only a `.gitkeep`. The failure is caught only later and only if someone runs `cb validate` or `cb status`, which call findLegacySchemaFiles/describeLegacySchemaFiles — helpers that exist precisely because this misdirection keeps happening.

**Supporting stale references in the same family.** `cb init` still creates the decoy directory: `config/schemas` is a BOX_DIRS entry, and core/box/index.ts ensureDirectories mkdirs every BOX_DIRS path with a `.gitkeep`. `lib/box-layout-spec.ts:249-258` still describes `config/schemas` as 'Box-local card-type definitions (Zod + callback-box/cards). Has its own CLAUDE.md.', which is what renders `docs/box-layout.md:161`. `core/docs-gen/index.ts:195` still mtime-watches `join(boxRoot, "config/schemas")` for doc invalidation and does not watch the real schemas dir. And `src/dev/knowledge-audits.yaml:338-339` asserts 'config/schemas' as a *correct* answer (`correct_contains_any: ["config/schemas", "cb init"]`), so the audit that is supposed to catch this instead rewards the stale path — while line 4136 of the same file expects `src/schemas/`.

**How I established it.** Read the loader (schemas/registry.ts rebuildBoxSchemas), the watcher (core/schema-watcher.ts ensureSchemaWatcher), and the path resolver (lib/box-shape.ts boxCodePaths + findLegacySchemaFiles); confirmed shapeVersion 2 is the only supported shape (getBoxShape MIN/MAX_KNOWN_SHAPE_VERSION = 2); grepped every `config/schemas` occurrence in src/ and docs/; and read the actually-generated guide in the worktree's test box clone (`content/.callback-box/agent-guide.md` lines 302 and 445) plus its empty `content/config/schemas/`.

**Files involved.** `callback-box/src/core/agent-guide/cards.ts` (line 175), `callback-box/src/lib/box-layout-spec.ts` (schemas entry), `callback-box/src/lib/paths.ts` (BOX_DIRS.schemas) + `callback-box/src/core/box/index.ts` ensureDirectories, `callback-box/src/core/docs-gen/index.ts` (line 195), `callback-box/docs/box-layout.md` (line 161), `callback-box/src/dev/knowledge-audits.yaml` (lines 338-339). Correct behavior lives in `callback-box/src/lib/box-shape.ts` boxCodePaths and `callback-box/src/core/agent-guide/box-shape.ts` boxCodeLocationSection.

## Updating the user-story catalog

This issue is why [`cards/define-box-local-card-types-that-hot-reload`](../../../callback-box/user-stories/catalog/2026-08-21.md#flagged-worth-a-human-glance) is currently
flagged ❌ in [the user-story catalog](../../../callback-box/user-stories/catalog/2026-08-21.md) — a catalogue of what callback-box can
actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a
short agent run over just the affected stories, not the full regeneration:

```
Workflow({scriptPath: "callback-box/user-stories/pipeline/recheck.workflow.mjs",
          args: {root: "<repo root>", date: "2026-08-21",
                 ids: ["cards/define-box-local-card-types-that-hot-reload"]}})

pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts 2026-08-21
pnpm exec tsx callback-box/user-stories/pipeline/render.ts \
  > callback-box/user-stories/catalog/2026-08-21.md
```

The recheck is adversarial by design: it will not mark the story accurate just because
this issue was closed — it re-reads the code. If it still refutes, that is worth knowing
before you call the fix done. Details in
[the pipeline README](../../../callback-box/user-stories/README.md).
