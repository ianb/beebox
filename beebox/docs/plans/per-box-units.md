---
title: "One systemd unit and one OS user per box, and a cloud-init host"
status: draft
workstream: box-isolation
issues:
  - ../../../issues/features/2026-09-04-cross-box-filesystem-isolation.md
  - ../../../issues/code-quality/2026-08-07-deploy-infra-drift-setup-server-not-rerun.md
---
# One systemd unit and one OS user per box, and a cloud-init host

Every box on the server runs today as the same OS user inside a child
process the hub spawns. This plan gives each box its own Linux user and its
own socket-activated systemd unit, so a box process cannot read a sibling
box, an idle box costs no memory, and a box that blows up takes only itself
down. The hub stops spawning and only routes; it holds no privilege over
box users. The host is provisioned by a cloud-init file instead of a script
that never re-runs.

**Issues addressed:**
[cross-box filesystem isolation](../../../issues/features/2026-09-04-cross-box-filesystem-isolation.md)
(resolved by Tracks B and C);
[setup-server.sh is not re-run by deploy](../../../issues/code-quality/2026-08-07-deploy-infra-drift-setup-server-not-rerun.md)
(resolved by Track F: units and the provisioner become versioned files
`deploy.sh` installs). Related, not resolved:
[agent containment: allowed directories](../../../issues/features/2026-07-20-agent-containment-allowed-directories.md)
(the write-side control inside a box; a per-box user does not replace it);
[box first load is slow](../../../issues/bugs/2026-10-07-box-first-load-is-slow.md)
(a cold start stays a cold start; this plan changes who starts it);
[sandboxed trick helpers](../../../issues/features/2026-09-16-sandboxed-trick-helpers.md)
(a sandbox inside a box; `bwrap` is still absent on the host, verified
2026-10-24);
[encryption at rest for dormant boxes](../../../issues/exploration/2026-08-11-encryption-at-rest.md)
(a per-box user is the precondition it needs, not its implementation);
[container install is the primary path](../../../issues/features/2026-09-06-container-install-is-the-primary-path.md)
(the compose path is unchanged). Searched `issues/`, the plan directories
and `research/` for nspawn, DynamicUser, ProtectSystem, "socket activation",
cloud-init: no match beyond the files above (survey 2026-10-24).

## Design

No design section: infrastructure. The one thing a person meets, a box that
was asleep waking on the first request, exists today: production's hub runs
`lazy: true` with a 30-minute idle stop (read from the host, 2026-10-24,
`~/.config/beebox/hub.json`: `{'lazy': True, 'keepRecent': 1, 'idleMs': 1800000}`).
Nothing in a box's pages, cards, chat or notifications changes.

## Smallest fix and budget

**Smallest fix:** one OS user per box, the hub spawning each child with
`sudo -u bbx-<slug>` and a sudoers entry for that one command, no systemd
units. About 150 lines. It fails on: the hub, a network-facing process,
holding a sudo grant that makes it any box user; the shared files every
child reads today staying shared (the identity subplan has to be done
anyway); and memory staying whatever the hub's idle logic leaves resident
with no per-box limit. The chosen design gives the hub no sudo at all.

**Chosen design**, tracks A to F:

| Track | Source lines | Test lines |
|---|---|---|
| A. Engine: `bbx engine serve --socket`, idle exit with a drain | 160 | 100 |
| B. Identity: shared state split per box (subplan) | 250 | 90 |
| C. Units: template service and socket, `bbx-box-run`, the apt spool | 220 (bash, unit files) | 60 (smoke) |
| D. Hub: socket endpoints, unit state by polling, bearer checks in the child | 240 | 140 |
| E. Deploy, add-box, the scheduler pass per box, host migration | 340 | 80 |
| F. cloud-init provisioner and `create-server.sh` | 120 | 0 (a throwaway VM run) |
| Total | 1330 | 470 |

Authored docs, separate: about 200 lines (`docs/server/`, `deploy/README.md`,
`src/hub/AGENTS.md`). Not a BIG CHANGE, but near it; Track B is the part
most likely to grow, and the subplan's probe chunk exists to size it before
the rest is built. What the fuller design buys over the smallest fix: a
kernel-enforced boundary with no privileged process in the request path
(the hub never switches users; systemd does), a box that sees only its own
directory among boxes, memory proportional to boxes in use with a per-box
ceiling, and one provisioner that `deploy.sh` keeps current.

## Stated preferences this plan trades against

- `beebox/docs/engineering-principles.md` §4 (resilient and never silent):
  a box that fails to start must say so at the hub's 503 and in its unit's
  journal, not vanish behind a socket that accepts and hangs. Track D's
  readiness wait and `unavailable()` text carry that.
- §6 (right-sized defensiveness) and §8 (one way to do each thing): the
  hub's own supervisor (crash backoff, restart budget, idle timers,
  `keepRecent`) duplicates what systemd does for units. On a unit host the
  hub does not supervise; the spawning supervisor stays for the dev router
  and tests only.
- Boxholder decision 2026-10-24: systemd over containers for the server,
  because deploys are many per day and an image build per deploy is a tax;
  rsync stays the deploy path. The pulled engine tree is NOT in scope for
  the same reason. "Lightweight chroot kind of stuff": Track C's unit shows
  a box only its own directory among boxes (`TemporaryFileSystem=` over
  the boxes directory with its own `BindPaths=`), which is the chroot-shaped
  view without a chroot.
- Boxholder direction 2026-07-04 and 2026-07-11 (`src/hub/config.ts:64-90`):
  lazy start, idle stop, `keepRecent`. Idle stop moves into the engine
  (Track A); `keepRecent` is dropped, see Open design questions.
- The hub's "Isolation is layered" rule
  (`docs/implemented-plans/boxes-as-packages-v2.md:342-350`): "a box entry
  resolves to an endpoint (spawned child process today; a socket or URL
  owned by a chroot'd process or VM tomorrow), and the routing/auth layer
  only ever sees endpoints." This plan is that tomorrow. The same section
  says the hub "is trusted" and boxes "do not have to trust each other";
  Track D narrows what the trusted hub reads from a box to non-secret files
  and moves bearer verification into the box, which is a change to that
  trust shape and a boxholder decision (Open design question 1).
- `bbx-host-apt`'s posture (`deploy/server-bin/bbx-host-apt:1-19`): one
  root code path, plain bash, the whole privilege boundary in one file.
  `bbx-box-run` and the apt spool copy it; neither widens what root does.
- Memory on `beebox/deploy/deploy.sh:673-675`: "The install competes for RAM
  with every running box's `bbx engine serve` + claude-agent-sdk subprocess
  on this single small server, and the kernel OOM-kills it (exit 137)."
  `MemoryMax=` per unit turns that into a per-box failure.

## What already exists

- **The hub as router and supervisor.** `src/hub/AGENTS.md:3-5`: "`bbx hub`
  routes `/<slug>/...` to per-box `bbx serve` children (`supervisor/core.ts`
  owns the children, `server/core.ts` owns HTTP/WS routing + auth)". The
  endpoint seam is explicit: `src/hub/endpoints.ts:1-13` ("`supervisor/core.ts`
  is the only thing that knows HOW an endpoint comes to exist (today: spawn a
  child process ...; tomorrow: a chroot'd process, a VM, a socket)"), and
  `Endpoint.origin` is a URL string (`endpoints.ts:19-21`); `get()` and
  `unavailable()` are synchronous (`:36`, `:51`), `ensureRunning` is async
  and HTTP-only: "Deliberately NOT consulted on the WS upgrade path"
  (`:42-47`; `src/hub/server/core.ts:546-556`). The proxy is http-proxy-3
  with `ws: true` (`core.ts:359`). Reuse all of it; Track D adds a
  socket-backed provider that keeps those contracts.
- **What the hub reads from a box today.** `src/cli/commands/hub.ts:138`
  resolves each box root at start ("a box that never came up is simply
  omitted"); the request wall reads the box's mobile and scan credentials
  (`src/hub/server/core.ts:462-466`, `hasMobileAuth`, `hasScanAuth`), its
  agent token (`src/core/agent/token.ts:55`, a 0600 file, `:46`), and its
  `_config/box.json` for `allowedEmails` (`src/webapp/box-access.ts:30-33`).
  The child also verifies all three on its own routes (`server-box-scope.ts`,
  the per-scope auth wall, `docs/security-report.md:533`). Track D decides
  which of these the hub keeps.
- **Lazy mode and idle stop in the hub.** `Supervisor.ensureRunning`
  (`src/hub/supervisor/core.ts:230`), `evaluateIdle` (`:302-317`), the
  chat-schedule override (`src/hub/AGENTS.md`, "Chat schedules override
  idle-stop": "`evaluateIdle` checks the box's on-disk `chat-schedules.json`
  (via `supervisor/pending-schedules.ts`)"), and the boot-time pre-start of
  schedule-holding boxes ("`startAll` also pre-starts every schedule-holding
  box at boot"). The idle rule moves into the engine (Track A); the boot
  pre-start stays in the hub (Track D).
- **The idle signal the hub does not have.** `boxRequestsAreIdle`
  (`src/webapp/server/box-admission.ts:12-14`) counts only requests that
  take box work: `GET`, `HEAD` and `OPTIONS` without the work header are
  excluded (`:25`). It is a maintenance quiescence signal, not an activity
  signal; Track A adds its own.
- **Single-box serve with a slug.** `src/cli/commands/serve.ts:115-119`:
  `--slug` "Only valid with a single box directory — this is how `bbx hub`
  names a box's process". The unit's `ExecStart` is that command plus
  `--socket`.
- **Hub mode in the child.** `src/webapp/auth.ts:161`: `isHubMode()` is
  `!!process.env.BBX_HUB_SECRET`; `app.ts:184-190` returns 404 for login
  "This box is served behind a hub". The hub mints the secret per boot
  (`src/cli/commands/hub.ts:123`: "Fresh per boot -- never persisted").
  Track C changes where it lives so a hub-only restart does not strand
  running units.
- **Child env allowlist.** `src/hub/supervisor/child-env.ts` (fail-closed
  list, `src/hub/AGENTS.md`, "Spawned children get an allowlisted env").
  The unit's `EnvironmentFile`s are generated from the same list (Track C).
- **Readiness check.** `src/hub/supervisor/child-spawn.ts:59-66`:
  `/healthz` with the diag key, else `/api/build-info`, 30 s. Reused over
  the socket.
- **The privilege wrapper pattern.** `deploy/server-bin/bbx-host-apt`
  (root-owned, `bash -p`, re-exec under a clean environment, sudoers
  `beebox ALL=(root) NOPASSWD: /usr/local/sbin/bbx-host-apt`, installed by
  `deploy.sh:805-823`; smoke test `bbx-host-apt.smoke.sh` under Docker;
  invoked from a box by `sudo` in `src/core/host-packages-system.ts:66-89`).
  `bbx-box-run` is built the same way. The sudo call from inside a box
  cannot survive a read-only filesystem view (Track C's spool replaces it).
- **The scheduler.** `bbx engine scheduler start`, one process for every
  box, reloads `~/.config/beebox/boxes.json` each cycle
  (`src/core/schedule/scheduler/core.ts:182`) and for each box, in process,
  acquires admission, checks for uncommitted changes, writes the heartbeat
  and the box log, measures growth, then runs the tick (`:190-280`). All of
  that touches the box root as `beebox`. Track E moves the whole per-box
  pass behind the wrapper.
- **Per-box migration at deploy.** `deploy.sh:827-837`: `for boxdir in
  /home/beebox/boxes/*/ ... bbx engine migrate --sweep --within-maintenance
  --prepare --json`, as root through `sudo -u beebox`. Same loop over the
  new box paths, `runuser` as each box user; root needs no wrapper.
- **Maintenance admission** is per box under the box's git dir
  (`src/lib/box-maintenance/admission.ts:55-62`, `owner.lock`, `work/`,
  `phase.json`); cross-process by design. Per-user ownership does not
  change it.
- **Provisioning.** `deploy/hetzner/setup-server.sh` (header: "ONE EXAMPLE
  PROVISIONER, NOT THE INSTALL PATH ... This never re-runs on deploy") and
  `create-server.sh:73-78` (`hcloud server create` with no user-data).
  Units are written by the provisioner (`setup-server.sh:265-312`) and only
  drop-ins live in the repo (`deploy/systemd/*/exec-start.conf`,
  installed by `deploy.sh:860-878`). No sandboxing directive exists
  anywhere (`docs/implemented-plans/box-host-packages.md:141-143`).
- **Production facts** (read-only, 2026-10-24): systemd 255.4 on Ubuntu
  24.04; 4 GB RAM, 1.8 GB used; 6 boxes; eight `node ... dist/cli` processes
  of 144 to 223 MB RSS under the `beebox` user; `unshare` and `systemd-run`
  present, `bwrap`, `systemd-socket-proxyd`, `importctl`, `skopeo` absent.
- **The superseded spec.** `docs/unimplemented-plans/box-user-account-spec.md`:
  "`box ↔ user`. One-to-one. Adding a box is `useradd`", usernames
  `bbx-<boxname>`, UIDs 2000–2999, home `/home/bbx-<boxname>/`. Superseded
  by boxes-as-packages-v2, which deferred it ("to be planned when the fleet
  is converted and the hub is stable", `:572-577`). This plan adopts its
  naming and UID range, moves the homes out of `/home` (Track C says why),
  and takes the hub as stable.
- **Regression anchors.** `beebox/test/scenarios/cross-box-probe.test.ts`
  (network channel) and `schedules/cross-box-leak-scan/host-audit.ts`
  (modes, per-cwd keying, unknown shared files). The security report's §7b
  channel B is "Accepted for now" (`docs/security-report.md:533`). Track B
  adds the filesystem probe the issue asks for and the host audit asserts
  per-box ownership.

## Prior art (external)

- **systemd socket activation**, adopted: a `.socket` unit starts its
  service on the first connection; the sockets are passed to the service;
  with `Accept=no` one service instance takes every connection
  (<https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html>).
  The service receives the listening socket as fd 3 with `LISTEN_FDS=1`;
  Node adopts it through the handle form of `server.listen`, "an object
  with an `fd` member that is a valid file descriptor"
  (<https://nodejs.org/api/net.html>, `server.listen(handle)`). Verified in
  Track A's first chunk on Node 24, not only in the docs.
- **systemd sandboxing**, adopted
  (<https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html>):
  `ProtectSystem=strict` makes the whole tree read-only except
  `ReadWritePaths=`; `ProtectHome=yes` makes `/home`, `/root` and
  `/run/user` inaccessible, and a path under them cannot be reopened by
  `ReadWritePaths=` (review finding, codex gpt-6-sol, 2026-10-24), which is
  why box homes live under `/var/lib/beebox`, not `/home`;
  `TemporaryFileSystem=<dir>:ro` with `BindPaths=` is the documented way
  to show a service only chosen subdirectories of a directory;
  `PrivateTmp=`; `MemoryMax=`. `DynamicUser=` is evaluated and rejected: it
  recycles UIDs and warns against persistent files, and a box is
  persistent files. `RootDirectory=` is evaluated and deferred (NOT in
  scope): it needs the whole toolchain inside the tree.
- **systemd path units**, adopted for the apt spool: a `.path` unit with
  `DirectoryNotEmpty=` starts a service when a directory gains a file
  (<https://www.freedesktop.org/software/systemd/man/latest/systemd.path.html>).
- **http-proxy-3 target with a Unix socket**, adopted: `setupOutgoing`
  copies `socketPath` from the target along with `host` and `port`
  (<https://github.com/sagemathinc/http-proxy-3/blob/main/lib/http-proxy/common.ts>,
  the `['host', 'hostname', 'socketPath', ...]` list); the target type
  requires `host` and `port` beside the optional `socketPath`, so the hub
  passes `{ host: "localhost", port: 0, socketPath }` and Track D's first
  chunk proves HTTP and WS both reach the socket on the pinned version.
- **Hetzner cloud-init**, adopted: the console takes a cloud-config up to
  32 KiB (<https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server>);
  `hcloud server create --user-data-from-file <file>` is the CLI form
  (`hcloud server create --help`, verified locally 2026-10-24).
- No prior art found for a Node HTTP server exiting on idle under socket
  activation beyond the general pattern; the engine's own idle rule (Track
  A) is written from the hub's existing one plus an in-flight request
  count.

## Ontology

- **Box user**: the Linux account `bbx-<slug>`, UID from 2000–2999, home
  `/var/lib/beebox/<slug>`, owning exactly one box. Identified by the slug.
  Exists as a spec only (`box-user-account-spec.md`); adopted, with the
  home moved out of `/home` so `ProtectHome=yes` can stay on.
- **Box home**: `/var/lib/beebox/<slug>`, mode 0750, group `bbx-<slug>`.
  Holds the box root and the box user's own config and caches
  (`.claude`, `.codex`, `.config/beebox`, `.local/share/beebox`).
- **Box root**: `/var/lib/beebox/<slug>/box`, the one-root box
  (`docs/box-layout.md`). Today `/home/beebox/boxes/<slug>`; moved by Track
  E's migration. The hub's `hub.json` entry keeps `path` pointing here.
- **Box unit**: `beebox-box@<slug>.service` and `beebox-box@<slug>.socket`,
  a template pair; `%i` is the slug. New. systemd owns start, stop,
  restart and limits.
- **Box socket**: `/run/beebox/<slug>.sock`, created by the socket unit,
  owner `bbx-<slug>`, group `beebox`, mode 0660: the hub and the box, and
  no sibling box, can connect. The endpoint the hub routes to. New.
- **Endpoint**: `src/hub/endpoints.ts:19` today an origin URL; gains
  `socketPath`. Existing noun, extended.
- **Hub user**: `beebox`, running the hub and the scheduler as today. It
  owns nothing inside a box home after migration and is a member of no
  box group; it reads a box's non-secret files through their world-read
  bits only (Track D).
- **Hub secret**: `BBX_HUB_SECRET`, today minted per hub start
  (`hub.ts:123`); becomes `/run/beebox/hub-secret`, written once per host
  boot by the first hub start, read by later hub starts and by every box
  unit. Same noun, new home.
- **`bbx-box-run`**: the one root code path that runs a fixed set of `bbx`
  commands as a box user (`runuser -u bbx-<slug> -- bbx ...`), sudo-allowed
  for the hub user and used only by the scheduler. New.
- **Apt spool**: `/run/beebox/apt/<slug>/`, where a box leaves a package
  request and finds the result; a root `.path` unit runs `bbx-host-apt` on
  it. New. Replaces the box's own `sudo`.
- **Idle exit**: the engine's own rule for exiting when nothing has used
  it (Track A). Replaces the hub's `evaluateIdle` on a unit host. The
  socket unit keeps listening, so the next connection restarts it.
- **Shared state**: the per-host files in the identity subplan's table.
  Each is assigned to the hub user, to a per-box copy, or to a shared
  directory; the subplan is the registry.

## Tracks / scope

### Track A: the engine serves a socket and exits when idle

**What.** `bbx engine serve <root> --slug <s> --socket <path>` listens on a
Unix socket, or on the socket systemd hands it (`LISTEN_FDS=1`), and exits
after `--idle-exit <ms>` with nothing in flight, unless a pending chat
schedule or a live chat run keeps it.

**Why.** The unit cannot be socket-activated without the engine accepting
a passed fd, and sleep is impossible without a self-exit: today only the hub
kills an idle child (`supervisor/core.ts:331-350`), and on a unit host the
hub no longer owns the process. `boxRequestsAreIdle` is not an activity
signal (`box-admission.ts:25`), and the current shutdown force-closes
connections (`app.ts:342`), so a plain timer would cut a long read.

**Direction.** In `src/cli/commands/serve.ts`: `--socket <path>` (mutually
exclusive with `--port`); when `LISTEN_FDS` is set, listen on fd 3 and use
`--socket`'s path for logging only. In `src/webapp/server/app.ts`: an
activity ledger with Fastify `onRequest`/`onResponse` hooks counting every
in-flight request, the open WebSocket count from the tRPC WS server and the
transcription proxy, the chat registry's live runs
(`src/core/chat/session/registry/core.ts`), and the pending-schedule loader
(`supervisor/pending-schedules.ts`, moved under `src/core/chat/schedules/`
so both import it). The idle decision is a pure function of (last activity,
in-flight count, open sockets, live runs, pending schedules, now). On idle:
stop accepting (close the listening server so systemd's socket queues new
connections), wait for in-flight to reach zero with a 60 s bound, then the
existing clean shutdown (`app.ts:362`), exit code 0 so `Restart=on-failure`
does not restart it. A connection that arrives during the drain is held by
systemd's listening socket and served by the next instance.

**Vocabulary lock-ins.** Flags `--socket`, `--idle-exit`; env `LISTEN_FDS`
honored; the serve-endpoint file (`src/core/serve-endpoint.ts`) records
`{ socket }` instead of `{ port }` when a socket is used.

**First chunk.** `--socket` and `LISTEN_FDS`, with a test that starts serve
under a parent that passes a listening Unix socket as fd 3 and fetches
`/api/build-info` through it. No idle logic yet.

### Track B: identity, the shared state split

See [the subplan](per-box-units.subplan.md). Its first chunk is a probe on
a throwaway VM that runs one box as its own user under Track C's unit with
no other change and records every failed read; the table in the subplan is
settled from that run, not from grep alone.

### Track C: the units, the wrapper, and the apt spool

**What.** A template service and socket, a sudo wrapper for the scheduler,
a path-activated root service for package installs, and the sudoers
entries, as versioned files under `deploy/systemd/` and `deploy/server-bin/`
that `deploy.sh` installs.

**Direction.**

```ini
# deploy/systemd/beebox-box@.socket
[Socket]
ListenStream=/run/beebox/%i.sock
SocketUser=bbx-%i
SocketGroup=beebox
SocketMode=0660
[Install]
WantedBy=sockets.target

# deploy/systemd/beebox-box@.service
[Service]
User=bbx-%i
Group=bbx-%i
WorkingDirectory=/var/lib/beebox/%i/box
EnvironmentFile=/etc/beebox/box.env
EnvironmentFile=/run/beebox/hub-secret.env
ExecStart=/usr/local/bin/bbx engine serve /var/lib/beebox/%i/box --slug %i --socket /run/beebox/%i.sock --idle-exit 1800000
KillMode=mixed
TimeoutStopSec=90
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=5
ProtectSystem=strict
ProtectHome=yes
TemporaryFileSystem=/var/lib/beebox:ro
BindPaths=/var/lib/beebox/%i
ReadWritePaths=/var/lib/beebox/%i /var/cache/beebox/uv /run/beebox/apt/%i
PrivateTmp=yes
NoNewPrivileges=yes
MemoryMax=1G
```

`TemporaryFileSystem=/var/lib/beebox:ro` with `BindPaths=/var/lib/beebox/%i`
shows the box only its own home among the boxes; sibling homes are 0750 as
well, so the bind is the view and the mode is the wall. `ProtectHome=yes`
hides `/home/beebox` and every human home. `NoNewPrivileges=yes` is on
because the box no longer runs `sudo`: a read-only filesystem view would
make `bbx-host-apt` fail inside the unit's namespace whatever its
privilege, so package installs leave the unit through the spool below.
`/etc/beebox/box.env` is the non-secret host-wide part of `child-env.ts`'s
allowlist, generated by the hub from `/home/beebox/.env` with that list
(the list stays the one source); `/run/beebox/hub-secret.env` holds
`BBX_HUB_SECRET=`, written by the first hub start of the boot into the
hub's `RuntimeDirectory=beebox` (`RuntimeDirectoryPreserve=yes`, so a
hub-only restart reads it back instead of minting a new one), mode 0640,
group `beebox-boxes`, a group every box user is in and the hub user is
not. The box-specific env (`BBX_SECRETS_FILE`, `CLAUDE_CONFIG_DIR`,
`CODEX_HOME`, the push store) is not an env file: the paths are derived
from the box home in the subplan's chunk 2, so the unit needs no per-box
generated file. `MemoryMax=1G` is a first value to be measured against the
chat-history OOM record (`docs/implemented-plans/chat-history-oom-mobile-lock.md:10`).

`deploy/server-bin/bbx-box-run`: `bbx-box-run <slug> <operation>` →
`runuser -u bbx-<slug> -- /usr/local/bin/bbx <fixed args>` where
`<operation>` is one of `scheduler-pass` (`engine scheduler pass
/var/lib/beebox/<slug>/box`) and nothing else; the slug is validated
against the `bbx-` users and the box home's existence; the environment is
cleared and `/etc/beebox/box.env` loaded; the caller is logged. Sudoers:
`beebox ALL=(root) NOPASSWD: /usr/local/sbin/bbx-box-run`. Root (the
deploy) calls `runuser` directly. The hub never calls it.

Apt spool: `bbx host install` (`src/cli/commands/host.ts`) on a unit host
writes `/run/beebox/apt/<slug>/<id>.request` (`{ box, packages }`) and
waits for `<id>.result`. `deploy/systemd/beebox-host-apt@.path`
(`DirectoryNotEmpty=/run/beebox/apt/%i`) starts
`beebox-host-apt@.service`, root, which runs the existing
`bbx-host-apt install --box %i -- <packages>` per request and writes the
result with its exit code and stderr. The wrapper's policy is unchanged;
only the way a request reaches it changes. `src/core/host-packages-system.ts`
gains the spool client beside the `sudo` client, selected by the presence
of `/run/beebox/apt/<slug>`.

**Vocabulary lock-ins.** Unit names, the socket path, `/etc/beebox/box.env`,
`/run/beebox/hub-secret.env`, group `beebox-boxes`, `bbx-box-run
<slug> scheduler-pass`, the spool directory and file names.

**First chunk.** The two box unit files and a smoke test under Docker that
boots systemd, installs the units for two fixture boxes with two users,
starts one through `curl --unix-socket`, and checks from inside the first
box's unit (`systemd-run --uid`) that the second box's home is absent from
the view and unreadable by path.

### Track D: the hub routes to sockets and reads no secret from a box

**What.** A `hub.json` box entry gains `socket: "/run/beebox/<slug>.sock"`;
a socket-backed `EndpointProvider` whose synchronous `get()` reflects
polled unit state, whose `ensureRunning` connects (which starts the unit)
and waits for readiness, and whose `unavailable()` quotes the unit's state;
the hub's bearer gates become pass-through for a box the child verifies.

**Why.** Three hub reads need a box's 0600 files today (`core.ts:462-466`,
`token.ts:55`); a hub outside the box's group cannot read them, and putting
the hub in every box group would make it a reader of every box, which the
plan is removing. The child already verifies the same bearers on its own
routes. A `get()` that connected would wake a sleeping box on a WebSocket
reconnect, which `core.ts:546-556` exists to prevent.

**Direction.** `src/hub/endpoints.ts`: `Endpoint` gains `socketPath?:
string`; `src/hub/server/core.ts` passes `{ host: "localhost", port: 0,
socketPath }` as the proxy target when present. New
`src/hub/supervisor/socket-provider.ts`: a poll every 2 s of `systemctl
show -p ActiveState,SubState beebox-box@<slug>` for every socket entry
(unprivileged, read-only), kept in a map with the last readiness result;
`get` returns the endpoint only when the map says active and ready;
`ensureRunning` (HTTP only, as today) connects to the socket, waits for
`/api/build-info` (or `/healthz` with the diag key) over it with the 30 s
bound, then marks ready; `unavailable` returns the map's last state and
the journal's last line from `journalctl -u beebox-box@<slug> -n 1`
(unprivileged with the `systemd-journal` group). At hub start the provider
wakes, with one GET, every box whose `chat-schedules.json` is non-empty,
so pending check-ins re-arm after a reboot; that file is world-readable
box state (the probe confirms its mode). The bearer gates: for a slug with
a `socket` entry, a request carrying an agent, mobile or scan bearer is
proxied with the bearer intact and no hub verdict, and the child's own wall
answers 401 or serves; the session-cookie wall and `canAccessBox` stay in
the hub, reading `_config/box.json` through its world-read bit (the probe
confirms). A hub with any `socket` entry refuses `lazy`, `idleMs` and
`keepRecent` as config errors: the unit host owns those. The spawning
supervisor stays for entries without `socket` (the dev router and
`test/hub/`).

**Vocabulary lock-ins.** `socket` on a `hub.json` entry; `Endpoint.socketPath`;
the provider's state names mirror systemd's (`active`, `inactive`,
`activating`, `failed`).

**First chunk.** `socketPath` on `Endpoint` and the proxy target, with
`test/hub/` routing HTTP and a WebSocket through a Unix socket stand-in
server on the pinned http-proxy-3, and a 503 with the `unavailable` text
for a failed stand-in.

### Track E: deploy, add-box, the scheduler pass, and the host migration

**What.** `deploy.sh` stops and starts box units, converges each box as
its user, installs units and sudoers; `add-box.sh` creates the user and
home and enables the socket; the scheduler runs each box's whole pass
through the wrapper; a one-time migration moves the six boxes.

**Direction.**

- `deploy.sh`: during the deploy window `systemctl stop 'beebox-box@*.socket'
  'beebox-box@*.service'` (so a request cannot wake a box onto a half-copied
  tree), rsync and install as today, converge with `runuser -u bbx-<slug>
  -- bbx engine migrate --sweep --within-maintenance --prepare --json` per
  slug from `hub.json`, install units, the spool units and sudoers, write
  `/etc/beebox/box.env`, `systemctl start 'beebox-box@*.socket'`, restart
  hub and scheduler.
- `add-box.sh`: `groupadd beebox-boxes` once; `useradd --system --uid
  <next free in 2000–2999> -g bbx-<slug> -G beebox-boxes -d
  /var/lib/beebox/<slug> -m -s /bin/bash bbx-<slug>`; `chmod 0750`; clone
  and `bbx engine init` as that user with `runuser`; `bbx engine secrets
  copy-grants` into the box's own store and verify the copy (subplan);
  `hub add-box <slug> <path> --socket`; `systemctl enable --now
  beebox-box@<slug>.socket`.
- Scheduler: the per-box body of `src/core/schedule/scheduler/core.ts:190-280`
  (admission, dirty check, heartbeat, growth, tick, box log) becomes
  `bbx engine scheduler pass <boxRoot>`, run in process on a dev machine
  and through `sudo bbx-box-run <slug> scheduler-pass` on a unit host
  (selected by the wrapper's presence). The daemon keeps fleet concerns
  (the interval, the dev-bundle restart, load gating). Each box's log and
  heartbeat land under the box home; the aggregated
  `scheduler-stderr.log` goes away, which closes the host audit's
  `checkSharedLogs`.
- Migration `deploy/server-bin/migrate-to-box-users.sh`, run once by hand
  after a Hetzner snapshot: for each `hub.json` slug create the group and
  user, `mv /home/beebox/boxes/<slug> /var/lib/beebox/<slug>/box`, `chown
  -R`, `chmod 0750` the home, split the shared state per the subplan and
  verify each copy, rewrite `hub.json` paths and add `socket`, rewrite
  `boxes.json`, enable the sockets. Idempotent per slug: a slug whose home
  exists and whose old path is gone is skipped. The snapshot is the
  rollback until the first deploy after it.

**First chunk.** `bbx engine scheduler pass` extracted with its test (the
daemon calls it in process; with the wrapper present it spawns through
`sudo`), because it is the only engine code in this track.

### Track F: cloud-init provisioning

**What.** `deploy/hetzner/cloud-init.yaml`, a `#cloud-config` that creates
the `beebox` user and the `beebox-boxes` group, installs the apt packages
`setup-server.sh:30` lists, Node 24, uv, fclones, Claude Code, nginx, and
runs a versioned `deploy/hetzner/provision.sh` fetched from the repo at a
pinned ref for the parts cloud-config cannot express (unit install,
sudoers, the hub's env file skeleton, `/var/cache/beebox`).
`create-server.sh` passes `--user-data-from-file`. `setup-server.sh`
becomes that `provision.sh`, trimmed to what runs after packages, and
`deploy.sh` keeps installing units and sudoers so the drift issue closes.

**First chunk.** The cloud-config with packages, group and users only, run
on a throwaway VM (the same VM the subplan's probe uses), then destroyed;
the run log is the verification.

## Could this be simpler?

**Simplest version:** the smallest fix above. It fails on a network-facing
hub holding a sudo grant to every box user, and on leaving the shared files
shared, which is the issue's actual complaint.

**Units without socket activation**: the hub starts and stops units through
the wrapper and keeps its idle logic. Simpler for the engine (no fd
handling, no idle exit) and it keeps `keepRecent`. It fails on the hub
needing sudo on the request path (a cold start is a request), and on two
idle rules in two processes with the one in the proxy knowing less. Socket
activation makes the hub a pure router; that is what Track A buys.

**The hub in every box group** instead of moving bearer checks to the
child: 40 fewer lines in the hub. It fails on the hub becoming a reader of
every box's secret files, and on 0600 files (the agent token) staying
unreadable anyway. The child's walls exist; the hub's gates were a
pre-filter.

**Keep `sudo bbx-host-apt` from inside the box** and drop `ProtectSystem`:
no spool. It fails on the whole point of `ProtectSystem=strict` (an agent
inside a box writing host paths), and the spool is 100 lines around the
unchanged wrapper.

**One scheduler timer per box** instead of the pass through the wrapper:
no sudo for the scheduler, a node boot per box per minute. Rejected for
the per-minute cost on a 4 GB host and for throwing away the scheduler's
load gating; the wrapper allows one fixed operation.

**Skip cloud-init, keep `setup-server.sh`**: smaller, and the drift issue
stays open. Track F is 120 lines and the provisioner was the boxholder's
stated annoyance.

**Dropped as over-build:** `RootDirectory=`/the pulled engine tree (NOT in
scope); per-box containers; `DynamicUser=`; a secrets broker; a GitHub-side
anything.

## Subplans

[per-box-units.subplan.md](per-box-units.subplan.md): the identity split,
one row per shared file, with its probe chunk first.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Box unit fails to start (bad env file, migration parked the entrypoint) | Track C smoke | systemd `Restart=on-failure`, start limit; hub 503 with the unit's state and last journal line | clear |
| Socket accepts, service hangs before listening on the fd | no | Track D readiness timeout 30 s then 503 "box/<slug> did not answer" | clear |
| Idle exit while a WebSocket chat is open | Track A test (open WS keeps alive) | the ledger counts open sockets | clear |
| Idle exit while a long GET is in flight | Track A test (in-flight request keeps alive, drain waits) | the ledger counts every request; the drain bounds the wait | clear |
| Idle exit with a pending chat schedule | Track A test | keep rule (reuses the hub's loader) | clear |
| Idle exit races a connection: listener closed, systemd queues it, the next instance serves it | Track A test (connect during drain) | socket activation semantics | clear, a slow response |
| Reboot with pending chat schedules | Track D test (provider wakes schedule holders at start) | Track D start-up wake | clear |
| Hub-only restart: units keep the hub secret from the previous hub | Track C smoke (restart hub, request still proxied) | the secret lives in `/run/beebox/hub-secret.env`, read back by the new hub | clear |
| WebSocket reconnect to a sleeping box | `test/hub/` WS path with an `inactive` map entry | `get()` returns undefined from the polled map; 503 as today | clear |
| Poll says active, unit exits before the WS upgrade reaches it | no | the upgrade fails, the client reconnects, the next `get()` sees inactive | clear |
| `MemoryMax` reached: the box is OOM-killed alone | no | `Restart=on-failure`; the journal records the kill; hub 503 meanwhile | clear |
| Deploy window: a request arrives while units are stopped | existing deploy page via nginx `@hub_unreachable` | sockets stopped too, so nothing wakes onto a half-copied tree | clear |
| `bbx-box-run` given a slug with no user, or an operation not in the set | Track C smoke | refuses, exit 2 | clear |
| Scheduler pass as the wrong user (wrapper missing on a host that has box users) | Track E test | the pass fails on the box root with EACCES; the daemon logs per box | clear |
| Apt request with no root service listening (path unit disabled) | Track C smoke | `bbx host install` times out after 10 minutes and says the spool was not served | clear |
| Migration script interrupted mid-move | no | run after a snapshot; idempotent per slug | clear, needs a person |
| A grant missing after the secret-store split | migration verification (subplan) | the migration compares source grants with each copy and fails on a mismatch | clear |
| A shared file the probe did not catch (read only on a rare path) | subplan probe + the host audit | EACCES at the call site; §4 says log and degrade | **silent if the caller swallows** |
| Hub's `/etc/beebox/box.env` stale after `/home/beebox/.env` edit without hub restart | no | same as today: env changes need a restart (`docs/server/operations.md`) | clear in docs |
| Two boxes with slugs that collide as usernames (length over 28) | Track E test on the slug→user rule | `add-box.sh` refuses | clear |

> **Critical gap:** a read of shared state on a rare path whose caller
> swallows the error. Mitigation: the subplan's probe runs the box's
> walkthrough tours, a scheduler pass, a package install and a push send as
> the box user and greps the journal for EACCES; the host audit gains an
> EACCES scan of each box's journal for a week after migration. Accepted as
> a documented risk after that week.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-facing vocabulary.
- Stale ref: ADDRESSED. `hub.json` paths are rewritten by the migration in
  one step; a stale path fails the socket provider's readiness with the
  path in the 503.
- Two agents touching the same card: unchanged; admission is per box
  (`admission.ts:55-62`).
- Hand-edit drift: DEFERRED. A hand-edited unit file is overwritten by the
  next deploy; drop-ins remain the way to override, as today.
- Fabricated free-form value: not applicable.
- Validation error UX: ADDRESSED. The hub's 503 names the unit, its state
  and its last journal line.
- Partial migration / transition state: ADDRESSED. The migration runs once,
  for every box, after a snapshot; a hub serves either all-spawned or
  all-socket entries, and refuses a mixed `hub.json` on a host with units.
  Dev machines keep spawned entries and nothing changes for them.

## NOT in scope

- **The pulled engine tree and `RootDirectory=`.** Prod deploys per commit
  by rsync; the tree would make every deploy an image-shaped build. Revisit
  if deploys become daily. Considered 2026-10-24, boxholder's cadence point.
- **Per-box containers.** Decided against for the server (2026-10-24).
- **A sandbox inside a box for tricks** (`2026-09-16-sandboxed-trick-helpers`).
- **Allowed-directories for the agent** (`2026-07-20`).
- **Encryption of dormant boxes** (`2026-08-11`).
- **Rate-limiting anonymous wakes.** A request with a junk bearer can wake
  a box through the pass-through gate; the host sits behind Cloudflare and
  nginx, and a wake is one process start. Revisit if it is observed.
- **The dev router and the Mac app.** Both keep one-process or one-VM
  models; the spawning supervisor survives for them.
- **NixOS or any host OS change.** Discussed and set aside 2026-10-24.
- **Changing the deploy transport** (rsync stays).
- **Multiple hosts.** One hub per host, as today.

## Open design questions

1. **Where bearer verification lives.** The plan moves agent, mobile and
   scan bearer checks for socket-backed boxes into the child and leaves the
   hub reading only world-readable box files, so the hub holds no box
   secret and no group membership. The alternative puts the hub in every
   box group and has the engine write those three files 0640, keeping the
   hub as a pre-filter. Lean: the child; the hub stays a router, and the
   cost is that an unauthenticated bearer can wake a box (NOT in scope
   notes the rate-limit option).
2. **`keepRecent`.** The unit host drops it: an idle box exits and the
   socket wakes it in a few seconds. Keeping it means the hub poking a box
   to stay alive, or a longer `--idle-exit` for chosen boxes. Lean: drop;
   if the cold start hurts, raise `--idle-exit` per box with a drop-in.
3. **`MemoryMax` value.** 1 GB per box on a 4 GB host with 6 boxes assumes
   at most two or three awake. Lean: 1 GB, and measure for a month.
4. **The hub secret per boot in `/run`**, readable by every box user
   through the `beebox-boxes` group. A box cannot use it against a sibling
   (sibling sockets are not connectable by it), so the exposure is a box
   forging the hub's identity header to itself. Lean: accept; the
   alternative is one secret file per box, which is a generated per-box
   env file again.
5. **The apt spool as a new root crossing.** Lean: build it; the wrapper's
   policy is unchanged and the only new code is the path unit and the
   request format.
6. **Agent logins per box** (the subplan's hardest row). Lean in the
   subplan.

## Knowledge audits

Skip: purely infrastructural. Box agents meet no new concept; `bbx host
install` and `bbx tick` behave as before from inside a box.

## What will hold this after it ships

- **Engine behavior** (socket listen, `LISTEN_FDS`, the idle ledger and its
  drain) in `beebox/test/` with `t.check`, the tier that already holds
  `test/hub/supervisor.test.ts`; the idle decision as a pure function from
  (last activity, in-flight, open sockets, live runs, pending schedules,
  now) to keep-or-exit.
- **Hub routing to a socket** in `test/hub/` with a Unix socket stand-in,
  like `staticEndpointProvider` today, including a WS upgrade and the
  `inactive` 503.
- **The units, the wrapper and the spool** in a Docker smoke beside
  `bbx-host-apt.smoke.sh`: systemd in a container, two fixture boxes and
  users, the cross-box read refused, a package request served through the
  spool, a hub-only restart keeping the secret. The filesystem probe the
  issue asks for lives here, since it needs two users.
- **Production drift** by `schedules/cross-box-leak-scan`'s host audit,
  extended to assert each box home is owned by its `bbx-<slug>` user and
  mode 0750, that no `bbx-*` user can read another's home, and that
  `/run/beebox/hub-secret.env` is 0640 `beebox:beebox-boxes`.
- No new test tier; the Docker smoke is an existing one.

## Implementation order

1. Subplan chunk 1: the probe on a throwaway VM (also the first use of
   Track F's cloud-config, packages and users only). Output: the settled
   identity table and the file modes Track D relies on.
2. Track A chunk 1: `--socket` and `LISTEN_FDS`, with its test.
3. Track C chunk 1: the box units and the Docker smoke with two fixture
   boxes.
4. Track B: the identity split per the settled table, engine side.
5. Track A chunk 2: the activity ledger, idle exit and drain.
6. Track D: socket endpoints, the polled provider, bearer pass-through,
   the start-up wake.
7. Track C chunk 2: `bbx-box-run`, the apt spool units and client, the
   hub-secret file.
8. Track E: the scheduler pass; `deploy.sh`, `add-box.sh`; the migration
   script, rehearsed on the throwaway VM with a copy of a test box.
9. Track F: `provision.sh` from `setup-server.sh`, `create-server.sh`
   user-data; a fresh VM provisioned end to end and destroyed.
10. Production migration, by hand, after a snapshot, with the boxholder
    present.

## Rollout shape

**Tests first.** Each engine codepath names its test before it is written
(the idle decision as a pure function; socket serve under a passed fd; the
scheduler pass selection; the spool client). Done-when: change-selected
beebox tests pass; `test/hub/` passes; the Docker smoke passes; the
throwaway VM runs a box as its user, the cross-box read is refused, a
package installs through the spool, and a hub-only restart keeps the box
served.

**Migration approach.** Scripted, atomic per host, one-way after the
snapshot is discarded. Rehearsed on the throwaway VM with the test box
first. Production runs it once, with the boxholder, in a deploy window.

**Knowledge audits.** None.
