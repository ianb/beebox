---
title: "Codex plugin installer points the user's global marketplace at whichever checkout ran last; a culled one breaks every codex box's chat list"
workstream: unattached
area: callback-box
priority: important
labels: [codex, tests]
filed-by: agent
discovered-by: Ian
discovered-in: main session — the place-switch menu showed "Couldn't load landmarks — Retry" on a codex-engine box, hourly
---

`src/core/agent/ensure-codex-plugin.ts` registers the `callback-box` plugin
marketplace in the user's global Codex state (`~/.codex`) with
`marketplaceSource.source = PACKAGE_ROOT` — the checkout that happens to be
running — and re-points it whenever the registered path differs. Three
consequences, all seen 2026-08-26:

1. **The hourly `full-suite` schedule runs in a temp checkout**
   (`/T/full-suite-*/checkout`). Something in the suite reached the installer,
   the marketplace was re-pointed at the temp dir, the run finished and deleted
   it. From then on every `codex plugin …` command failed with "marketplace
   root does not contain a supported manifest" — for every checkout on the
   machine, until the next hourly run re-broke it the same way.
2. **Every codex-engine box's chat enumeration throws.** `listSessionEntries`
   → `enumerateChats` → `listCodexThreadMetadata` → `withSharedServer` →
   `ensureCodexPluginInstalled()` (`codex-transcript.ts:84`), so
   `chat.placeMenu` fails and the app bar's Switch-to panel shows "Couldn't load
   landmarks — Retry" (the error copy blames the wrong thing). The whole menu
   goes down for a metadata fetch the menu only uses for counts.
3. **The installer cannot repair what it broke.** Its first step is
   `codex plugin list --json`, which is exactly the command the dangling
   marketplace makes fail, so it throws `CodexPluginInstallError` instead of
   removing and re-adding the marketplace.

Worktrees have the same shape as (1): each codex session re-points the global
marketplace at its own checkout, and a culled worktree leaves it dangling.

Repair used today: `codex plugin marketplace remove callback-box`, `… add
<main checkout>/callback-box`, `codex plugin add callback-box-codex@callback-box`.

## What to change

- **Tests never touch `~/.codex`.** A `test/helpers/isolate-codex-home.ts`
  node-arg in `.taprc` (the `isolate-secret-store.ts` pattern) pointing
  `CODEX_HOME` at a throwaway dir — or a stub for the installer in tests. Find
  which test reaches it (a fixture box with `agentEngine: codex` that lists
  sessions, or a codex run).
- **The installer repairs a broken registration**: when `plugin list` fails,
  remove/re-add the `callback-box` marketplace rather than throwing.
- **Don't fight over the global registration from worktrees**: leave an
  existing registration alone when its path still exists and the plugin
  version matches; only repair when the path is gone.
- **Degrade, don't fail**: `enumerateChats` treats a codex-metadata failure as
  "unavailable" for those chats and still returns the rest, so `placeMenu`
  renders. The Switch-to error copy should name what failed.
