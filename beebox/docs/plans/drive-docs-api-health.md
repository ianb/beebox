---
title: "Docs API unavailable reaches the boxholder"
status: draft
workstream: bug-burndown-4
issues:
  - ../../../issues/features/2026-10-20-drive-sync-problems-reach-the-boxholder.md
---
# Docs API unavailable reaches the boxholder

When the Google Docs API refuses a sync for a reason the boxholder can fix (the API is disabled on the Cloud project, or the grant lacks `documents.readonly`), Google Drive still syncs the docs with less detail, and today only the server log says so. This plan records that condition in the connector activity record, shows it as a dismissable health warning and as a status line in the Google settings section, and tells the agent what it means.

**Issues addressed:** `2026-10-20-drive-sync-problems-reach-the-boxholder`. A queue search for "lossy", "gdoc", "Docs API" and "google-drive" found no duplicate.

## Design

Boxholder decision (2026-10-20): *"Settings status line, but I believe it can be handled in health too? Then the agent can kind of introduce/explain it"*.

### Situations

- When Priya connects Drive and her docs sync, but her Cloud project never enabled the Docs API, I want the dashboard to tell her once, with the enable link, so she can fix it in Cloud Console in two minutes.
- When Priya opens Settings → Google to check that Drive works, I want the Drive line to say that Docs sync with less detail and why, so she sees the true state and not only "Connected".
- When Priya asks the agent "why does my doc card have no revision?" or "what is this warning?", I want the agent to explain the cause and that `lossy:` was not checked, so she can decide whether to fix it, and so the agent does not push an edit that removes footnotes it never counted.
- When Priya decides she does not need revision tracking, I want to dismiss the warning once and not see it again, so the dashboard stays quiet. (She does not want this feature here.)

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| First sync that hits it | Show | Dashboard health warning `connector-activity:google-drive`, button **This is expected** | Waits to be found. No push: health never notifies (`core/schedule/scheduler/health-alert.ts:8`: *"It never notifies on its own"*) |
| Checking settings | Show | Google Services section, under the Drive checkbox | Waits to be found. Shown while true, dismissed or not |
| Asking the agent | Act (explain) | Chat; the agent runs `bbx health` | Only when asked or when it reads a gdoc card without `drive.revision` |
| Chose not to fix | Quiet | Dashboard line gone after dismissal; settings line stays | Background |

### Spirit, trust, failure

- **Serves:** "You should be able to see the gears" — a sync that silently lost detail now says so where she looks. **Risks:** the cry-wolf failure that `connector-activity/verdict.ts:6-8` records (*"the box-growth level warning that fired forever taught the boxholder to ignore the dashboard"*). Guards: dismissal per episode, no notification, and only a definite diagnosis (`service-disabled`, `scope-insufficient`) opens it; a transient failure (`other`) never opens or closes it.
- **Trust:** shows only; the box takes no action. The fix is the boxholder's in Cloud Console.
- **Goes wrong:** if the diagnosis cannot be read, nothing new shows (the server log keeps the warning, as today). When she enables the API, the next sync clears both lines with no step from her.

### Walkthrough

The scheduler runs the Drive sync. `pull()` calls `getDocument`; Google answers 403 `SERVICE_DISABLED`. The handler returns the diagnosis with the pull result. The connector reports `degraded: {state: "on", …}` in its sync result. `syncConnector` writes `degraded` with today's date into the activity record. At the next dashboard load the health snapshot shows *"google-drive: 3 Google Docs are syncing without revision tracking or lossy-content details: the Google Docs API is disabled … https://console.developers.google.com/…"*. Priya clicks the link and enables the API. On the next sync `getDocument` succeeds, the connector reports `{state: "off"}`, the record clears `degraded`, and the warning and settings line are gone.

## Smallest fix and budget

Smallest fix: write the diagnosis to a health check. The chosen design is that fix, built on the existing activity record and episode latch, plus the settings line and the agent's guidance. Estimate: about 200 source lines (connector-activity 50, Drive handler and connector 60, admin procedure and view 40, guidance and docs 25) and about 200 test lines. This is not a BIG CHANGE.

## Stated preferences this plan trades against

- Minimal new concepts (boxholder memory, "prefer primitives"): this reuses the activity record, its episode latch and its dismissal. It adds one field and one episode kind, not a new store.
- `beebox/docs/engineering-principles.md` §4, *"invisible degradation is not"* allowed: this is the reason for the work.
- Bias toward strict: the activity record stays `z.strictObject`. The cost is the rollback case in Failure modes.
- Precedent: the `google-auth` check (`webapp/trpc/routers/health/checks/google.ts:31-52`) reads state that another path recorded, and settings shows the same state (`webapp/trpc/routers/admin/google.ts:44`, `needsReauthSince`).

## What already exists

- Diagnosis: `diagnoseDocsApiFailure` and `isBoxholderFixable` (`connectors/google-drive/handlers/docs/api-failure.ts:43-52`); the message includes the enable link (`:55-75`, `activationLink` at `:81`). **Reuse**; add a `link` field.
- The degraded pull: `tryGetDocument` (`handlers/docs/handler.ts:168-182`) logs with `console.warn` at `:176` and returns null. `pull()` calls it at `:231` and already deletes `headRevisionId` when it fails (`:285-289`). `push()` calls it at `:396`.
- Every gdoc card is pulled on every connector sync: `syncDriveFile` pushes then pulls (`file-sync.ts:39-44`), and the connector loop runs it for every live file card (`connectors/google-drive/connector.ts:149-163`). So the next scheduled sync is the "next successful `getDocument`".
- Activity record: `syncConnector` records every attempt (`connector-activity/core.ts:189-200`); per-connector `episode` with `dismissedAt` (`:51-64`). **Reuse.**
- Episode latch: `nextEpisode` keeps an episode while `kind` and `since` match, so a dismissal sticks (`connector-activity/verdict.ts:136-140`). Dismissal: `dismissConnectorEpisode` (`episodes.ts:30-42`). Dashboard line with **This is expected**: `webapp/trpc/routers/health/checks/connectors.ts:53-63`. Scheduler log once per episode: `core/schedule/scheduler/connector-activity-alert.ts:31-43`. **Reuse, all unchanged.**
- Promotion acts only on `failing` (`core/schedule/promotion.ts:137`: *"verdict.kind === \"failing\""*), so a degraded episode never sends a loud notice.
- How health reaches the agent today: the `<chat-app health>` attribute carries only scheduled-task health (`core/session-context.ts:256`, `summarizeScheduleHealth`). Box checks reach the agent only through `bbx health`, which runs `runHealthChecks` (`cli/commands/health.ts:179`), which includes the connector checks (`webapp/trpc/routers/health/router.ts:249`). The guide calls `bbx health` *"scheduled-task health"* (`core/agent-guide/guide.md:448`), which is out of date.
- Settings: `GoogleServicesSection` (`frontend/src/components/admin/GoogleServicesSection/view.tsx`), data from `admin.googleStatus` (`webapp/trpc/routers/admin/google.ts:21-47`), typed by hand in `useGoogleServices.ts:12-22`.
- A gdoc card lacks `drive.revision` exactly when `getDocument` failed (`schemas/gdoc.tsx:153`), and its `lossy:` is then empty although nothing was counted.

Rejected: a per-file flag in Drive state. `state.ts:80` says *"No deletions"*, so a deleted card's flag would warn forever.

## Prior art (external)

No decision depends on an external premise. Google's `ErrorInfo` reasons were verified in the closed 403 issue.

## Ontology

- **Docs API outcome** (new, `handlers/docs/api-failure.ts`): `{ok: true} | {ok: false; failure: DocsApiFailure}`, the result of one `getDocument` call in `pull()`. It is not stored.
- **`DocsApiFailure.link`** (new field): the enable or library URL for `service-disabled`; null for the other kinds.
- **`SyncResult.degraded`** (new, `src/connector.ts:57`): `{state: "on"; message; link} | {state: "off"}`. It is what one sync learned about a reduced-fidelity condition that the boxholder can fix. Absent means no evidence either way. It is not an error: `success` stays true.
- **Activity `degraded`** (new per-connector field, `connector-activity/core.ts`): `{since: day; message; link} | null`. It is the latest evidence. `since` is kept while the condition continues.
- **Episode kind `degraded`** (new value beside `quiet` and `failing`, `core.ts:52`). Its dismissal and latch are the existing ones.

## Tracks / scope

### Track 1: record the condition (connector-activity)

- **What:** `recordAttempt` applies `degraded`: `on` sets it (keeps `since` if already set, else today) and updates `message` and `link`; `off` clears it. A skipped attempt also clears it, because no sync is running, so nothing is degraded (Drive turned off or disconnected). A thrown attempt, or a returned one without the field, leaves it unchanged. `connectorVerdict` gets a `degraded` input; the precedence is `failing`, then `degraded`, then `quiet`. `describeVerdict` returns `` `${connector}: ${message}` ``.
- **Why:** the condition is found in a pull, and the health check reads it later in another process.
- **Vocabulary lock-ins:** `SyncResult.degraded`, episode kind `"degraded"`.
- **First chunk:** schema field `degraded: …nullable().default(null)` (old files parse), the enum value, `addAttempt`/`recordAttempt`, the verdict branch, `describeVerdict`. Tests 1 and 2.

### Track 2: report it from Drive

- **What:** `tryGetDocument` returns `{doc, outcome}`. `PullResult` gets an optional `docsApi` field (Docs handler only). `syncDriveFile` passes it through. The connector loop collects the outcomes and calls a pure `summarizeDocsApi(outcomes)`: any fixable failure gives `on`, with the message *"N Google Doc(s) are syncing without revision tracking or lossy-content details: <failure.message>"*; else any `ok` gives `off`; else absent. An `other` failure is not evidence either way. `service-disabled` and `scope-insufficient` are both project-wide or token-wide, so a pass cannot have both successes and failures. `console.warn` stays. `push()` is unchanged; `pull()` runs after it and gives the answer.
- **Why:** the per-pass outcome is the only signal that clears when the API is enabled, and it ignores deleted cards.
- **First chunk:** the code above plus `DocsApiFailure.link`. Tests 4 and 5.

### Track 3: settings line

- **What:** `googleStatus` adds `driveSync: {message, link, since} | null`, read from `connectors["google-drive"].degraded`. It is shown whether or not the episode was dismissed. If the record cannot be read, the value is null and the error is logged with `console.error` (the `connector-activity` health check already reports the damage). `view.tsx` shows a warning-tinted line under the Drive checkbox (`bbx-admin-google-drive-sync-status`) with the message and an **Enable the Docs API** link (`bbx-admin-google-drive-enable-docs-api`) when `link` is set. Add the field to `GoogleStatus`.
- **First chunk:** procedure, type, view. Test 6; one screenshot exhibit.

### Track 4: the agent

- **What:** `guide.md:448` becomes *"`bbx health` — scheduled-task and box health, including connector problems; yours to run."* (update ledger `commands.health`). The gdoc instructions' Lossy section gets: *"A card without `drive.revision` synced while the Docs API was unavailable: `lossy:` was not checked, so treat the doc as possibly lossy and run `bbx health` for the cause and fix."* Update `docs/server/health-checks.md` (connector-activity section) for the new kind, and correct its stale claim that the scheduler *"sends one iPhone app and Web Push message per episode"* (contradicted by `box-alerts.ts:2-4`).
- **First chunk:** these text edits plus the audit.

## Could this be simpler?

The simplest version is a `google-docs-api` health check that reads a dedicated latch file, written by `tryGetDocument`. It fails on dismissal: it would need its own dismiss state and procedure, and the boxholder who chose not to fix it would see the warning forever. That is the cry-wolf case in `verdict.ts:6-8`. Reusing the episode latch gets dismissal, the scheduler log and the dashboard button with no new code. The settings line and the agent text are the boxholder's request. No further shrink: each track is one of the three surfaces she named.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Transient Docs API 500 between `on` syncs opens a new episode the next day and undoes a dismissal | Test 5 (`other` gives absent) | `other` is not evidence | Clear |
| Boxholder turns Drive off; the stale warning stays | Test 1 (skip clears) | Skip clears | Clear |
| Every doc's sync throws before `pull()` (for example `getFile` 404); the `on` stays after the API is enabled | Test 1 (absent keeps) | Kept until a pull runs; that card's failure shows in `result.error` | Clear: the doc is failing anyway |
| Older binary (rollback) reads a record with `degraded`; the strict parse fails | No | `ConnectorActivityInvalidError` becomes the `connector-activity` warning; attempts are logged and not recorded | Clear. Accepted risk: rollbacks are rare, and the record is not reset |
| Message count changes (2 docs, then 3) and re-alerts | Test 2 | Episode keyed by `kind` and `since` | Clear |
| `googleStatus` throws on a damaged record and breaks the settings page | Test 6 | Catch, null, `console.error` | Clear |

## Agent-flow / user-flow edge cases

- Wrong field: the agent reads an empty `lossy:` as safe. ADDRESSED by the Track 4 gdoc text; audit `gdoc-without-revision`.
- Stale ref: a deleted card's state is ignored because outcomes are per pass. ADDRESSED (Track 2).
- Two writers: `updateConnectorActivity` takes the transient-state locks (`core.ts:103-114`). ADDRESSED.
- Hand-edit drift: a bad record is reported, not reset (`core.ts:77-81`). ADDRESSED.
- Fabricated value / validation UX: the agent writes nothing here. Not applicable, because only code writes the record.
- Transition state: old files parse with `degraded: null`; the first new sync fills it. ADDRESSED.
- The agent is not told proactively: the `<chat-app health>` attribute carries only scheduled tasks. DEFERRED to Open design questions.

## NOT in scope

- Push refusals (`.remote.md`): they already leave a file and a `conflict: true` card. The mechanism does not cover them, because they are not reduced fidelity.
- Folder-sync notes (`connector.ts:207`): they are a different condition with no boxholder fix. A second `degraded` reason would need a list; wait for a real case.
- `other` Docs API failures: transient, and showing them would cry wolf.
- Box checks in the `<chat-app health>` attribute: a decision for the boxholder, below.
- The admin overview row (`summarizeGoogle`): it stays "Connected"; the section line is the requested surface.

## Open design questions

- Should box-health warnings (this one included) also ride in the chat `health` attribute so the agent brings them up unasked? Lean: no, for now. See the report.

## Knowledge audits

Add `gdoc-without-revision` (`knows_directly`): *"`_content/drive/Plan.gdoc.card` has no `drive.revision` and no `lossy:`. The boxholder asks you to tidy its headings and push. What do you check first?"* Expect: it says that lossy content was not counted and runs `bbx health` (`bash_contains: ["bbx health"]`). Run it on the worktree's test1 clone and record the status comment.

## What will hold this after it ships

Unit tests on the pure decisions (`summarizeDocsApi`, `recordAttempt`, `connectorVerdict`) and one connector-level test through the existing fake Drive (`test/connectors/google-drive/handlers/docs.test.ts`, which already stubs `getDocument`). No new tier and no new mock: the ky `HTTPError` helper exists in `handlers/docs/api-failure.test.ts:25`.

## Implementation order

1. Track 1 (connector-activity) and tests 1 and 2. Commit.
2. Track 2 (Drive) and tests 4 and 5. Commit.
3. Health check test 3 (no code change expected). Commit with 2 if trivial.
4. Track 3 (settings) and test 6, plus the screenshot exhibit. Commit.
5. Track 4 (guide, gdoc text, docs, audit run). Commit.

## Rollout shape

Done when these pass:

1. `test/connector-activity.test.ts`: through `syncConnector` with a fake connector, `on` (day 1), then `on` with a new message (day 2, `since` stays day 1), then absent (unchanged), then a throw (unchanged), then a skip (null). Separately, `off` gives null.
2. `test/connector-activity.verdict.test.ts`: `degraded` gives `{kind: "degraded", since, message, link}`; `failing` wins over `degraded`; `nextEpisode` keeps a dismissed degraded episode across a message change and drops it when `degraded` is null.
3. `test/core/schedule/scheduler/connector-activity-alert.test.ts`: a degraded record gives one `connector-activity:google-drive` warning with `dismiss-connector-episode`; after dismissal there is none; after `off` and a new `on` on a later day, it is back.
4. `docs.test.ts`: a 403 `SERVICE_DISABLED` ky error gives `connector.sync()` with `success: true` and `degraded: {state: "on", message: "1 Google Doc is syncing …", link: <activationUrl>}`; with `getDocument` restored, the next sync gives `degraded: {state: "off"}`. The existing non-HTTP test keeps its exact result (no `degraded` key).
5. `summarizeDocsApi`: `[]` and `[other]` give absent; `[ok]` gives `off`; `[fixable, ok]` gives `on`; two fixable failures give "2 Google Docs are".
6. `test/webapp/trpc/routers/admin.google-status.test.ts`: `driveSync` from the record, null when absent, null with a log line when the record is invalid.

No data migration: the new field defaults to null on read.
