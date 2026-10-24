---
title: "Docs API unavailable reaches the boxholder"
status: implemented
workstream: bug-burndown-4
issues:
  - ../../../issues/closed/features/2026-10-20-drive-sync-problems-reach-the-boxholder.md
---
# Docs API unavailable reaches the boxholder

When the Google Docs API refuses a sync for a reason the boxholder can fix (the API is disabled on the Cloud project, or the grant lacks `documents.readonly`), Google Drive still syncs the docs with less detail, and today only the server log says so. This plan stores one Drive diagnosis and shows it in three places: a health check, a status line in the Google settings section, and the agent's chat context.

**Issues addressed:** `2026-10-20-drive-sync-problems-reach-the-boxholder`. A queue search for "lossy", "gdoc", "Docs API" and "google-drive" found no duplicate.

## Design

Boxholder decisions (2026-10-20): *"Settings status line, but I believe it can be handled in health too? Then the agent can kind of introduce/explain it"*. A later round decided two more points. There is **no dismiss**: the warning stays until the Docs API works or Drive is disabled or disconnected. And the agent **introduces** the problem at chat start, unasked.

### Situations

- When the boxholder connects Drive and their docs sync, but the Cloud project never enabled the Docs API, I want the dashboard to say so with the enable link, so they can fix it in Cloud Console.
- When the boxholder opens Settings → Google to check Drive, I want the Drive line to say that Docs sync with less detail and why, so "Connected" is not the whole story.
- When the boxholder starts a chat, I want the agent to mention the problem once and explain the fix, so they hear about it without opening the dashboard.
- When the boxholder asks the agent to tidy a doc whose card has no `drive.revision`, I want the agent to check health before trusting an empty `lossy:`, so it does not push an edit that removes footnotes it never counted.
- When the boxholder has turned Drive off, I want no warning about it, so nothing on the dashboard describes a sync that is not running. (In this situation they do not want the feature.)

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Problem open | Show | Dashboard health warning `google-docs-api` | Waits to be found. No push: health never notifies (`core/schedule/scheduler/health-alert.ts:8`) |
| Checking settings | Show | `GoogleServicesSection`, under the Drive checkbox | Waits to be found |
| Chat start | Act (mention once) | `<chat-app health>` attribute, existing gate | Once per chat session; see Track 4 |
| Drive disabled or disconnected | Quiet | All three suppressed | Background |

### Spirit, trust, failure

- **Serves:** "You should be able to see the gears." **Risks:** the cry-wolf failure that `connector-activity/verdict.ts:6-8` records. Guards: only a definite diagnosis (`service-disabled`, `scope-insufficient`) opens the problem; a transient `other` failure neither opens nor clears it; the problem clears when the condition ends; and the chat gate keeps the reminder rare.
- **Trust:** shows and explains only. The fix is the boxholder's.
- **Goes wrong:** if the diagnosis cannot be read, nothing new shows (the server log keeps the warning, as today). If the stored file is damaged, the health check says so.

### Walkthrough

The scheduler runs the Drive sync. `pull()` calls `getDocument`; Google answers 403 `SERVICE_DISABLED`. The outcome goes into the pass's collector. At the end of the pass the connector writes the diagnosis. The next dashboard load shows *"3 Google Docs are syncing without revision tracking or lossy-content details: the Google Docs API is disabled … https://console.developers.google.com/…"*. The next chat session opens with the Drive line in `health`, and the agent tells the boxholder. The boxholder enables the API. The next pass sees `getDocument` succeed and clears the file, and all three surfaces go quiet.

## Smallest fix and budget

The smallest fix is a health check that reads a stored diagnosis, and that is the core of this plan. The settings line and the chat line are what the boxholder asked for. Estimate: about 190 source lines (Drive collector and store 90, health check 25, admin procedure and view 35, session context and prompt text 25, guidance and docs 15) and about 220 test lines. This is not a BIG CHANGE.

## Stated preferences this plan trades against

- Minimal new concepts (boxholder memory, "prefer primitives"): one small transient-state file, with no new latch and no new episode kind.
- `engineering-principles.md` §4, *"invisible degradation is not"* allowed: this is the reason for the work.
- Bias toward strict: the file is parsed with zod; an invalid file is reported, not reset.
- Precedent: the `google-auth` check is a pure reader of state that another path recorded (`webapp/trpc/routers/health/checks/google.ts:1-12`), and settings shows the same state (`webapp/trpc/routers/admin/google.ts:44`).

## What already exists

- Diagnosis: `diagnoseDocsApiFailure` and `isBoxholderFixable` (`handlers/docs/api-failure.ts:43-52`); the message includes the enable link (`:55-75`, `activationLink` at `:81`). **Reuse**; add a `link` field.
- The degraded pull: `tryGetDocument` (`handlers/docs/handler.ts:168-182`) logs at `:176` and returns null; `pull()` calls it at `:231`.
- The two paths that pull a Doc: the connector's live-card loop (`connectors/google-drive/connector.ts:149-163`), and folder discovery, `syncFolderCard` → `deps.syncFile` (`folder-sync.ts:104-117`, `sync-deps.ts:82-83`). Both call `syncDriveFile` (`file-sync.ts:16`).
- A pass's completeness: every card, folder and config problem lands in `failures` (`connector.ts:110-113`: *"a failure that never lands here is a silent failure"*).
- Transient state with locks: `loadTransientState` / `updateTransientState` (`src/transient-state.ts`), as used by `google-auth-alert.ts:38-45`. **Reuse.**
- Drive gating: `isGoogleServiceAllowed(boxRoot, "drive")` (`core/box/config.ts:148`); `readGoogleAuthStatus` (`google/auth-status.ts:94`). Disconnect only removes tokens (`admin/google.ts:85`), so readers must check them; no sync runs to clear the file.
- Chat health: `buildSnapshotContext` builds `health` from `summarizeScheduleHealth` alone, then gates it with `admitHealth` (`core/session-context.ts:254-263`). The gate shows a value on a session's first send, does not repeat the same value, admits a changed value after 10 turns, and nudges again after 10 days (`:153-191`). One gate per chat session (`:135-151`). The prompt describes `health` at `core/chat/session/prompts.ts:128`.
- `drive.revision` is optional and is omitted when `getDocument` failed (`schemas/gdoc.tsx:54, 153-154`). A missing revision is a reason to check health; it does not prove the cause.

**Storage, rejected options:**
- The connector-activity record is strict across the whole file (`connector-activity/core.ts:60-99`). A new field there would make an older binary fail to record any connector's activity (`:171-180`).
- The Drive state file has two writers that merge field by field (`state.ts:65-105`), so a new top-level field would need a new merge rule.

**Chosen:** a separate file, `google-docs-api` (`_bookkeeping/connectors/google-docs-api.state.json`). It has one writer, the connector, at the end of a pass. An older binary never reads it.

## Prior art (external)

No decision depends on an external premise. Google's `ErrorInfo` reasons were verified in the closed 403 issue.

## Ontology

- **Docs API outcome** (new, `api-failure.ts`): `{ok: true} | {ok: false; failure: DocsApiFailure}`, one `getDocument` call in `pull()`.
- **`DocsApiFailure.link`** (new field): the enable or library URL for `service-disabled`; null otherwise.
- **Docs API diagnosis** (new, `connectors/google-drive/docs-api-status.ts`): `{kind, message, link, docs: number, since: datetime} | null`. It is stored as `{version: 1, diagnosis}`. It is the box's open Docs API problem; it is not a per-file record and not an episode.
- **`readDocsApiDiagnosis(boxRoot)`**: the one reader. It returns null when Drive is not allowed or Google is not connected. While the grant needs reauthorization it keeps the problem, marked `drivePaused` (implementation review: no dismissal means reauth must not hide it).

## Tracks / scope

### Track 1: collect and store (Drive)

- **What:** `tryGetDocument` returns `{doc, outcome}`. `push()`'s conflict check uses only `.doc` (`handler.ts:396`), so push outcomes are never collected; the pull that follows is the evidence. `PullResult` gains an optional `docsApi` (Docs handler only). `syncDriveFile` takes a required `docsApiOutcomes: DocsApiOutcome[]` and pushes the pull's outcome into it. `createFolderSyncDeps` takes the same array and passes it to `syncFile`, so the live-card loop and folder discovery feed one collector per pass. `FolderSyncResult` gains `capped: boolean`, set when a non-cycle refusal left part of the tree unmirrored (`folder-sync.ts:160-162`) and passed up from nested folders. At the end of `syncUnderLock`, the pure function `nextDocsApiDiagnosis({previous, outcomes, passComplete: failures.length === 0 && !capped, now})` decides:
  - any fixable failure gives `on`: the first `service-disabled` failure is preferred, `docs` is the count, and `since` is kept from `previous`;
  - else a complete pass whose every outcome is `ok` gives null, including an empty collector (no live Docs remain);
  - else the previous value is kept (an incomplete pass, or any `other` failure). (Implementation review: a success on an incomplete pass, or beside a transient failure, does not clear.)

  The connector writes the file only when the value changes. Its skip branches (`connector.ts:86-99`) also write null.
- **On-demand syncs do not write** (adjudicated, round 2). `bbx drive mount`, Settings "Sync now" (`mount-sync.ts:41-66`) and `bbx drive add` (`add-file.ts:124`, a direct `pull()`) discard their outcomes. The delay is accepted: the next scheduled connector pass pulls every Doc card, which writes or clears the diagnosis. So a first on-demand sync shows its warning after one connector interval, and a successful retry clears an old warning after the same interval. No new writers.
- **Why:** this is the only signal that clears when the API is enabled, covers newly discovered Docs, and ignores deleted cards.
- **First chunk:** the collector, `DocsApiFailure.link`, `docs-api-status.ts` (schema, `nextDocsApiDiagnosis`, writer, `readDocsApiDiagnosis`). Tests 1–4.

### Track 2: health check

- **What:** `googleDocsApiHealthChecks(boxRoot)` goes in `checks/google.ts`, beside `googleAuthHealthChecks`. It returns one `google-docs-api` warning with the stored message, or nothing. An invalid file gives a warning that names the file. It is registered next to `google-auth` (`router.ts:343`).
- **First chunk:** this check. Test 5.

### Track 3: settings line

- **What:** `googleStatus` adds `driveDocsApi: {message, link} | null` from `readDocsApiDiagnosis`; a read error gives null and a `console.error`. `view.tsx` shows a warning-tinted line under the Drive checkbox (`bbx-admin-google-drive-docs-api`), with an **Enable the Docs API** link when `link` is set. Add the field to `GoogleStatus` (`useGoogleServices.ts:12-22`).
- **First chunk:** procedure, type, view. Test 6; one screenshot exhibit.

### Track 4: the agent

- **What:**
  - On `sessionStart` only, `buildSnapshotContext` adds the Drive line to `health`, after any admitted schedule summary and separated by `"; "`. The Drive line is *"google-drive: Google Docs are syncing without the Docs API (no revision tracking or lossy check); `bbx health` has the fix"*. It is added independently of the `admitHealth` gate, which still sees only the schedule summary, so a schedule change can neither repeat nor delay the Drive line (round-2 finding). It is Drive only; no other box checks are added.
  - **What "once" means:** once per chat session, on its first send. No new seen-tracking state. The boxholder accepted that each new session repeats it while the problem is open.
  - `prompts.ts:128` adds: *"It may also carry a `google-drive:` line. Mention it the first time you see it in a conversation, explain the fix from `bbx health`, and don't repeat it."*
  - `guide.md:448` becomes *"`bbx health` — scheduled-task and box health, including connector problems; yours to run."* (update ledger `commands.health`).
  - The gdoc instructions' Lossy section gets: *"A card without `drive.revision` may have synced while the Docs API was unavailable; then `lossy:` was not checked. Run `bbx health` before relying on an empty `lossy:`."*
  - `docs/server/health-checks.md` gets a `google-docs-api` section, and its stale claim that connector episodes send push messages is corrected (`box-alerts.ts:2-4`).
- **First chunk:** these edits, test 7 and the audit.

## Could this be simpler?

The simplest version is the health check alone. It fails the boxholder's request: they named settings and the agent. A per-file flag in Drive state would save the collector, but it fails on deleted cards (`state.ts:80`, *"No deletions"*) and needs a new merge rule. The pure `nextDocsApiDiagnosis` function holds all the open and clear decisions, so the tests reach them without a connector.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A Doc found by folder discovery fails and is not counted | Test 3 | Collector passed through `createFolderSyncDeps` | Clear |
| A recursion cap leaves Docs unscanned, and an empty collector clears a real problem | Test 3 | `capped` makes the pass incomplete | Clear |
| A locally edited Doc's push path breaks on the new return shape | Test 1 | `push()` reads `.doc` | Clear |
| An on-demand mount or add hits the failure | No | The next connector pass writes it | Delayed by one interval; accepted |
| The last Doc is deleted and the warning stays | Test 2 | An empty collector on a complete pass clears | Clear |
| A pass with card failures clears a real problem | Test 2 | An incomplete pass keeps the prior value | Clear |
| A transient 500 opens or clears the problem | Test 2 | `other` is not evidence | Clear |
| Drive disconnected or disabled, and the old warning shows before any sync | Test 4 | `readDocsApiDiagnosis` suppresses | Clear |
| Damaged file | Test 5 | Health warning names the file; settings shows null | Clear |
| The agent repeats the line every turn | Test 7 | Existing gate | Clear |

## Agent-flow / user-flow edge cases

- Wrong field: an empty `lossy:` read as safe. ADDRESSED by the gdoc text (Track 4); audit `gdoc-without-revision`.
- Stale ref: deleted cards contribute no outcomes. ADDRESSED (Track 1).
- Two writers: the CLI never writes the file; the connector's writes hold the transient-state lock. ADDRESSED.
- Hand-edit drift: the file is parsed; an invalid file is reported, not reset. ADDRESSED.
- Fabricated value / validation UX: only code writes the file. Not applicable.
- Transition state: no file means no problem; the first pass after deploy writes it. ADDRESSED.
- A new chat session mentions it again while the problem is open. ACCEPTED by the boxholder.

## NOT in scope

- Push refusals (`.remote.md`): they already leave a file and a `conflict: true` card.
- Folder-sync notes (`connector.ts:207`): a different condition, with no boxholder fix.
- `other` Docs API failures: transient, and showing them would cry wolf.
- Dismissal: the boxholder decided against it.
- Other box checks in chat `health`: the decision was Drive only.

## Open design questions

None. The decisions above settle the earlier ones.

## Knowledge audits

Add `gdoc-without-revision` (`knows_directly`): *"`_content/drive/Plan.gdoc.card` has no `drive.revision` and no `lossy:`. The boxholder asks you to tidy its headings and push. What do you check first?"* Expect it to run `bbx health` before trusting `lossy:` (`bash_contains: ["bbx health"]`). Run it on the worktree's test1 clone and record the status comment.

## What will hold this after it ships

Unit tests on the pure `nextDocsApiDiagnosis`, plus connector-level tests through the existing fake Drive (`test/connectors/google-drive/handlers/docs.test.ts` stubs `getDocument`; the folder fixtures are in `test/connectors/google-drive.folder.test.ts`). The ky `HTTPError` helper already exists in `handlers/docs/api-failure.test.ts:25`. No new tier and no new mock.

## Implementation order

1. Track 1 and tests 1–4. Commit.
2. Track 2 and test 5. Commit.
3. Track 3, test 6 and the exhibit. Commit.
4. Track 4, test 7 and the audit run. Commit.

## Rollout shape

Done when these pass:

1. `docs.test.ts`: a 403 `SERVICE_DISABLED` ky error gives a sync that still succeeds and a stored diagnosis `{kind: "service-disabled", docs: 1, link: <activationUrl>, …}`. With `getDocument` restored, the next sync clears it. The existing non-HTTP-error test keeps its exact result, and no diagnosis is stored. A locally edited Doc (push, then pull) still pushes and records the pull's outcome.
2. `nextDocsApiDiagnosis` table: fixable failure gives `on` with `since` kept; `ok` gives null; empty and complete gives null (last Doc deleted); empty and incomplete keeps; only `other` keeps; two failures give `docs: 2`.
3. `google-drive.folder.test.ts` (the connector-level folder fixtures; `mounts.test.ts` covers the CLI commands): a newly mounted folder containing one Doc, with `getDocument` returning `SERVICE_DISABLED`, gives a stored diagnosis on that first sync. Separately: with a prior diagnosis and a folder pass that hits the recursion cap and finds no Docs, the diagnosis is kept.
4. `docs-api-status.test.ts`: with a stored diagnosis and no further sync, `readDocsApiDiagnosis` returns null after Drive is disabled in box config, after tokens are removed, and while `needsReauthSince` is set.
5. `checks/google.docs-api.test.ts`: the diagnosis gives one `google-docs-api` warning; no file gives none; an invalid file gives a warning naming it.
6. `admin.google-status.test.ts`: `driveDocsApi` is set from the diagnosis, null when suppressed, and null with a log line for an invalid file.
7. `session-context` test: with a gate, the first send carries the Drive line and later sends do not, even when schedule health changes between sends. A session without the problem has no Drive line.

No data migration: a missing file means no problem.
