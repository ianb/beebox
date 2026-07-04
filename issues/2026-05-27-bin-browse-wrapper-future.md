---
needs: [decision]
area: monorepo
---

# `bin/browse` wrapper — keep, drop, or replace with a context file?

Observed in an agent session: the wrapper's one real ergonomic feature (path-rewriting, `bin/browse open /chat` → router URL for the current worktree) went unused — the agent constructed full `localhost:3210/<wt>/<box>/...` URLs every time, partly because the user's question anchored it to a specific URL, partly out of habit. The `bin/` prefix also imposes a small `cd` tax (running `bin/browse` after `cd callback-box` fails).

Three directions to consider, not mutually exclusive:

- **Replace the rewriting with a `BASE_PATH.txt` file** that holds the current worktree's URL prefix (e.g. `http://localhost:3210/deeper-paths-fix/test1-deeper-paths-fix`), rewritten by the `WorktreeCreate` hook, and pulled into CLAUDE.md via an `@BASE_PATH.txt` include. Agents construct URLs directly using that prefix; no wrapper needed; `agent-browser` goes on PATH (`pnpm exec` symlink or `~/bin` shim). Simple, makes the rewriting visible rather than magical.
- **Keep the wrapper but make it invisible** — symlink `bin/browse` into a PATH dir during install, or document an alias. Preserves the path-rewriting feature and removes the `cd` annoyance.
- **Small patches if we keep it:** print a one-line "ok" on `reload` and `network requests --clear` (silent success forced an agent into a `sleep`-and-pray pattern); investigate why `reload` didn't bust the `manifest.webmanifest` cache after a file edit (a `reload --hard` option, or always sending `Cache-Control: no-cache` on reload, would close that gap).
