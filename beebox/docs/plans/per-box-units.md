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
down. The hub stops spawning and only routes. The host is provisioned by a
cloud-init file instead of a script that never re-runs.

**Issues addressed:**
[cross-box filesystem isolation](../../../issues/features/2026-09-04-cross-box-filesystem-isolation.md)
(resolved by Tracks B and C);
[setup-server.sh is not re-run by deploy](../../../issues/code-quality/2026-08-07-deploy-infra-drift-setup-server-not-rerun.md)
(resolved by Track E: units and the provisioner become versioned files
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
units. About 150 lines. It fails on: the hub then holds a sudo grant to
every box user (a network-facing process that can become any box), the
shared files every child reads today are still shared (the identity subplan
has to be done anyway), and memory stays whatever the hub's idle logic
leaves resident with no per-box limit.

**Chosen design**, tracks A to F:

| Track | Source lines | Test lines |
|---|---|---|
| A. Engine: `bbx engine serve --socket`, idle exit | 120 | 80 |
| B. Identity: shared state split per box (subplan) | 250 | 90 |
| C. Units: template service and socket, `bbx-box-run`, sudoers | 140 (bash, unit files) | 40 (smoke) |
| D. Hub: socket endpoints, no spawning on a unit host | 180 | 120 |
| E. Deploy, add-box, host migration, scheduler through the wrapper | 300 | 60 |
| F. cloud-init provisioner and `create-server.sh` | 120 | 0 (a throwaway VM run) |
| Total | 1110 | 390 |

Authored docs, separate: about 200 lines (`docs/server/`, `deploy/README.md`,
`src/hub/AGENTS.md`). Not a BIG CHANGE, but close to it; Track B is the
part most likely to grow, and the subplan's probe chunk exists to size it
before the rest is built. What the fuller design buys over the smallest
fix: a kernel-enforced boundary with no privileged process in the request
path (the hub never switches users; systemd does), memory proportional to
boxes in use with a per-box ceiling, and one provisioner that `deploy.sh`
keeps current.

## Stated preferences this plan trades against

- `beebox/docs/engineering-principles.md` §4 (resilient and never silent):
  a box that fails to start must say so at the hub's 503 and in its unit's
  journal, not vanish behind a socket that accepts and hangs. Track D's
  readiness wait and `unavailable()` text carry that.
- §6 (right-sized defensiveness) and §8 (one way to do each thing): the
  hub's own supervisor (crash backoff, restart budget, idle timers,
  `keepRecent`) duplicates what systemd does for units. On a unit host the
  hub does not supervise; the spawning supervisor stays for the dev router
  and tests only. Two supervisors is a smell; the plan names which one owns
  production and why the other survives.
- Boxholder decision 2026-10-24: systemd over containers for the server,
  because deploys are many per day and an image build per deploy is a tax;
  rsync stays the deploy path. The pulled engine tree is NOT in scope for
  the same reason.
- Boxholder direction 2026-07-04 and 2026-07-11 (`src/hub/config.ts:64-90`):
  lazy start, idle stop, `keepRecent`. Idle stop moves into the engine
  (Track A); `keepRecent` is dropped, see Open design questions.
- The hub's "Isolation is layered" rule
  (`docs/implemented-plans/boxes-as-packages-v2.md:342-350`): "a box entry
  resolves to an endpoint (spawned child process today; a socket or URL
  owned by a chroot'd process or VM tomorrow), and the routing/auth layer
  only ever sees endpoints." This plan is that tomorrow; routing is not
  touched.
- `bbx-host-apt`'s posture (`deploy/server-bin/bbx-host-apt:1-19`): one
  root code path, plain bash, the whole privilege boundary in one file.
  `bbx-box-run` copies it.
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
  `Endpoint.origin` is a URL string (`endpoints.ts:19-21`). The proxy is
  http-proxy with `ws: true` (`src/hub/server/core.ts:359`); a WS upgrade
  never cold-starts a box (`core.ts:546-556`). Reuse all of it; Track D adds
  a socket-backed provider.
- **Lazy mode and idle stop in the hub.** `Supervisor.ensureRunning`
  (`src/hub/supervisor/core.ts:230`), `evaluateIdle` (`:302-317`), the
  chat-schedule override (`src/hub/AGENTS.md`, "Chat schedules override
  idle-stop": "`evaluateIdle` checks the box's on-disk `chat-schedules.json`
  (via `supervisor/pending-schedules.ts`)"). The idle rule moves into the
  engine (Track A) and reuses `pending-schedules.ts`'s loader.
- **Single-box serve with a slug.** `src/cli/commands/serve.ts:115-119`:
  `--slug` "Only valid with a single box directory — this is how `bbx hub`
  names a box's process". The unit's `ExecStart` is that command plus
  `--socket`.
- **Hub mode in the child.** `src/webapp/auth.ts:161`: `isHubMode()` is
  `!!process.env.BBX_HUB_SECRET`; `app.ts:184-190` returns 404 for login
  "This box is served behind a hub". The unit must carry the hub secret;
  see Track C for how.
- **Child env allowlist.** `src/hub/supervisor/child-env.ts` (fail-closed
  list, `src/hub/AGENTS.md`, "Spawned children get an allowlisted env").
  The unit's `EnvironmentFile` is the same list, written by the hub at
  start (Track C).
- **Readiness check.** `src/hub/supervisor/child-spawn.ts:59-66`:
  `/healthz` with the diag key, else `/api/build-info`, 30 s. Reused over
  the socket.
- **The privilege wrapper pattern.** `deploy/server-bin/bbx-host-apt`
  (root-owned, `bash -p`, re-exec under a clean environment, sudoers
  `beebox ALL=(root) NOPASSWD: /usr/local/sbin/bbx-host-apt`, installed by
  `deploy.sh:805-823`; smoke test `bbx-host-apt.smoke.sh` under Docker).
  `bbx-box-run` is built the same way.
- **The scheduler.** `bbx engine scheduler start`, one process for every
  box, reloads `~/.config/beebox/boxes.json` each cycle and runs `bbx tick`
  per box (`src/core/schedule/scheduler/core.ts:156-299`; `docs/scheduler.md:3`).
  It keeps running; its per-box tick goes through the wrapper (Track E).
- **Per-box migration at deploy.** `deploy.sh:827-837`: `for boxdir in
  /home/beebox/boxes/*/ ... bbx engine migrate --sweep --within-maintenance
  --prepare --json`. Same loop, through the wrapper, over the new box
  paths.
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
  naming and takes the hub as stable.
- **Regression anchors.** `beebox/test/scenarios/cross-box-probe.test.ts`
  (network channel) and `schedules/cross-box-leak-scan/host-audit.ts`
  (modes, per-cwd keying, unknown shared files). The security report's §7b
  channel B is "Accepted for now" (`docs/security-report.md:531`). Track B
  adds the filesystem probe the issue asks for and the host audit asserts
  per-box ownership.

## Prior art (external)

- **systemd socket activation**, adopted: a `.socket` unit starts its
  service on the first connection; the sockets are passed to the service;
  with `Accept=no` one service instance takes every connection
  (<https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html>).
  Node receives the listening socket as fd 3 (`LISTEN_FDS`); Fastify can
  listen on an existing fd through Node's `server.listen({ fd })`. The
  engine must honor `LISTEN_FDS` or, simpler, bind the path itself with the
  socket unit absent; Track A chooses the fd for true wake-on-connect.
- **systemd sandboxing**, adopted: `ProtectSystem=strict` makes the whole
  tree read-only except `ReadWritePaths=`; `ProtectHome=` hides other homes;
  `PrivateTmp=`; `MemoryMax=`
  (<https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html>).
  `DynamicUser=` is evaluated and rejected: it recycles UIDs and warns
  against persistent files under `BindPaths=`, and a box is persistent
  files. `RootDirectory=` is evaluated and deferred (NOT in scope): it needs
  the whole toolchain inside the tree.
- **Hetzner cloud-init**, adopted: the console takes a cloud-config up to
  32 KiB (<https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server>);
  `hcloud server create --user-data-from-file` is the CLI form (hcloud
  documentation; verified on the next VM run, Track F).
- No prior art found for a Node HTTP server exiting on idle under socket
  activation beyond the general pattern; the engine's own idle rule (Track
  A) is written from the hub's existing one.

## Ontology

- **Box user**: the Linux account `bbx-<slug>`, UID from a reserved range,
  home `/home/bbx-<slug>`, owning exactly one box. Identified by the slug.
  Exists as a spec only (`box-user-account-spec.md`); adopted.
- **Box root**: `/home/bbx-<slug>/box`, the one-root box
  (`docs/box-layout.md`). Today `/home/beebox/boxes/<slug>`; moved by Track
  E's migration. The hub's `hub.json` entry keeps `path` pointing here.
- **Box unit**: `beebox-box@<slug>.service` and `beebox-box@<slug>.socket`,
  a template pair; `%i` is the slug. New. systemd owns start, stop,
  restart and limits.
- **Box socket**: `/run/beebox/<slug>.sock`, owned by the socket unit,
  connectable by the hub's user. The endpoint the hub routes to. New.
- **Endpoint**: `src/hub/endpoints.ts:19` today an origin URL; gains
  `socketPath`. Existing noun, extended.
- **Hub user**: `beebox`, running the hub and the scheduler as today. It
  owns nothing inside a box root after migration.
- **`bbx-box-run`**: the one root code path that runs a `bbx` command as a
  box user (`runuser -u bbx-<slug> -- bbx ...`), sudo-allowed for the hub
  user, like `bbx-host-apt`. New.
- **Idle exit**: the engine's own rule for exiting when nothing has used
  it (Track A). Replaces the hub's `evaluateIdle` on a unit host. The
  socket unit keeps listening, so the next connection restarts it.
- **Shared state**: the per-host files in the identity subplan's table.
  Each is assigned to the hub user, to a per-box copy, or to a
  group-readable shared directory; the subplan is the registry.

## Tracks / scope

### Track A: the engine serves a socket and exits when idle

**What.** `bbx engine serve <root> --slug <s> --socket <path>` listens on a
Unix socket, or on the socket systemd hands it (`LISTEN_FDS=1`), and exits
after `--idle-exit <ms>` of no activity, unless a pending chat schedule or a
live chat run keeps it.

**Why.** The unit cannot be socket-activated without the engine accepting
a passed fd, and sleep is impossible without a self-exit: today only the hub
kills an idle child (`supervisor/core.ts:331-350`), and on a unit host the
hub no longer owns the process.

**Direction.** In `src/cli/commands/serve.ts`: `--socket <path>` (mutually
exclusive with `--port`); when `LISTEN_FDS` is set, listen on fd 3 and
ignore `--socket`'s path except for logging. In `src/webapp/server/app.ts`:
`idleExitMs` from `--idle-exit`; the activity signal is the existing
`boxRequestsAreIdle` (`src/webapp/server/box-admission.ts:12-14`) plus open
WebSocket count; the keep rules are the hub's (`src/hub/AGENTS.md`, "Chat
schedules override idle-stop") reusing `supervisor/pending-schedules.ts`'s
loader, moved under `src/core/chat/schedules/` so both can import it. Exit
is the existing clean shutdown (`app.ts:362`), exit code 0, so systemd's
`Restart=on-failure` does not restart it. A WebSocket that is open counts as
activity (the hub's HTTP-only signal is a proxy's limit; the engine knows
better).

**Vocabulary lock-ins.** Flags `--socket`, `--idle-exit`; env `LISTEN_FDS`
honored; the serve-endpoint file (`src/core/serve-endpoint.ts`) records
`{ socket }` instead of `{ port }` when a socket is used.

**First chunk.** `--socket` and `LISTEN_FDS` with a test that starts serve
on a socket and fetches `/api/build-info` through it. No idle logic yet.

### Track B: identity, the shared state split

See [the subplan](per-box-units.subplan.md). Its first chunk is a probe on
a throwaway VM that runs one box as its own user with no other change and
records every shared-file read that fails; the table in the subplan is
settled from that run, not from grep alone.

### Track C: the units and the wrapper

**What.** A template service and socket, a sudo wrapper, and the sudoers
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
WorkingDirectory=/home/bbx-%i/box
EnvironmentFile=/home/beebox/.env.box
EnvironmentFile=/run/beebox/%i.env
ExecStart=/usr/local/bin/bbx engine serve /home/bbx-%i/box --slug %i --socket /run/beebox/%i.sock --idle-exit 1800000
KillMode=mixed
TimeoutStopSec=60
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=5
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/home/bbx-%i /var/cache/beebox/uv
PrivateTmp=yes
MemoryMax=1G
```

`NoNewPrivileges=` is left off: `bbx host install` runs `sudo
/usr/local/sbin/bbx-host-apt` from the box (`src/core/host-packages-system.ts:66-89`),
and the sudoers entry widens from `beebox` to the `bbx-*` users. `ProtectHome=yes`
hides every other home including `/home/beebox`, which is the point; what a
box must read from there moves per the subplan. `/run/beebox/%i.env` holds
the per-box part of the child env (`BBX_HUB_SECRET`, `BBX_SECRETS_FILE`),
written by the hub at its start for every slug in `hub.json`, mode 0640,
group `bbx-%i`; the host-wide part of `child-env.ts`'s allowlist is
`/home/beebox/.env.box`, generated from `/home/beebox/.env` by the same
allowlist so the list stays the one source. `MemoryMax=1G` is a first value
to be measured against the chat-history OOM record
(`docs/implemented-plans/chat-history-oom-mobile-lock.md:10`).

`deploy/server-bin/bbx-box-run`: `bbx-box-run <slug> -- <bbx args>` →
`runuser -u bbx-<slug> -- /usr/local/bin/bbx <args>` with the slug validated
against the `bbx-` user list, a clean environment plus the box env files,
and the caller logged. Sudoers: `beebox ALL=(root) NOPASSWD: /usr/local/sbin/bbx-box-run`.

**Vocabulary lock-ins.** Unit names, the socket path, `/run/beebox/<slug>.env`,
`/home/beebox/.env.box`, `bbx-box-run`.

**First chunk.** The two unit files and a smoke test under Docker that
starts systemd, installs the units for a fixture box, and checks
`curl --unix-socket` answers, with the box's user unable to read a second
fixture box.

### Track D: the hub routes to sockets

**What.** A `hub.json` box entry gains `socket: "/run/beebox/<slug>.sock"`;
a socket-backed `EndpointProvider` whose `ensureRunning` connects (which
starts the unit) and waits for readiness; health and the box picker read
unit state from the socket's answer, not from a child.

**Direction.** `src/hub/endpoints.ts`: `Endpoint` gains `socketPath?:
string`; `src/hub/server/core.ts` passes `{ socketPath }` as the http-proxy
target when present (http-proxy supports it). New `src/hub/supervisor/socket-provider.ts`:
`get` returns the endpoint when a connect succeeds within a short timeout,
`ensureRunning` connects and polls readiness the way `defaultCheckReady`
does (`child-spawn.ts:59-66`) over the socket, `unavailable` reads
`systemctl is-failed beebox-box@<slug>` through `bbx-box-run status` for
the 503 body. The spawning supervisor stays for `hub.json` entries without
`socket` (the dev router and `test/hub/`). A hub with any `socket` entry
refuses `lazy`, `idleMs` and `keepRecent` as config errors: the unit host
owns those.

**First chunk.** `socketPath` on `Endpoint` and the proxy target, with
`test/hub/` routing through a Unix socket stand-in server.

### Track E: deploy, add-box, the scheduler, and the host migration

**What.** `deploy.sh` stops and starts box units instead of relying on the
hub restart, converges each box through `bbx-box-run`, installs the units
and sudoers; `add-box.sh` creates the user and home, clones into
`/home/bbx-<slug>/box`, enables the socket; the scheduler runs each box's
tick through the wrapper; a one-time migration moves the six boxes.

**Direction.**

- `deploy.sh`: during the deploy window `systemctl stop 'beebox-box@*.socket'
  'beebox-box@*.service'` (so a request cannot wake a box onto a half-copied
  tree), rsync and install as today, converge with
  `sudo bbx-box-run <slug> -- engine migrate --sweep --within-maintenance
  --prepare --json` per slug from `hub.json`, install units and sudoers,
  `systemctl start 'beebox-box@*.socket'`, restart hub and scheduler.
- `add-box.sh`: `useradd --system --uid <next in 2000–2999> -m -d
  /home/bbx-<slug> -s /bin/bash bbx-<slug>`, clone and `bbx engine init`
  as that user through the wrapper, `bbx engine secrets copy-grants` into
  the box's own store (subplan), `hub add-box <slug> <path> --socket`,
  `systemctl enable --now beebox-box@<slug>.socket`.
- Scheduler: `src/core/schedule/scheduler/core.ts`'s per-box tick spawns
  `sudo bbx-box-run <slug> -- tick` when the wrapper exists, else `bbx tick`
  as today (the dev machine). The aggregated `scheduler-stderr.log` becomes
  per box under the box user's home, which also closes the host audit's
  `checkSharedLogs` finding.
- Migration `deploy/server-bin/migrate-to-box-users.sh`, run once by hand
  after a Hetzner snapshot: for each `hub.json` slug create the user, `mv
  /home/beebox/boxes/<slug> /home/bbx-<slug>/box`, `chown -R`, split the
  shared state per the subplan, rewrite `hub.json` paths and add `socket`,
  rewrite `boxes.json`, enable the sockets. Reversible until the first
  deploy after it: the snapshot is the rollback.

**First chunk.** The scheduler change with its test (wrapper present →
spawns through it), because it is the only engine code in this track.

### Track F: cloud-init provisioning

**What.** `deploy/hetzner/cloud-init.yaml`, a `#cloud-config` that creates
the `beebox` user, installs the apt packages `setup-server.sh:30` lists,
Node 24, uv, fclones, Claude Code, nginx, and runs a versioned
`deploy/hetzner/provision.sh` fetched from the repo at a pinned ref for
the parts cloud-config cannot express (unit install, sudoers, the hub's
env file skeleton). `create-server.sh` passes `--user-data-from-file`.
`setup-server.sh` becomes that `provision.sh`, trimmed to what runs after
packages, and `deploy.sh` keeps installing units and sudoers so the drift
issue closes.

**First chunk.** The cloud-config with packages and users only, run on a
throwaway VM, then destroyed; the run log is the verification.

## Could this be simpler?

**Simplest version:** the smallest fix above. It fails on a network-facing
hub holding a sudo grant to every box user, and on leaving the shared files
shared, which is the issue's actual complaint.

**Units without socket activation**: the hub starts and stops units through
the wrapper and keeps its idle logic. Simpler for the engine (no fd
handling, no idle exit) and it keeps `keepRecent`. It fails on the hub
needing sudo on the request path (a cold start is a request), and on two
idle rules in two processes with the one in the proxy knowing less. Socket
activation makes the hub a pure router; that is what the plan buys for
Track A's 200 lines.

**One scheduler timer per box** instead of the scheduler through the
wrapper: no sudo for the scheduler, a node boot per box per minute. Rejected
for the per-minute cost on a 4 GB host and for throwing away the scheduler's
load-gating; the wrapper is one sudoers line.

**Skip cloud-init, keep `setup-server.sh`**: smaller, and the drift issue
stays open. Track F is 120 lines and the provisioner was the boxholder's
stated annoyance.

**Dropped as over-build:** `RootDirectory=`/the pulled engine tree (NOT in
scope); per-box containers; `DynamicUser=`; a GitHub-side anything.

## Subplans

[per-box-units.subplan.md](per-box-units.subplan.md): the identity split,
one row per shared file, with its probe chunk first.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Box unit fails to start (bad env file, migration parked the entrypoint) | Track C smoke | systemd `Restart=on-failure`, start limit; hub 503 with `unavailable()` text from unit state | clear |
| Socket accepts, service hangs before listening on the fd | no | Track D readiness timeout 30 s then 503 "box/<slug> did not answer" | clear |
| Idle exit while a WebSocket chat is open | Track A test (open WS keeps alive) | Track A counts open sockets as activity | clear |
| Idle exit with a pending chat schedule | Track A test | Track A keep rule (reuses the hub's) | clear |
| Idle exit races a request: exit begins, socket unit queues the connection, service restarts | no | systemd keeps the listening socket; the connection waits for the new instance; the engine's shutdown stops accepting first (`app.ts:362` path) | clear, a slow response |
| `MemoryMax` reached: the box is OOM-killed alone | no | `Restart=on-failure`; the journal records the kill; hub 503 meanwhile | clear |
| Deploy window: a request arrives while units are stopped | existing deploy page via nginx `@hub_unreachable` | sockets stopped too, so nothing wakes onto a half-copied tree | clear |
| `bbx-box-run` given a slug with no user | Track C smoke | refuses, exit 2 | clear |
| Scheduler tick as the wrong user (wrapper missing on a host that has box users) | Track E test | tick fails with EACCES on the box root; the scheduler logs per box | clear |
| Migration script interrupted mid-move | no | run after a snapshot; idempotent per slug (skips a slug whose home exists and box is absent only after checking the old path is gone) | clear, needs a person |
| A shared file the probe did not catch (read only on a rare path) | subplan probe + the host audit | EACCES at the call site; §4 says log and degrade | **silent if the caller swallows** |
| Hub's generated `/run/beebox/<slug>.env` stale after `hub.json` edit without hub restart | no | same as today: `hub.json` needs a hub restart (`src/hub/AGENTS.md`, "SIGHUP only clears") | clear in docs |
| Two boxes with slugs that collide as usernames (`a-b` vs `a_b` is not a collision; length over 28) | Track E test on the slug→user rule | `add-box.sh` refuses | clear |

> **Critical gap:** a read of shared state on a rare path whose caller
> swallows the error. Mitigation: the subplan's probe runs the box's
> walkthrough tours and a scheduled tick as the box user and greps the
> journal for EACCES; the host audit gains an EACCES scan of each box's
> journal for a week after migration. Accepted as a documented risk after
> that week.

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
- Validation error UX: ADDRESSED. The hub's 503 names the unit and its
  last journal line.
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
- **The dev router and the Mac app.** Both keep one-process or one-VM
  models; the spawning supervisor survives for them.
- **NixOS or any host OS change.** Discussed and set aside 2026-10-24.
- **Changing the deploy transport** (rsync stays).
- **Multiple hosts.** One hub per host, as today.

## Open design questions

1. **`keepRecent`.** The unit host drops it: an idle box exits and the
   socket wakes it in a few seconds. Keeping it means the hub poking a box
   to stay alive, or a longer `--idle-exit` for chosen boxes. Lean: drop;
   if the cold start hurts, raise `--idle-exit` per box with a drop-in.
2. **`MemoryMax` value.** 1 GB per box on a 4 GB host with 6 boxes assumes
   at most two or three awake. Lean: 1 GB, and measure for a month.
3. **Box user UIDs.** The spec's 2000–2999 range by convention, or
   `useradd --system` picking. Lean: the fixed range; the host audit can
   assert it.
4. **Agent logins per box** (the subplan's hardest row): one login per box
   user, or a shared credentials file. Lean in the subplan.

## Knowledge audits

Skip: purely infrastructural. Box agents meet no new concept; `bbx host
install` and `bbx tick` behave as before from inside a box.

## What will hold this after it ships

- **Engine behavior** (socket listen, `LISTEN_FDS`, idle exit and its keep
  rules) in `beebox/test/` with `t.check`, the tier that already holds
  `test/hub/supervisor.test.ts`; idle rules as a pure function from
  (last activity, open sockets, pending schedules, now) to keep-or-exit.
- **Hub routing to a socket** in `test/hub/` with a Unix socket stand-in,
  like `staticEndpointProvider` today.
- **The units and the wrapper** in a Docker smoke beside
  `bbx-host-apt.smoke.sh`: systemd in a container, two fixture boxes, the
  cross-box read refused. The filesystem probe the issue asks for lives
  here, since it needs two users.
- **Production drift** by `schedules/cross-box-leak-scan`'s host audit,
  extended to assert each box root is owned by its `bbx-<slug>` user and
  mode 0700, and that no `bbx-*` user can read another's home.
- No new test tier; the Docker smoke is an existing one.

## Implementation order

1. Subplan chunk 1: the probe on a throwaway VM (also the first use of
   Track F's cloud-config, packages and users only). Output: the settled
   identity table.
2. Track A chunk 1: `--socket` and `LISTEN_FDS`, with its test.
3. Track C chunk 1: units and the Docker smoke with two fixture boxes.
4. Track B: the identity split per the settled table, engine side.
5. Track A chunk 2: idle exit and keep rules.
6. Track D: socket endpoints in the hub.
7. Track E: scheduler through the wrapper; `deploy.sh`, `add-box.sh`; the
   migration script, rehearsed on the throwaway VM with a copy of a test
   box.
8. Track F: `provision.sh` from `setup-server.sh`, `create-server.sh`
   user-data; a fresh VM provisioned end to end and destroyed.
9. Production migration, by hand, after a snapshot, with the boxholder
   present.

## Rollout shape

**Tests first.** Each engine codepath names its test before it is written
(the idle rule as a pure function; socket serve; scheduler wrapper
selection). Done-when: change-selected beebox tests pass; `test/hub/`
passes; the Docker smoke passes; the throwaway VM runs a box as its user
and the cross-box read is refused.

**Migration approach.** Scripted, atomic per host, one-way after the
snapshot is discarded. Rehearsed on the throwaway VM with the test box
first. Production runs it once, with the boxholder, in a deploy window.

**Knowledge audits.** None.
