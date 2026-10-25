---
title: "Per-box users: where each piece of shared host state goes"
status: draft
workstream: box-isolation
issues: []
---
# Per-box users: where each piece of shared host state goes

Subplan of [per-box-units.md](per-box-units.md), Track B. Today every box
process runs as `beebox` and reads host-wide files freely. Once a box runs
as `bbx-<slug>` with `ProtectHome=yes`, each of those files is unreadable
unless this subplan says where it goes. One row per file: hub-only, a
per-box copy, or a shared directory with a group.

**Issues addressed:** none of its own; it serves the parent's
[cross-box filesystem isolation](../../../issues/features/2026-09-04-cross-box-filesystem-isolation.md).

## Design

No design section: infrastructure. The one person-visible row is agent
logins (a login per box user), handled under Open design questions.

## Smallest fix and budget

**Smallest fix:** a `beebox-boxes` group, every shared file group-readable,
every box user in the group. About 20 lines of provisioning. It fails on
the issue itself: the session secret, the auth file with password hashes,
and the whole secret store stay readable by every box, which is channel B
(`docs/security-report.md:531`) unchanged with a different group name.

**Chosen design:** the table below; about 250 source lines across the
engine's path resolution, the secret store split, and the migration script;
90 test lines. The probe chunk may move rows between columns, which is its
purpose.

## Stated preferences this plan trades against

- `docs/security-report.md:291`: the session secret "remains readable by
  any same-OS-user process (`script-env-allowlist.ts` concedes this)". The
  hub-only column ends that concession.
- `src/hub/AGENTS.md`, "Spawned children get an allowlisted env": fail
  closed. The per-box env file is generated from the same list.
- Principle §8 (one way): the secret store already supports an isolated
  per-store file (`BBX_SECRETS_FILE`, `BBX_SECRETS_STORE_ISOLATED`,
  `child-env.ts:65-66`); per-box stores reuse it rather than adding a
  broker.
- Boxholder memory "operational simplicity beats per-call cost": one login
  per box is more setup; a shared credentials file is less setup and less
  isolation. The lean below weighs that.

## What already exists

The survey of 2026-10-24 (`src/` citations below) found these host-wide
files. Per-box files under `<box>/.beebox/` (mobile devices, mobile
session secret, scan tokens, agent token, serve endpoint, PID file) move
with the box and need nothing.

| State | Path today | Read by a box process? | Where it goes |
|---|---|---|---|
| Session secret | `~/.bbx-session-secret` or `BBX_SESSION_SECRET` (`src/webapp/auth.ts:37-56`) | No by env (`src/hub/AGENTS.md`); file readable today | **Hub only.** Stays in `/home/beebox`, hidden by `ProtectHome=yes`. |
| Hub ↔ child trust | `BBX_HUB_SECRET`, minted per hub boot (`src/lib/env.ts:155`, `hub.ts:123`) | Yes, env | **Per box, per boot**: `/run/beebox/<slug>.secret.env`, 0640 `beebox:bbx-<slug>`, written by the first hub start of the boot and read back by later hub starts (parent Track C; decision 4). |
| Local accounts | `~/.bbx-auth.json` or `BBX_AUTH_FILE` (`src/webapp/local-users.ts:86-87`) | `BBX_AUTH_FILE` is in the child allowlist (`child-env.ts:62`): children read it | **Settled on the VM (2026-10-24): hub only.** With `BBX_OWNER_EMAIL` in `box.env` a box reads nothing from it: identity arrives in the hub's trusted header, the per-box ACL is `allowedEmails` via `hub-meta.json`, and the first-run setup banner (`webapp/setup-token.ts`) stays quiet because an owner exists (without the owner email each box boot printed a setup link it cannot use). Invites and password resets are the hub's login surface. The original lean: the hub resolves identity and passes it in the trusted header already; the per-box ACL is `allowedEmails`, which the box publishes to the hub in `.beebox/hub-meta.json` (parent Track D); invites become a per-box file under the box home that the box writes itself, holding no hash. If the probe shows a child needs the user list itself, a hub-owned read-only copy without password hashes placed in `/etc/beebox/`. The hub never joins a box group and never calls the wrapper. |
| Owner email | `BBX_OWNER_EMAIL` env (`src/webapp/auth.ts:346-348`) | Yes, env | Host-wide env file `/home/beebox/.env.box` (not a secret). |
| Secret store | `~/.config/beebox/secrets.json` or `BBX_SECRETS_FILE` (`src/core/secrets/store.ts:152-178`), grants keyed inside; a missing store reads as empty (`:220`) | Yes; children read the one store | **Per-box store** `/var/lib/beebox/<slug>/.config/beebox/secrets.json` holding that box's share of the master: its granted secrets with values, its grants, its publish records (`bbx engine secrets export-box <slug>`, `src/core/secrets/export-box.ts`), written by the migration and `add-box.sh`. Because a missing store reads as empty, both verify the copy's grant names against the master's for that slug and stop on a mismatch (implemented 2026-10-24; the plan's `copy-grants --verify` became this, since `copy-grants` copies between slugs inside one store). Granting stays an operator action on the hub user's master store, then a re-export. |
| Google token | `BBX_GOOGLE_TOKENS_FILE` (`child-env.ts:64`) | Yes | **Per-box copy** (the migration copies the hub's file to each box's `_config/connectors/google.secret.json`, the per-box path the store reads when the env var is unset) or a per-box login later. Not exercised on the VM (no Google credential there); the copy is mechanical, the question of one token for several boxes stays with the boxholder at migration. |
| Claude Code login and config | `CLAUDE_CONFIG_DIR` or `~/.claude/` (`storage.ts:49-50`); transcripts under it (`transcript-paths.ts:44-47`); `/home/beebox/.claude/.credentials.json` on the server | Yes, every agent run | **Per box user**: `CLAUDE_CONFIG_DIR=/var/lib/beebox/<slug>/.claude`. The login inside it is Open question 1. Transcripts are then per box by construction, which retires the per-cwd keying compensation (`security-report.md:531`). |
| Codex login | `CODEX_HOME` or `~/.codex` (`codex-rollout-model.ts:40-42`; `ensure-codex-plugin.ts:5` "shared by every checkout") | Yes | **Per box user**, same as Claude. |
| uv cache | `~/.cache/uv` (`python-tools-doc.ts:36`) | Yes (`uvx docling`) | **Shared directory** `/var/cache/beebox/uv`, group `beebox-boxes`, setgid, `UV_CACHE_DIR` in the host-wide env file; content-addressed, safe for concurrent writers. Avoids 6 × 1.4 GB. Probed 2026-10-24: entries root's prefetch made were not group-writable and entries a box made under `UMask=0077` were not group-readable; the provisioner now writes with `umask 002` and opens the cache to the group, and the units run with `UMask=0007`. |
| Docling models | under the invoking user's home (`setup-server.sh:100-103`) | Yes | **Shared directory** `/var/cache/beebox/hf`, prefetched by provisioning, `HF_HOME` in the host-wide env. Probed 2026-10-24: Docling 2.117 fetched `docling-layout-heron`, which the prefetch (`layout tableformer`) had not, and failed on the read-only cache, so the cache is group-writable and in `ReadWritePaths` like uv's. |
| Push subscriptions | `push-subscriptions.json` in `~/.local/share/beebox` or `BBX_PUSH_STORE_DIR` (`push-subscriptions.ts:72-76`) | Yes: `notifications.send` runs in the box server (`notify-route.ts:2-6`) | **Per-box store**, the default `~/.local/share/beebox` under the box user's home (no env var needed); the migration writes each box's share with `bbx engine boxes export-push <slug>` (`exportBoxSubscriptions`), one copy per box for an endpoint opted into several. The root-level `/api/push/resubscribe` runs in the box server too and rewrites the box's own store. The split was rehearsed on the VM (an endpoint opted into two boxes came out as one record per box). Rotation (`pushsubscriptionchange`) reaches only the box whose page the service worker reports to; the other box's record goes stale until that page is visited, the same as a lost subscription today. Accepted. |
| VAPID and APNs keys | `BBX_APNS_*` and the VAPID pair in `/home/beebox/.env` (`deploy.sh:886-905`) | Yes | **Host-wide env file.** The keys are the host's identity to Apple and browsers, not a box's; a box can already send as the host today. Accepted. |
| Origin id | `~/.local/share/beebox/origin-id` (`origin.ts:47`) | Yes | **Per box**: a per-box origin id is the honest value once boxes are separate principals. The only reader is `core/chat/session/origin.ts` itself (checked 2026-10-24): nothing compares it across boxes. |
| Engine availability | `~/.local/share/beebox/engine-availability.json` (`engine-availability-store.ts:52`) | Yes | **Per box** (same engine, same answer; a copy costs nothing). |
| Scheduler stderr log | `~/.local/share/beebox/scheduler-stderr.log` (`scheduler/command.ts:37`) | Written by the scheduler | **Gone on a unit host**: the daemon runs as `beebox-sched` under systemd (stderr to its journal) and each pass runs in `beebox-pass@<slug>` (its own journal); the file is only the macOS launchd path's. Closes the host audit's `checkSharedLogs` for the server. |
| Scheduler and hub manifests | `~/.config/beebox/{boxes,hub,hub-state}.json` | No | **Hub only** for `hub.json` (`hub-state.json` is unused on a unit host); `boxes.json` moves to the scheduler user's home, `/var/lib/beebox-sched/.config/beebox/boxes.json` (implementation choice 2026-10-24 over the plan's `/etc/beebox/boxes.json`: the existing loader reads it from `$HOME` with no new code). Not confidential (`security-report.md`, "Box paths and slugs in shared config"). |
| Tailscale exposure | `~/.config/beebox/tailscale-exposure.json` | No | **Hub only.** |
| `/tmp/claude-<uid>` | per UID | Yes | **Per box** by construction (distinct UIDs, `PrivateTmp=`). |
| Host packages record | `<box>/_config/host-packages.json` | Yes | Per box already; on a unit host the box only records, and the next deploy installs with `bbx host sync` as root (parent Track C; decision 5). |

## Prior art (external)

None needed beyond the parent's; no decision here depends on an external
premise except Claude Code's credential handling (Open question 1), which
the probe measures rather than researches.

## Ontology

- **Hub only**: a file under `/home/beebox`, invisible to boxes.
- **Per-box copy**: a file under `/var/lib/beebox/<slug>`, owned by the box user.
- **Shared directory**: a path under `/var/cache/beebox`, group
  `beebox-boxes`, readable (and for uv writable) by every box user.
- **Host-wide env file**: `/etc/beebox/box.env`, world-readable, holding
  the non-secret part of the child allowlist; the hub secret is one file per
  box, `/run/beebox/<slug>.secret.env`, group `bbx-<slug>` (parent Track C).
- **Derived per-box paths**: `BBX_SECRETS_FILE`, `CLAUDE_CONFIG_DIR`,
  `CODEX_HOME`, `BBX_PUSH_STORE_DIR` resolve from the box user's home, so
  no per-box generated env file exists.
No new noun beyond these placements.

## Tracks / scope

### Chunk 1: the probe

On a throwaway VM (Track F's cloud-config, packages and users only): copy
the test box, create `bbx-test1` with home `/var/lib/beebox/test1`, move
the box under it, install Track C's unit as written, point
`CLAUDE_CONFIG_DIR` at an empty per-user dir, and start it. Record the
modes of `_config/box.json` and `.beebox/chat-schedules.json`, which the
hub reads without group membership (parent Track D). Then run: a page load, a chat turn (needs a
Claude login; do the per-box login by hand to measure its cost), `bbx tick`
through `runuser`, a scan upload, `bbx host install` of a small package,
and a push notification send. Collect every EACCES, ENOENT and "not logged
in" from the journal. Settle each **Probe** row in the table above.
Output: the table with no Probe entries, committed to this file.

**Done on the probe VM (2026-10-24, Hetzner cpx21 from `cloud-init.yaml` +
`provision.sh`, then `deploy.sh` thirteen times as the fixes landed).** What
ran: two boxes added with `add-box.sh` (users `bbx-alpha`, `bbx-bravo`), a
third migrated from `/home/beebox/boxes` with `migrate-to-box-users.sh`
(dry run, run, interrupted run resumed, no-op rerun); `box-units.smoke.sh`
31/31; the hub picker and box pages as the owner through nginx; a scheduler
pass per box through `bbx-box-run`; `bbx host install` recording in the
sandbox and the deploy's `bbx host sync` installing; Docling inside the
sandbox; junk bearer and junk cookie against a stopped box (401, box stays
stopped). Modes: box home and root 0751, `.beebox/` 0751, `hub-meta.json`
0644, everything else private; the hub reads the metadata and cannot read
`_config/box.json`. Not run: a chat turn (no agent login on the VM; see
question 1), a scan upload and a push send (both need a paired device or
browser; the hub's bearer path is covered by the unit tests and the junk
probes). The findings each became a commit on the branch; the parent plan's
Track E notes list them.

### Chunk 2: engine path resolution

Each per-box or shared placement that is a new path is an env var already
honored (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `BBX_SECRETS_FILE`,
`BBX_PUSH_STORE_DIR`, `BBX_GOOGLE_TOKENS_FILE`, `UV_CACHE_DIR`, `HF_HOME`)
or one line in `src/lib/state-dir.ts`. Code changes only where the probe
found a read with no override.

### Chunk 3: the split in the migration script

`deploy/server-bin/migrate-to-box-users.sh` (parent Track E) copies each
box's grants, push subscriptions and Google token into the box user's home
and writes the two env files.

## Could this be simpler?

The smallest fix (one group) fails the issue. One step up, "hub only for
secrets, group-shared for everything else", leaves Claude and Codex logins,
transcripts, and the secret store readable across boxes; the transcripts
alone are box content. The table's per-box column is the smallest set that
makes channel B false.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A grant missing from a box's store after the split | migration `--verify` test | the migration fails before the host is switched; at run time the connector reports "not granted" | clear |
| Per-box Claude login expires; nobody logs in as that user | no | agent runs fail "not logged in"; `bbx health` reports the engine unavailable (existing check) | clear |
| uv cache written by two boxes at once | no | uv's cache is content-addressed and locked | clear |
| Push subscription split puts a subscription under the wrong box | no | the person re-subscribes from the box page | silent until a missed notification; **probe row**, the split keys on the box the subscription names |
| A hub-mode child still needing the auth file | probe | the hub-owned read-only copy fallback | clear at the probe |

> **Critical gap:** none after the probe; the push split is the row to watch.

## Agent-flow / user-flow edge cases

- Partial migration / transition state: ADDRESSED in the parent; the split
  runs inside the one migration.
- Hand-edit drift: a grant edited in the master store is not in the box's
  copy until `copy-grants` runs again. ADDRESSED by making `copy-grants
  --verify` the only documented way to grant on a unit host
  (`docs/server/`), and by the host audit comparing master grants with each
  box's store weekly.
- Others: not applicable.

## NOT in scope

- A secrets broker (the hub serving grants over a socket): the per-store
  file already exists and is enough for six boxes.
- Changing what the host's push and APNs keys mean.
- Per-box Tailscale exposure.

## Open design questions

1. **Agent logins per box.** One `claude auth login` and `codex login` per
   box user at provisioning (six logins once, then on expiry), or copying
   `/home/beebox/.claude/.credentials.json` into each box user's dir. The
   copy is one step and may break on token refresh if the refresh rotates
   the token; the per-box login is more setup and is also per-box
   revocation. Lean: per-box logins, measured in the probe; fall back to
   the copy if a login per box is more than a minute each. **Still open
   for the boxholder:** the VM had no agent account to log in with, so the
   cost was not measured; the migration copies nothing into `~/.claude`,
   and each box's first chat turn after migration needs its login. A
   scheduler pass on a box without one runs its non-agent scripts and logs
   the agent procedures as failed (seen on the VM).
2. **Google tokens**: one token file for every box today, or already per
   box? Not settled on the VM (no Google credential there); the migration
   copies the hub's file to every box, which keeps today's behavior.

## Knowledge audits

Skip: infrastructural.

## What will hold this after it ships

The host audit (`schedules/cross-box-leak-scan/host-audit.ts`) asserts the
table: each box home 0751 and owned by its user and group, with `box/` and
`box/.beebox/` 0751 and everything else 0700, no box user in another box's
group, `/etc/beebox/box.env` free of secrets, each box's hub
secret file 0640 `beebox:bbx-<slug>`, the shared cache group as specified, and
each box's secret store matching the master's grants for it. The Docker smoke in the parent's Track C checks the cross-user
read refusal.

## Implementation order

Chunk 1 (probe), then chunk 2 beside the parent's Track A, then chunk 3
inside the parent's Track E migration script.

## Rollout shape

Tests: the host audit extension and the smoke. Migration: inside the
parent's one-time script, after the snapshot.
