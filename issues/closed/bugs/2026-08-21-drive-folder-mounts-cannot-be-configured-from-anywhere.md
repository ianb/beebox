---
title: "Drive folder mounts cannot be configured from anywhere a boxholder actually uses"
workstream: drive-folder-mounts
area: beebox
filed-by: agent
discovered-in: worktree-user-stories-refresh — user-story catalog verification
resolution: implemented
---

**Closed 2026-08-26:** implemented by the drive-folder-mounts workstream (commit 544fa0c96 and the `bin/land` merge that follows it; see `beebox/docs/implemented-plans/drive-folder-mounts.md`). `drive.updateConfig` is gone; the tRPC `drive` router now exposes `mounts`/`mount`/`unmount`/`link`/`syncFolder`, `DriveSection.tsx` drives them from settings, and `bbx drive mount`/`link`/`unmount` are real CLI commands. Folder mounts are `.gfolder.card`s, not config entries — `config/connectors/google-drive.json`'s `folders` array converts automatically on first sync. The user-story recheck this issue asks for (`connectors/configure-which-gmail-calendar-and-drive-content`) was NOT run — no Workflow tool was available in this finish session; the catalog is unchanged and still needs the recheck.

The Gmail and Calendar connectors can be configured from the web UI; Google Drive cannot, and its backing mutation has no caller at all.

**What is wrong**

- `beebox/src/webapp/trpc/routers/drive.ts:45` exposes `drive.updateConfig` (writes `config/connectors/google-drive.json` via `saveDriveConfig` and commits it). Grepping `src/frontend/src` and the rest of `src` finds no caller.
- `beebox/src/frontend/src/components/settings/DriveSection.tsx` queries only `drive.config` and `drive.available`; its header comment states 'Mounting itself is done via CLI (`bbx drive add`); this view is read-only'.
- `bbx drive add` (`beebox/src/cli/commands/drive.ts:123`) mounts a single Drive *file* at a local path. There is no folder-mount command — `bbx drive` offers inspect / add / sync / status / list — so the `folders` array `loadDriveConfig` reads (`src/connectors/drive-config.ts`) has no writer except the caller-less tRPC mutation.
- `drive.available` returns `service.listSpreadsheets()`, so the settings page's 'Available' list is spreadsheets, not folders; the mounted-folder list comes from config only.

**User-visible consequence**

A boxholder who wants a Drive folder synced has no path through the UI or the CLI; the only way is to hand-edit `config/connectors/google-drive.json` in the box. The settings page points at a CLI command that does something else, which reads as a working instruction and is not.

**Files involved**

- `beebox/src/webapp/trpc/routers/drive.ts`
- `beebox/src/frontend/src/components/settings/DriveSection.tsx`
- `beebox/src/cli/commands/drive.ts`
- `beebox/src/connectors/drive-config.ts`

**How this was established**

Read the router, the section component and the CLI command; grepped the frontend and `src` for callers of `drive.updateConfig` (none). The browser pass over `/settings` (`scratch/user-stories/browser/settings.json`) was inconclusive — the test box reports 'Google auth not configured' — so this is a code finding, not an observed failure.

**Related**

`issues/features/2026-06-26-drive-mounting-file-browsing-ui.md` already describes this (same dead `updateConfig`, same read-only section, and notes the dead `drive.inspect` endpoint too). Treat this as a re-confirmation from the story audit rather than a new item.

## Updating the user-story catalog

This issue is why [`connectors/configure-which-gmail-calendar-and-drive-content`](../../../beebox/user-stories/catalog/2026-08-21.md#flagged-worth-a-human-glance) is currently
flagged ❌ in [the user-story catalog](../../../beebox/user-stories/catalog/2026-08-21.md) — a catalogue of what beebox can
actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a
short agent run over just the affected stories, not the full regeneration:

```
Workflow({scriptPath: "beebox/user-stories/pipeline/recheck.workflow.mjs",
          args: {root: "<repo root>", date: "2026-08-21",
                 ids: ["connectors/configure-which-gmail-calendar-and-drive-content"]}})

pnpm exec tsx beebox/user-stories/pipeline/apply-recheck.ts 2026-08-21
pnpm exec tsx beebox/user-stories/pipeline/render.ts \
  > beebox/user-stories/catalog/2026-08-21.md
```

The recheck is adversarial by design: it will not mark the story accurate just because
this issue was closed — it re-reads the code. If it still refutes, that is worth knowing
before you call the fix done. Details in
[the pipeline README](../../../beebox/user-stories/README.md).
