---
title: "Configure encrypted backups in Admin"
status: draft
workstream: box-backups
issues: []
---
# Configure encrypted backups in Admin

Add a separate **Encrypted backups** section under Admin → Host. It sets up
the existing per-box Restic repository and reports the last locally recorded verified snapshot.
The CLI remains the runner and recovery tool.

**Issues addressed:** none. The completed [server backup story](../../../issues/closed/decisions/2026-08-07-server-backup-story.md) established the Restic engine. This plan adds the later boxholder-requested Admin entry point.

## Design

### Situations

- When Diana opens Admin for a new local box, she wants to choose where encrypted copies go and supply a recovery password, so she can protect its files without learning the engine CLI.
- When Diana returns after a scheduled run, she wants to see the latest locally recorded verified copy and whether daily capture is enabled, so she knows what she could recover and what is configured to run.
- When a backup fails, she wants a specific result and a retry command, so an old snapshot does not masquerade as a current one.
- When Diana is reading or chatting in the box, she does not want a backup to silently interrupt her work; the host runner should use the existing exclusive capture hold.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
| --- | --- | --- | --- |
| First setup | Show destination, password custody, daily schedule, and first-run command | New Admin → Host → Encrypted backups section | Deliberate owner action |
| Successful scheduled run | Record result and show it on return | Section and Admin overview | Quiet |
| Failed or stale run | Show last verified time separately from the failed attempt | Section and overview | Findable warning; no new notification channel |
| Busy box | Wait through the existing maintenance admission | Runner; section shows in-progress state | Background |

### Spirit

- **Serves:** `docs/architecture/spirit.md`, “You should be able to see the gears”: the section names the snapshot, when it was verified, and the last attempt's outcome.
- **Risks:** “It should feel like a place”: a lengthy host form could dominate Admin. Keep the section closed to status after setup and link to the advanced CLI guide.

### Trust

The owner explicitly saves destination and password, then runs the shown CLI
command for the first backup. Daily runs become automatic after Admin confirms
the install's runner and records the owner's opt-in. Recovery remains a CLI action with a
snapshot preview and exact-ID apply.

### When it goes wrong or does nothing

An unconfigured box says “No encrypted backup configured.” A configured box
with no local run record says that Admin cannot yet confirm a snapshot and
shows the manual capture command. Repository or
password failures show an error without returning password bytes or a Restic
command line. A stale verified snapshot remains visible beside the failed
attempt. A missing server timer blocks Daily and is shown as a repair state.

### Walkthrough

Diana opens Host → Encrypted backups, enters a repository and recovery
password she has already saved outside the machine, and saves. The server
creates a mode-0600 password file in machine state, calls the existing
`configureBackup`, and clears the browser input. The section shows the exact
manual capture command for her installation. On the production unit host,
it runs as that box's Unix user with the unit environment; on a local box it
uses `bbx engine backup run <box-root>`. After a CLI
run, Admin reads the local last-attempt record and shows the verified ID and
time. A host runner later calls `bbx engine backup run` and writes that same
record.

## Smallest fix and budget

The smallest useful change is a read-only section showing setup commands. It
would still require terminal configuration, which is the friction the
boxholder identified. This plan adds one-time credential entry, setup, and a
daily on/off control; first capture remains a CLI command. Estimate: 450–650
changed source lines and 200–350 test lines across backend, frontend, and run
status; 100–180 authored documentation lines. Generated doc-graph changes are
separate.

## Stated preferences this plan trades against

- The boxholder chose a new Admin section, distinct from the existing Git and annex Backup section. They also want command-line control and a schedule that can run the command. The UI therefore uses the existing runner rather than inventing a second backup implementation.
- The completed plan at `docs/implemented-plans/box-backups.md:120` says “Do not add Admin controls in this track.” This is a later, explicit change of product direction, not a technical restriction.
- `src/webapp/trpc/procedures.ts:28-34` wraps mutations in `withBoxWork`; `src/core/box-backup/run/backup.ts:25` acquires exclusive maintenance. The web mutation cannot await capture while holding its request lease.
- `src/webapp/trpc/procedures.ts:65-82` has `authenticatedOwnerProcedure`, which requires a real signed-in owner rather than open access. Use it for repository setup and credential-bearing status because snapshots contain secrets.

## What already exists

- `src/frontend/src/components/admin/sections.ts:56,77`: `"backup"` is a Host section about Git and annex copies. Add a separate section ID beside it; reuse `AdminSectionCard` and overview mapping.
- `src/frontend/src/components/admin/BackupSection.tsx:19-20`: “This section does not check encrypted backups.” Preserve that distinction.
- `src/core/box-backup/config.ts:18-20,41-49`: backup config is a per-box, mode-0600 machine file with repository and password-file path. Keep that storage model; the Admin form is the place to configure it, not a Git-tracked config file.
- `src/core/box-backup/run/backup.ts:95-119`: `configureBackup` validates the repository and password location/permissions. Reuse it, including repository identity checks.
- `src/core/box-backup/status.ts:6-16`: CLI status finds the newest verified snapshot and daily due state through Restic. Admin reads local run outcomes instead, so page loads cannot contend with repository locks or network latency.
- `src/cli/commands/backup.ts:51-109`: configure/run/status/check already work. Admin configures and reports; the CLI keeps capture and retention.
- `src/webapp/server/box-admission.ts:40-79` and `src/webapp/trpc/procedures.ts:28-34`: HTTP and tRPC mutations hold work leases. Keep long capture in the host-owned CLI runner; the web process may idle-exit.
- `deploy/systemd/beebox-backup@.service:12` and `mac-app/Sources/BeeBoxMac/BoxRuntime.swift:416-445`: server and Mac runners call the CLI. Docker and direct local need a serving-process catch-up loop.

## Prior art (external)

No new external library or service premise is needed. Restic and its repository
identity behavior were selected and tested by the completed backup plan. This
work uses the existing internal API and runner.

## Ontology

- **Backup configuration** (existing): one machine file per resolved box root; identifies repository, key-file path, daily schedule, retention, and backup identity. It is not the encrypted repository or a box Git file (`src/core/box-backup/config.ts:10-20`).
- **Verified snapshot** (existing): a Restic snapshot tagged `verified` for this backup identity. It is not proof that a host timer is installed (`src/core/box-backup/status.ts:11-16`).
- **Last attempt** (new): one machine-owned final status record for a CLI run, with start/end time, outcome, and safe error summary. It points at a verified snapshot on success; it is not a history of every run. Live maintenance state supplies `running` or `interrupted` without a second running marker.
- **Host runner:** systemd timer, Mac app loop, or serving-process catch-up loop that invokes the CLI. Optional launchd or NAS schedulers can invoke the same idempotent CLI. It is not a box-authored scheduled script.

## Tracks / scope

### A. Safe Admin setup contract

**What:** Add authenticated-owner tRPC status/configure procedures. Accept repository, recovery password on first setup, and retention. The server writes a protected password file next to the per-box machine config, then calls `configureBackup`. Never return password bytes. Existing CLI-configured boxes appear as configured without asking for the password again. Later repository or password changes remain CLI-only; Admin rejects a second setup without creating another password file.

**Why:** The current setup exists only as a CLI operation.

**Direction:** Add a core helper for the managed key file (`create` with mode 0600, no symlink/overwrite) and a safe status DTO. Expose repository only to the authenticated owner and mask URL userinfo from older CLI configs. Do not put backend credentials in a URL or a box file. Keep advanced provider credentials in their existing host files. Bound Admin's Restic repository validation/initialization to 120 seconds, so a bad destination cannot hold a box-work lease indefinitely. CLI setup keeps its existing unbounded behavior.

**Vocabulary lock-ins:** `encryptedBackupStatus`, `configureEncryptedBackup`; `repository`, `retention`, `configured`, `newestVerified`.

**First implementation chunk:** Write a route/core test for one-box credential isolation and repository validation; add the helper and owner-only procedures.

### B. CLI run outcome and crash recovery

**What:** Record a final outcome for CLI scheduled and manual runs. Admin reads the local record plus live maintenance state.

**Why:** A web request cannot hold a box-work lease while `runBackup` drains box work, and the web process can idle-exit. The UI needs a result after reload and must not equate “started” with “verified.”

**Direction:** Write final `verified` or `failed` outcomes from the CLI with atomic replacement. Derive `running` from the live maintenance owner and `interrupted` from an ownerless backup maintenance phase after a process crash. Let a later backup retry that specific ownerless `draining` phase; retain refusal for every other unfinished maintenance phase. Error summaries must not include password bytes, credentials, or raw Restic stderr. Keep the CLI's existing capture and retention composition. If retention fails after verification, preserve the verified snapshot and report a partial failure separately.

**Vocabulary lock-ins:** `BackupAttempt` with persisted `verified|failed` and derived `running|interrupted`; no new snapshot format.

**First implementation chunk:** Test a run that fails before verification, one that succeeds, and retry after an ownerless backup `draining` phase; implement local outcome record.

### C. Host Admin section

**What:** Add Encrypted backups beside the existing Backup section, with setup form, first/manual CLI command, last locally recorded verified snapshot, last attempt, daily on/off control, and separate host-runner guidance. Add an Admin overview summary.

**Why:** The boxholder expects configuration under Admin rather than only in terminal commands.

**Direction:** Register `encrypted-backups` under Host; render a masked write-only password field and a warning to save the recovery password elsewhere. Do not print raw repository errors into the UI. Read only local config, attempt, and maintenance state on page load; allow a manual refresh after a CLI run. Distinguish “no run recorded here” from “no snapshot in the repository.” Explain that S3/SFTP access must already exist on the host, and identify the install-owned runner setup step without claiming it is active when the app cannot verify that fact. Branch manual command guidance on the unit-host signal: use the per-box Unix user and unit environment there; show the generic CLI elsewhere and Mac app command separately.

**Vocabulary lock-ins:** Section heading “Encrypted backups”; existing “Backup” remains the Git/annex report.

**First implementation chunk:** Wire the section and overview to fake status/configure responses; verify form and result states in a DOM test.

### D. Schedule setting and install guidance

**What:** Allow daily or manual-only preference in machine config. Daily must have an installed, running owner for scheduled invocation; the Admin switch must not merely save permission for an absent runner.

**Why:** A box-authored scheduled script runs inside `withBoxWork` (`src/core/schedule/scheduler/pass.ts:31-37`) and would wait on its own admission when backup takes exclusive maintenance.

**Direction:** Accept `schedule: daily|off`, preserving `daily` in existing configs but starting new Admin configuration at `off`. Keep manual CLI `run` available when daily runs are off. Add `run --scheduled` for host runners; it skips when off. Make `status.due` false when off so the Mac loop does not enter an idle-wait cycle or poll Restic for an unavailable scheduled run. Update the server unit and install instructions to use `--scheduled`, and pass it from the Mac loop as a second guard.

**Vocabulary lock-ins:** `daily` and `off`; `off` controls unattended runs, not manual capture or restore.

**First implementation chunk:** Test configured-off scheduled CLI run skipping Restic, manual run working, and old daily config continuing to run.

### D2. Runner guarantee after boxholder review (2026-10-26)

The first implementation left a gap: the Admin daily switch rewrote only the config. The boxholder's correction is that turning it on should ensure a schedule exists. `deploy/deploy.sh:912-927` installs but does not enable per-box backup timers; `deploy/add-box.sh:504` enables only the box socket; `docker/compose.yaml:13-52` has no backup runner. The Mac app starts a backup loop after the VM starts (`mac-app/Sources/BeeBoxMac/BoxRuntime.swift:263-268,412-449`).

**Reviewed direction:** The runner is part of each supported install. Server box units have `NoNewPrivileges=yes`, so Admin cannot enable a timer through sudo. `add-box.sh` and deploy convergence instead enable a per-box timer with each socket. The timer checks hourly so a quiet timeout or a failed capture can retry; the CLI due policy still limits verified snapshots to daily. A new `serverAutoEnabled` config flag defaults false, including legacy configs; Admin sets it only after confirming the timer is active. Thus a legacy `--configure-only` does not begin capture merely because a deploy installs timers. On Docker and direct local `bbx serve`, a background loop owned by the serving process invokes the CLI outside any web request's box-work lease and catches up after restart. The Mac app keeps its host loop but delegates due and quiet checks to the same CLI policy. New Admin configurations start with daily off; the owner turns daily on when ready.

**Truthful control:** Server Admin verifies timer enabled and active before saving daily; turning off writes the config gate, leaving the inert timer installed. Mac, Docker, and local Admin requests are served while their built-in loop runs; status says they catch up while the app/box runs. Missing runner state prevents enabling Daily and shows the host repair command where needed. Existing server CLI configs retain their raw daily value but are presented as off until the owner opts in. The boxholder accepted catch-up while a direct local `bbx serve` is running; an OS job is not required.

**One scheduled-run policy:** `bbx engine backup run --scheduled` exits 0 without capture when configuration is missing, daily is off, a verified capture exists for this calendar day (with a minimum gap), or a failed attempt needs a short retry delay. It waits for a quiet box, then rechecks schedule and attempt state before requesting the exclusive maintenance hold. That makes a stray old launchd/cron job or a second runner ordinarily skip a duplicate. The Mac app calls this policy directly. Repository access and capture still run in the CLI process, not in the Admin request.

**Interrupted runs:** A host shutdown may kill a Restic subprocess mid-command.
Before the next capture, the CLI runs plain `restic unlock`, which removes
stale locks and leaves live writers' locks in place; the existing ownerless
backup maintenance retry then proceeds.

**Tests:** Exercise new-config default off, unconfigured scheduled-run skip, due/retry/quiet policy, server timer convergence and missing-timer refusal, loop overlap and startup wiring. Re-run selected tests, typecheck, layout/doc checks, and cross-model diff review. No browser-started backup action is added: `scheduler.trigger` waits inside a request work lease (`src/webapp/trpc/procedures.ts:28-34`, `routers/scheduler/router.ts:167-189`), whereas capture drains all such leases (`src/core/box-backup/run/backup.ts:21-27`).

## Could this be simpler?

Status plus copyable commands would avoid credential entry. It would leave the
boxholder configuring the destination and key outside Admin. The chosen path
makes configuration an Admin action while the existing CLI remains the single
capture implementation.

## Subplans

None. Track D2 adds the missing Docker/direct-local runner and server timer
convergence in this plan.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
| --- | --- | --- | --- |
| Unauthenticated or open-access caller submits a recovery password | Add route test | Authenticated-owner gate | Clear refusal |
| Password file is left after repository validation fails | Add filesystem test | Remove only newly created file | Clear error |
| Repository rejects key or cannot be reached | Add route/core test | `configureBackup` leaves previous config in place; UI reports failure | Clear |
| Web process exits | Add local-status test | Capture lives in host CLI; ownerless backup maintenance appears interrupted | Clear |
| Crashed backup leaves ownerless draining maintenance | Add core test | A later backup retries only this phase | Clear |
| A scheduled run fails after an older verified snapshot | Add status test | Last attempt and newest verified shown separately | Clear |
| Another trigger starts during a run | Add concurrency test | Existing maintenance admission refuses duplicate; report busy | Clear |
| Daily preference saved but host runner absent | UI state test | Refuse enable; show timer repair when a prior daily config lost its runner | Clear |
| Existing CLI config predates Admin | Add read test | Show current config without reading key bytes | Clear |
| Bad Admin destination makes Restic retry indefinitely | Add bounded setup test | Stop repository validation after 120 seconds with safe error | Clear |
| Unit-host manual command runs as the wrong user | UI command test | Show per-box Unix user with unit environment | Clear |

## Agent-flow / user-flow edge cases

- **Wrong section — ADDRESSED:** “Backup” remains Git/annex; “Encrypted backups” names Restic in its description and overview.
- **Stale snapshot — ADDRESSED:** latest verified and last failed attempt are separate values.
- **Two callers — ADDRESSED:** maintenance admission refuses concurrent capture.
- **Hand edit drift — ADDRESSED:** `readBackupConfig` strictly validates machine config (`src/core/box-backup/config.ts:24-38`); Admin shows the error, not fabricated defaults.
- **Fabricated value — ADDRESSED:** repository validation happens before “Configured” is shown.
- **Validation error UX — ADDRESSED:** return a safe stage-specific message, not raw Restic stderr with possible credentials.
- **Transition — ADDRESSED:** old configs retain daily semantics and CLI-configured boxes appear in Admin.

## NOT in scope

- Mac-initiated backup of a cloud box to the Mac; that needs a remote-to-local transport and remains separate.
- Browser restore; the current preview and exact-ID apply CLI remains the safer recovery entry point.
- Provider account creation, bucket provisioning, or editing S3/SFTP credentials in Admin; the destination must already be reachable by the runner.
- Arbitrary cron expressions or hourly retention; daily and manual-only match the existing runner cadence.
- Replacing the existing Git/annex Backup section.

## Open design questions

None for the first implementation chunk. The boxholder chose catch-up while a direct local box is running.

## Knowledge audits

No new box-agent instruction or card convention. This is an owner Admin and
operator CLI workflow; no knowledge audit is needed.

## What will hold this after it ships

Core tests cover password-file isolation, attempt outcomes, crash retry, and
schedule semantics; route tests cover owner authorization and safe DTOs; a DOM
test covers first setup, recorded outcome, failure, and legacy CLI configuration.
Run selected tests, typecheck, lint, layout/doc checks, a browser walk of
Host → Encrypted backups, and smoke before asking to land. No new test tier.

## Implementation order

1. Core managed password file and status/attempt seams, with focused tests.
2. Owner-only tRPC procedures and CLI outcome recording, with route tests.
3. Frontend section, overview, DOM tests, and browser walk.
4. Schedule `daily|off`, CLI semantics, install guidance, and documentation.
5. Track D2 runner convergence and shared due/quiet policy, with focused tests.
6. Security report draft for the credential-bearing route and backend egress; cross-model diff review; commit the implementation while the report awaits human review.

## Rollout shape

Old configs parse as daily. Admin setup uses the existing repository identity
checks, so it cannot silently adopt another box's snapshots. Capture still
verifies the repository and tags only completed snapshots. A failed attempt
never replaces the newest verified snapshot. Existing host runners continue
invoking the CLI with `--scheduled`; a daily/off setting controls only those
scheduled invocations. The plan is done when the focused code and UI tests, browser walk,
selected suite, typecheck, lint, layout/doc checks, and cross-model review pass.
