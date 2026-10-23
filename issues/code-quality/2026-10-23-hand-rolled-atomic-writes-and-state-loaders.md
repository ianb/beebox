---
title: "Hand-rolled atomic writes and JSON state loaders skip what the shared helpers do"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
---

## Atomic write

Status 2026-10-23: commit 530e63f89 moved the async writers listed below onto
`writeFileAtomic`. Still open: the synchronous writers (they need a sync twin),
`core/script-env/git-shim.ts` (forces mode 0755), and
`workstreams-app/src/server/exhibits/app/api.ts` (hidden temp name).

`writeFileAtomic` (`beebox/src/lib/atomic-write.ts:80`) writes a unique temp
file, fsyncs it, renames it, fsyncs the directory, keeps the target's mode,
and removes the temp file on failure. About 20 sites write temp-then-rename by
hand and skip some of these steps:

- A fixed `.tmp` name, so two writers can collide:
  `beebox/src/core/search/store/index-store.ts:113` (`writeJsonAtomic`, used
  by search and chat-search), `beebox/src/core/external/url-check/core.ts:116`,
  `beebox/src/hub/supervisor/state.ts:139`.
- No fsync: `beebox/src/core/schedule/summary.ts:195`,
  `beebox/src/core/script-env/git-shim.ts:110`,
  `beebox/src/core/upload-helpers.ts:195`,
  `beebox/src/core/capture/staging-manifest-io.ts:67`.
- Synchronous copies, because the shared helper is async only:
  `beebox/src/core/token-store.ts:260`, `beebox/src/webapp/local-users.ts:158`,
  `beebox/src/services/tailscale-setup/exposure.ts:147`,
  `beebox/src/core/chat/session/id-file.ts:70`.
- Copies in `bin/` and the workstreams app, which can import the shared
  helper: `bin/lib/schedules-store.ts:90`, `bin/lib/comments-store.ts:328`,
  `bin/agent-quotas-collect.ts:116`,
  `workstreams-app/src/server/main/issue-index.ts:163`,
  `workstreams-app/src/server/exhibits/app/api.ts:116`.

Moving a site to the shared helper adds fsync calls and changes the temp
name, so each move changes timing and durability. That is probably wanted,
but the search index writes are hot, and the sync callers need a sync twin
first.

## JSON state read with a default

No shared helper reads a JSON file and returns a default when it is missing.
About 15 local loaders do it with three policies:

- ENOENT gives the default and other errors throw:
  `beebox/src/core/install-validation-hooks.ts:314`,
  `beebox/src/core/chat/routing/quick-chat-store.ts:42`,
  `beebox/src/core/quick-capture/store.ts:46`,
  `beebox/src/webapp/box-config-write.ts:44`, `bin/lib/schedules-store.ts:93`.
- Every error gives the default silently:
  `beebox/src/dev/csp-report/report.ts:184`, `beebox/src/dev/csp-report/digest.ts:186`,
  `beebox/src/webapp/routes/chat/send-dedup.ts:83`,
  `beebox/src/core/chat/turn-marker.ts:71`,
  `workstreams-app/src/server/main/issue-index.ts:143`.
- Every error gives the default, and only a non-ENOENT error warns:
  `beebox/src/google/oauth-state.ts:74`,
  `beebox/src/core/retro/discovery/registries.ts:41`,
  `beebox/src/hub/supervisor/state.ts:159`.

`beebox/src/core/chat/review/state.ts:123` and `beebox/src/core/retro/state.ts:56`
are near line-for-line copies of each other. `beebox/src/transient-state.ts`
already has the strict policy (default on ENOENT, a typed error on corrupt
content) for connectors.

Which policy a store should have is a per-store decision: a silently reset
store loses data, and a throwing one can block a feature.

## Strict existence probe

`fileExists` (`beebox/src/lib/file-exists.ts`) treats every error as "absent".
About 8 sites need the strict form, where only ENOENT means absent and other
errors throw, and each writes its own:
`beebox/src/core/chat/session/delete/apply/storage.ts:43`,
`beebox/src/core/commands/trash/command.ts:88`, `beebox/src/core/plugins/active.ts:74`,
`beebox/src/core/cards/accept-submission.ts:73`,
`beebox/src/core/triage/evidence/core.ts:55`,
`beebox/src/core/triage/decisions/apply.ts:20`, `beebox/src/lib/state-migration.ts:55`.
They differ in `access`, `stat`, or `lstat`, so a shared strict helper needs a
symlink option.
