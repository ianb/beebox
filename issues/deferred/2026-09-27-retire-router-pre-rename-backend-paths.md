---
title: "Retire the shared router's pre-rename backend-path fallback"
workstream: unattached
activate-on: 2026-11-15
category: code-quality
area: router
filed-by: agent
discovered-by: agent
discovered-in: worktree-file-layout — fixing the shared router's hard-coded backend entry path so it does not break every other checkout after the 2026-09-27 layout moves land
---

The shared dev router (`workstreams-app/src/router/`) serves every checkout —
`main` and every `worktree-*` — from one process, spawning each one's
`beebox/` with a hard-coded, checkout-relative entry path. The 2026-09-27
layout moves renamed `beebox/src/cli/index.ts` to
`beebox/src/cli/entry/run.ts` (commit `3b5d64ca0`). Landing that rename and
restarting the router with only the new path would have broken every
worktree checkout that had not yet merged it; only the old path would have
broken every checkout that had.

`workstreams-app/src/router/core/backend-entry.ts` fixes this with
`BACKEND_ENTRY_CANDIDATES`, a per-key ordered list of checkout-relative
paths tried at spawn time (current path first, then the pre-rename path).
`hubEntry` is the only key with two entries today:

```ts
hubEntry: ["./src/cli/entry/run.ts", "./src/cli/index.ts"],
```

The second entry (and the fallback machinery in
`resolveBackendEntryPath`/`BackendEntryMissingError`) exists ONLY so a
checkout that predates commit `3b5d64ca0` still starts. Every fallback use
logs one `console.warn` naming the checkout and the old path, so ongoing use
stays visible in router output.

Once no `worktree-*` branch predates that commit, delete the second
(old-path) entry from `hubEntry` in `BACKEND_ENTRY_CANDIDATES`, and simplify
`resolveBackendEntryPath` if every remaining key has gone back to a single
candidate. Check with:

```sh
for b in $(git branch --list 'worktree-*'); do
  git merge-base --is-ancestor 3b5d64ca0 "$b" || echo "$b"
done
```

No output means every worktree branch has the current layout: safe to
retire. Any branch it prints still predates the rename — merge `main` into
it (or retire the branch) first.

`workstreams-app/test/router/core/backend-entry.test.ts` has a standing test,
using the real clock, that starts failing on or after **2026-11-15** as long
as `BACKEND_ENTRY_CANDIDATES` still has an old-path entry. Its failure
message repeats the check above. Delete that test too once the fallback is
gone.

This issue is filed to `deferred/` with `activate-on: 2026-11-15` (rather
than `next-action: reconfirm`) because the trigger is a known date, not an
open question to re-raise sooner: `deferred/`'s activation mechanism
(`issues/AGENTS.md` "Deferred items") is the closer fit — the hourly
`deferred-issues` schedule will move this into `code-quality/` on that date,
and the router test above independently starts failing the same day even if
this file is not yet picked up.
