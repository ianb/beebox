---
title: "Two browser stores still key by box slug alone, and three storage calls skip the try that storage needs"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — frontend pass of the functional-duplication sweep
---

Part of the [functional-duplication sweep](2026-10-22-functional-duplication-sweep.md).
`lib/storage-scope.ts` scopes keys by box instance because a slug-only key
leaks between dev worktrees ([draft-storage-crosses-development-worktrees](../closed/bugs/2026-09-08-draft-storage-crosses-development-worktrees.md)).
Two stores still use the slug alone:

- `lib/location-share.ts:63` (`${KEY_PREFIX}:${boxSlug ?? "default"}`)
- `chat/workspace/sidecar-tabs-storage.ts:27` (now read as a legacy key by
  `workspace-browser-store.ts`)

Three calls reach storage outside a try, so a blocked or private-mode store
throws:

- `lib/location-share.ts:100` loadLocationShareState
- `pages/box-screen/BoxScreenPage.tsx:51` readStored (during render)
- `pages/capture/api.ts:120` saveDevicePrefs. Its reader, loadDevicePrefs, also
  returns `JSON.parse` output without validating it.

Five components keep a boolean flag in storage with the same get-"1"/set-"1"/"0"
code (`DebugLog.tsx:162`, `InteractiveChat/hooks.ts:24` useChatMute,
`ThemeStudioHarness/controls.tsx:18`, `scroll-diagnostics/diagnostics.ts:38`,
`BrowseSidebarBody/hook.ts:21`). The sweep merged the four sessionStorage JSON
stores onto `lib/session-json.ts`; a localStorage counterpart would cover these.

Changing a key moves or drops saved state, so key changes need a decision on
migration.
