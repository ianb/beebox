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
| C. Units: template service and socket, `bbx-box-run` | 150 (bash, unit files) | 50 (smoke) |
| D. Hub: socket endpoints, unit state by polling, bearer checks in the child | 240 | 140 |
| E. Deploy, add-box, the scheduler pass per box, host migration | 340 | 80 |
| F. cloud-init provisioner and `create-server.sh` | 120 | 0 (a throwaway VM run) |
| Total | 1260 | 460 |

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
  `bbx-box-run` copies it and does not widen what root does.
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
  cannot survive a read-only filesystem view (Track C records the package
  instead; the deploy installs it).
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
- **Box home**: `/var/lib/beebox/<slug>`, mode 0751, group `bbx-<slug>`:
  traversable by path, not listable, so the hub can read the one file the
  box publishes for it and nothing it does not know the name of. Inside a
  box unit the sibling homes do not exist at all (Track C's view). Holds
  the box root and the box user's own config and caches (`.claude`,
  `.codex`, `.config/beebox`, `.local/share/beebox`), all 0700.
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
- **Hub user**: `beebox`, running the hub. It owns nothing inside a box
  home after migration, is a member of no box group, holds no sudo grant,
  and reads exactly one file per box, the hub metadata file. New
  separation: the scheduler runs as its own user (next noun).
- **Scheduler user**: `beebox-sched`, running the scheduler daemon, the
  only account with a sudo grant to `bbx-box-run`. New.
- **Hub metadata file**: `<box root>/.beebox/hub-meta.json`, 0644, with
  the box root and `.beebox/` kept 0751 by the engine when it writes the
  file (the home is 0751 too), so the hub can reach it by path without
  listing anything; the engine's other `.beebox/` files stay 0600. Written
  by the engine whenever its inputs change: `allowedEmails` (from
  `_config/box.json`), whether `chat-schedules.json` holds a pending
  schedule, and SHA-256 hashes of the box's agent token, mobile device
  tokens and scan tokens. No secret in it; the hub verifies a presented
  bearer by hashing it. New. Replaces the hub's reads of the box's 0600
  files.
- **Hub secret**: `BBX_HUB_SECRET`, today minted per hub start
  (`hub.ts:123`) and shared by every child; becomes one per box,
  `/run/beebox/<slug>.secret.env`, written once per host boot by the first
  hub start for each slug, read by later hub starts and by that box's
  unit only (boxholder decision 2026-10-24: no secret shared across
  boxes). Same noun, one per box.
- **`bbx-box-run`**: the one root code path that starts a box's scheduler
  pass unit (`systemctl start --wait beebox-pass@<slug>`), sudo-allowed
  for the scheduler user only. New.
- **Pass unit**: `beebox-pass@<slug>.service`, a oneshot template with the
  box unit's sandbox block, running `bbx engine scheduler pass` as the box
  user inside the same filesystem view. New.
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
connections), wait for in-flight to reach zero with no bound (a request
accepted before the listener closed is never cut; the engine's own request
timeouts bound it), then the existing clean shutdown (`app.ts:362`), exit
code 0 so `Restart=on-failure` does not restart it. A connection that
arrives after the listener closed is held by systemd's listening socket and
served by the next instance. `TimeoutStopSec` applies only to a stop the
deploy asks for.

**Vocabulary lock-ins.** Flags `--socket`, `--idle-exit`; env `LISTEN_FDS`
honored (and cleared from the engine's env, as `sd_listen_fds(3)` does, with
`LISTEN_PID` checked); the serve-endpoint file (`src/core/serve-endpoint.ts`)
gains `socket` and makes `publicUrl` optional. Implementation note
2026-10-24: a socket has no URL, so a box's own subprocesses
(`BBX_SERVER_URL`, read by `bbx notify` and the chat verbs) are pointed at
`BBX_PUBLIC_URL/<slug>`, the hub's front door, which verifies the agent
bearer and proxies back to the socket; with no `BBX_PUBLIC_URL` the engine
publishes no URL and says so once at startup. On TCP nothing changes.

**First chunk.** `--socket` and `LISTEN_FDS`, with a test that starts serve
under a parent that passes a listening Unix socket as fd 3 and fetches
`/api/build-info` through it. No idle logic yet.

**Implementation notes (2026-10-24).** The ledger counts on Node's raw
`request` and `upgrade` events (`src/webapp/server/idle-exit.ts`), not
Fastify hooks: a hook cannot be added once the instance listens, and the
raw events sit beside Fastify's and @fastify/websocket's own listeners. The
idle check runs every 15 s or every `--idle-exit` ms, whichever is shorter.
The hub secret reaches a unit as a systemd credential and becomes
`BBX_HUB_SECRET` in `bbx engine serve` before the env is validated
(`src/lib/systemd-credentials.ts`; Track C says why a credential).

### Track B: identity, the shared state split

See [the subplan](per-box-units.subplan.md). Its first chunk is a probe on
a throwaway VM that runs one box as its own user under Track C's unit with
no other change and records every failed read; the table in the subplan is
settled from that run, not from grep alone.

### Track C: the units and the wrapper

**What.** A template service and socket, a sudo wrapper for the scheduler,
and the sudoers entry, as versioned files under `deploy/systemd/` and
`deploy/server-bin/` that `deploy.sh` installs.

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
EnvironmentFile=/run/beebox/%i.secret.env
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
ReadWritePaths=/var/lib/beebox/%i /var/cache/beebox/uv
PrivateTmp=yes
NoNewPrivileges=yes
MemoryHigh=1G
MemoryMax=2G
```

The sandbox block (from `ProtectSystem=` to `MemoryMax=`) lives in
`deploy/systemd/box-sandbox.conf` and is included by the box unit and the
pass unit, so every box process runs in the same view.
`TemporaryFileSystem=/var/lib/beebox:ro` with `BindPaths=/var/lib/beebox/%i`
shows the box only its own home among the boxes: a sibling's home does not
exist in the view, whatever its mode. Outside any unit the homes are 0751
with 0700 contents, so a path can be traversed to a world-readable file
(the hub metadata file) and nothing else. `ProtectHome=yes`
hides `/home/beebox` and every human home. `NoNewPrivileges=yes` is on
because the box no longer runs `sudo`: a read-only filesystem view would
make `bbx-host-apt` fail inside the unit's namespace whatever its
privilege, so on a unit host `bbx host install` only records the package
(the record already exists, `_config/host-packages.json`,
`src/core/host-packages.ts:22`) and tells the agent it arrives at the next
deploy; `deploy.sh` runs `bbx host sync` for every box as root, which calls
`bbx-host-apt` directly. Boxholder decision 2026-10-24: package installs
are a minor feature and get no new privileged path.
`/etc/beebox/box.env` is the non-secret host-wide part of `child-env.ts`'s
allowlist, generated by the hub from `/home/beebox/.env` with that list
(the list stays the one source); `/run/beebox/<slug>.hub-secret` holds that
box's hub secret, written by the first hub start of the boot for each slug
in `hub.json` into `/run/beebox` (a tmpfiles.d directory, `0775 root:beebox`,
so a hub-only restart reads the files back instead of minting new ones),
mode 0600, owner `beebox`. The unit loads it with
`LoadCredential=hub-secret:/run/beebox/%i.hub-secret`: the service manager
reads the file as root and exposes it to that box alone under
`$CREDENTIALS_DIRECTORY`, where the engine reads it into `BBX_HUB_SECRET`
(`src/lib/systemd-credentials.ts`). Implementation correction 2026-10-24:
the plan first said a 0640 file with group `bbx-<slug>`, but the hub user
is in no box group and a non-root process cannot `chgrp` a file to a group
it does not belong to; a credential needs no group. The hub keeps one secret
per slug in memory and injects the matching one when it proxies to that box. The box-specific env (`BBX_SECRETS_FILE`, `CLAUDE_CONFIG_DIR`,
`CODEX_HOME`, the push store) is not an env file: the paths are derived
from the box home in the subplan's chunk 2, so the unit needs no per-box
generated file. `UMask=0007` (implementation addition; first 0077): every file a box writes is its own,
so a file at the top of a 0751 box root (`package.json`, `AGENTS.md`) is not
readable by path from a sibling; the engine sets the three hub-readable
modes by hand. The group bit stays open because a box's own group has one
member, while what a box writes into the shared uv and Docling caches takes
the cache's setgid group and must stay usable by its siblings: under 0077 the
probe VM's second box could not open the first box's cache entries. The
Docling model cache is writable for the same reason (Docling fetches a model
the prefetch did not name), and the box unit kills its whole cgroup on stop
(`KillMode=control-group`): with `mixed`, a Claude Code subprocess alive when
the engine exited was left running. `MemoryHigh=1G` throttles and logs; `MemoryMax=2G` kills. The limits cover
every process in the unit's cgroup: the engine, the Claude Code
subprocess, and `uvx docling` during a scan. Values are a first guess
against the chat-history OOM record
(`docs/implemented-plans/chat-history-oom-mobile-lock.md:10`), to be
measured for a month (boxholder: 1 GB "seems a bit tight").

```ini
# deploy/systemd/beebox-pass@.service
[Service]
Type=oneshot
User=bbx-%i
Group=bbx-%i
WorkingDirectory=/var/lib/beebox/%i/box
EnvironmentFile=/etc/beebox/box.env
ExecStart=/usr/local/bin/bbx engine scheduler pass /var/lib/beebox/%i/box
.include box-sandbox.conf
```

`deploy/server-bin/bbx-box-run`: `bbx-box-run <slug> scheduler-pass` →
`systemctl start --wait beebox-pass@<slug>.service`, and no other
operation; the slug is validated against the `bbx-` users; the caller is
logged. Sudoers: `beebox-sched ALL=(root) NOPASSWD: /usr/local/sbin/bbx-box-run`.
The hub user has no sudoers entry at all; the scheduler daemon runs as
`beebox-sched` (Track E). Root (the deploy) runs its per-box converge
through the same pass unit's sandbox with `systemd-run --uid bbx-<slug>
-p ... bbx engine migrate ...`, or directly as root when the sandbox is in
the way of a migration repair, which the deploy already does today for
everything.

**Vocabulary lock-ins.** Unit names (`beebox-box@`, `beebox-pass@`),
`box-sandbox.conf`, the socket path, `/etc/beebox/box.env`,
`/run/beebox/<slug>.secret.env`, group `beebox-boxes` (now only the
shared cache's group), user `beebox-sched`, `bbx-box-run <slug>
scheduler-pass`, `.beebox/hub-meta.json`.

**First chunk.** The two box unit files and a smoke test
(`deploy/server-bin/box-units.smoke.sh`) that, on a throwaway systemd host
with the units installed, makes two fixture boxes with two users, starts one
through `curl --unix-socket`, and checks from inside the first box's unit
(`systemd-run --uid` with the sandbox drop-in's properties) that the second
box's home is absent from the view and unreadable by path. Implementation
correction 2026-10-24: the development machine has no Docker, so the smoke
runs on the probe VM (a real systemd, which is also what `TemporaryFileSystem=`
and `LoadCredential=` need to be proven on) instead of in a container.

### Track D: the hub routes to sockets and reads no secret from a box

**What.** A `hub.json` box entry gains `socket: "/run/beebox/<slug>.sock"`;
a socket-backed `EndpointProvider` whose synchronous `get()` reflects
polled unit state, whose `ensureRunning` connects (which starts the unit)
and waits for readiness, and whose `unavailable()` quotes a cached unit
state; the hub's bearer gates and its box listing read the box's hub
metadata file instead of the box's secret files.

**Why.** The hub reads a box's 0600 files today (`core.ts:462-466`,
`token.ts:55`) and its mobile `/api/boxes` listing verifies a device
credential against every box (`core.ts:132`); a hub outside the box's
group cannot read those, and putting the hub in every box group would make
it a reader of every box, which the plan is removing. Passing bearers
through to the child was considered and rejected (review round 2): a junk
bearer would wake a sleeping box and the listing cannot be passed through.
Hashes in a file the box publishes let the hub keep its gate and its
listing without a secret. A `get()` that connected would wake a sleeping
box on a WebSocket reconnect, which `core.ts:546-556` exists to prevent.

**Direction.** `src/hub/endpoints.ts`: `Endpoint` gains `socketPath?:
string`; `src/hub/server/core.ts` passes `{ host: "localhost", port: 0,
socketPath }` as the proxy target when present. New
`src/hub/socket-provider.ts`: one poll every 2 s of `systemctl
list-units 'beebox-box@*' --output=json` (one process for all boxes,
unprivileged, read-only), kept in a map with the last readiness result;
for a unit the poll sees as `failed`, the same cycle fetches its last
journal line once (`journalctl -u ... -n 1`, the hub user in
`systemd-journal`) into the cache, so `unavailable()` stays synchronous and
never runs a command on the request path. `get` returns the endpoint only
when the map says active and ready; at provider start every unit already
active is readiness-checked once over its socket (an active unit is not
woken by that), so a hub-only restart does not refuse WebSockets to a
running box. `ensureRunning` (HTTP only, as today) connects to the socket,
waits for `/api/build-info` (or `/healthz` with the diag key) over it with
the 30 s bound, then marks ready. At hub start the provider wakes, with one
GET, every box whose hub metadata says it holds a pending schedule, so
check-ins re-arm after a reboot. The hub's gates read
`<box root>/.beebox/hub-meta.json` (Ontology): `hasMobileAuth`,
`hasScanAuth` and the agent-bearer check compare SHA-256 of the presented
bearer with the file's hashes, `canAccessBox` and the mobile `/api/boxes`
listing read `allowedEmails` and the hashes from it; the engine writes the
file on `bbx engine init`, on every token mint or revoke
(`src/core/token-store.ts`, `src/core/agent/token.ts`,
`src/core/mobile/pairing.ts`), on `_config/box.json` change, and when
`chat-schedules.json` changes (a mirror of what the hub reads today, with
hashes in place of secrets). The hub reads the file at each gate with a
one-second mtime cache. The session-cookie wall stays in the hub as today. A hub with any `socket` entry refuses `lazy`, `idleMs` and
`keepRecent` as config errors: the unit host owns those. The spawning
supervisor stays for entries without `socket` (the dev router and
`test/hub/`).

**Vocabulary lock-ins.** `socket` on a `hub.json` entry; `Endpoint.socketPath`;
the provider's state names mirror systemd's (`active`, `inactive`,
`activating`, `failed`); `hub-meta.json` with fields `allowedEmails`,
`pendingSchedules`, `tokenHashes: { agent, mobile: [], scan: [] }`,
`writtenAt`.

**Implementation notes (2026-10-24).** The hub reads boxes through their
metadata behind one process-wide switch, `enableHubMetaReads()` in
`core/hub-meta.ts`, flipped by `bbx engine hub` on a unit host before it
serves; `canAccessBox` and the three bearer gates
(`hub/server/box-credentials.ts`) consult it, so the dev router's spawning hub
and the tests keep direct reads. The writer hooks are the two token stores'
save, the agent token mint, `mutateConfig`, the chat schedule manager's save,
`bbx engine init`, and `bbx engine serve` at start; the file is rewritten
only when something but the timestamp changed, so a `lastUsedAt` stamp costs
no write. `hub-meta.ts` counts the schedule file's entries itself rather than
importing the schedules loader, which imports it back. `/etc/beebox/box.env`
is written by the hub user into a `2775 root:beebox-boxes` directory (the hub
joins the cache group, no box group) and is `0640`.

**First chunk.** `socketPath` on `Endpoint` and the proxy target, with
`test/hub/` routing HTTP and a WebSocket through a Unix socket stand-in
server on the pinned http-proxy-3, and a 503 with the `unavailable` text
for a failed stand-in. Second chunk: the hub metadata writer in the engine
with its test (every input change rewrites the file; no secret in it), then
the hub's readers.

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
  slug from `hub.json`, run `bbx host sync --box <root>` per box as root (the recorded
  packages a box asked for since the last deploy), install units and
  sudoers, write `/etc/beebox/box.env`, `systemctl start
  'beebox-box@*.socket'`, restart hub and scheduler.
- `add-box.sh`: `groupadd beebox-boxes` and `useradd --system beebox-sched`
  once; `useradd --system --uid <next free in 2000–2999> -g bbx-<slug> -G
  beebox-boxes -d /var/lib/beebox/<slug> -m -s /bin/bash bbx-<slug>`;
  `chmod 0751` the home; clone
  and `bbx engine init` as that user with `runuser`; `bbx engine secrets
  copy-grants` into the box's own store and verify the copy (subplan);
  `hub add-box <slug> <path> --socket`; `systemctl enable --now
  beebox-box@<slug>.socket`.
- Scheduler: the per-box body of `src/core/schedule/scheduler/core.ts:190-280`
  (admission, dirty check, heartbeat, growth, tick, box log) becomes
  `bbx engine scheduler pass <boxRoot>`, run in process on a dev machine
  and through `sudo bbx-box-run <slug> scheduler-pass` on a unit host
  (selected by the wrapper's presence), which runs it inside the pass unit
  as the box user. The daemon's unit `beebox-scheduler.service` gets
  `User=beebox-sched`, a system user with no box group and the one sudoers
  line; its manifest moves to `/etc/beebox/boxes.json`. The daemon keeps fleet concerns
  (the interval, the dev-bundle restart, load gating). Each box's log and
  heartbeat land under the box home; the aggregated
  `scheduler-stderr.log` goes away, which closes the host audit's
  `checkSharedLogs`.
- Migration `deploy/server-bin/migrate-to-box-users.sh`, run once by hand
  after a Hetzner snapshot: for each `hub.json` slug create the group and
  user, `mv /home/beebox/boxes/<slug> /var/lib/beebox/<slug>/box`, `chown
  -R`, `chmod 0751` the home and 0700 its dot-directories, split the shared state per the subplan and
  verify each copy, rewrite `hub.json` paths and add `socket`, rewrite
  `boxes.json`, enable the sockets. Idempotent per slug: a slug whose home
  exists and whose old path is gone is skipped. The snapshot is the
  rollback until the first deploy after it.

**First chunk.** `bbx engine scheduler pass` extracted with its test (the
daemon calls it in process; with the wrapper present it spawns through
`sudo`), because it is the only engine code in this track.

**Implementation notes (2026-10-24).** The pass is
`src/core/schedule/scheduler/pass.ts`, re-exported through the scheduler's
`core.ts`; the wrapper selector and runner are `box-run.ts` beside it. The
scheduler user's manifest stays at `~/.config/beebox/boxes.json` under
`/var/lib/beebox-sched` (the subplan says why). Two engine verbs exist for the
split: `bbx engine secrets export-box <slug>` (a box's share of the master
store, values included, verified by grant names in both scripts) and `bbx
engine boxes export-push <slug>`. `deploy.sh` detects a unit host by the
presence of `/var/lib/beebox/*/box` and runs both layouts' loops;
`add-box.sh` detects it on the server (`/var/lib/beebox` plus the
`beebox-sched` user) and caps a box name at 28 characters, the user name's
limit. The migration script is `deploy/server-bin/migrate-to-box-users.sh`
with `--dry-run`; it also gives the scheduler unit a `user.conf` drop-in
(`User=beebox-sched`, `EnvironmentFile=/etc/beebox/box.env`) and copies each
box's deploy key and ssh alias into the box user's home so pushes keep
working. `bbx host install` under a unit (`BBX_UNIT_HOST=1` from
`box.env`, allowlisted into agent shells) records and exits 0 with the
"next deploy installs it" line.

**Found on the VM (2026-10-24).** The first deploy against a freshly
provisioned host failed in the maintenance controller
(`src/cli/commands/maintenance`): it refused a host with no box, and its
identity model, one `seteuid` to "the" box owner for the whole fleet, refused a
fleet whose boxes have different owners, which every unit host has. The plan's
"per-user ownership does not change it" was wrong for the controller. The
controller now groups boxes by owner and spawns one holder per owner
(`hold.ts`, `bbx engine maintenance hold <roots>`) as that owner, with a
newline-JSON protocol on its stdio: the holder closes, drains, snapshots and
reports permits; the controller runs the activation as root with every
permit, verifies each box (phase `ready` and the hub canary, reading the hub's
config at `--hub-config`, which `deploy.sh` passes), and names the boxes each
holder completes. EOF on the holder's stdin releases its boxes, so a dead
controller cannot leave a box held. A host with no box runs the activation
alone. The spawning layout runs one holder as `beebox`, the same protocol.

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

**Implementation notes (2026-10-24).** `cloud-init.yaml` installs the
packages, Node 24, uv (system-wide, `/usr/local/bin`), fclones and Claude
Code (the native binary copied to `/usr/local/bin/claude`, since a per-user
install under `/root` or `/home` is hidden from units by `ProtectHome=`),
creates `beebox` (in `beebox-boxes`), `beebox-sched` and the group, and the
tmpfiles rules and a first `/etc/beebox/box.env`. `provision.sh` does the
remaining root steps (host keys, git identity, the hub `.env` skeleton,
Claude retention, the nightly updater, now as root, re-copying the binary;
the Docling pre-fetch into `HF_HOME=/var/cache/beebox/hf`). The old
`setup-server.sh` is a stub that exits 1. The deploy installs every unit and
sudoers file, which is what closes the drift issue. Not yet run on a VM.

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

**The hub in every box group** instead of the hub metadata file: no new
file, 80 fewer engine lines. It fails on the hub becoming a reader of
every box's secret files, and on 0600 files (the agent token) staying
unreadable anyway. **Bearer pass-through to the child** instead of hashes:
no hashes, but a junk bearer wakes a sleeping box and the mobile listing
across boxes has nothing to read (review round 2). The metadata file is
the smallest thing that keeps the hub's gates and listing without a
secret.

**Keep `sudo bbx-host-apt` from inside the box** and drop `ProtectSystem`:
it fails on the whole point of `ProtectSystem=strict` (an agent inside a
box writing host paths). A root path-unit spool was designed and cut
(boxholder, 2026-10-24: a minor feature, no great lengths); recording the
package and installing at the next deploy is the smallest version.

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
| Idle exit while a long GET is in flight | Track A test (in-flight request keeps alive, drain waits) | the ledger counts every request; the drain waits for it, with no deadline | clear |
| Idle exit with a pending chat schedule | Track A test | keep rule (reuses the hub's loader) | clear |
| Idle exit races a connection: listener closed, systemd queues it, the next instance serves it | Track A test (connect during drain) | socket activation semantics | clear, a slow response |
| Reboot with pending chat schedules | Track D test (provider wakes schedule holders at start) | Track D start-up wake | clear |
| Hub-only restart: units keep the hub secret from the previous hub | Track C smoke (restart hub, request still proxied) | the per-box secrets live in `/run/beebox/<slug>.secret.env`, read back by the new hub | clear |
| WebSocket reconnect to a sleeping box | `test/hub/` WS path with an `inactive` map entry | `get()` returns undefined from the polled map; 503 as today | clear |
| Hub-only restart, WebSocket to a running box | Track D test (active unit seeded ready at provider start) | the start-up readiness pass | clear |
| Hub metadata file stale (the engine failed to rewrite it after a token mint) | Track D writer test | the bearer is refused at the hub with "unknown credential for box"; the box's own wall would have accepted it; the hub logs the hash miss per box | clear, needs a person if persistent |
| Hub metadata file tampered by the box (the box owns it) | no | a box can only widen or narrow access to itself; `allowedEmails` in it is the same list the box owns in `_config/box.json` today | accepted, same trust as today |
| Junk bearer against a sleeping box | Track D test | refused at the hub by hash; the box is not woken | clear |
| Poll says active, unit exits before the WS upgrade reaches it | no | the upgrade fails, the client reconnects, the next `get()` sees inactive | clear |
| `MemoryMax` reached: the box is OOM-killed alone | no | `Restart=on-failure`; the journal records the kill; hub 503 meanwhile | clear |
| Deploy window: a request arrives while units are stopped | existing deploy page via nginx `@hub_unreachable` | sockets stopped too, so nothing wakes onto a half-copied tree | clear |
| `bbx-box-run` given a slug with no user, or an operation not in the set | Track C smoke | refuses, exit 2 | clear |
| Scheduler pass as the wrong user (wrapper missing on a host that has box users) | Track E test | the pass fails on the box root with EACCES; the daemon logs per box | clear |
| A box asks for a package and no deploy happens for days | no | `bbx health` shows the recorded package missing (`src/cli/commands/host.ts`); the agent was told it arrives at the next deploy | clear |
| Scheduler pass needs sudo and the daemon runs as the wrong user | Track E test on the daemon's user check | `bbx-box-run` logs and refuses a caller other than `beebox-sched` (sudoers already does) | clear |
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
- **Rate-limiting anonymous wakes.** With the hub verifying bearers by
  hash, an unauthenticated request never wakes a box; a valid session
  cookie or bearer does, as today.
- **The dev router and the Mac app.** Both keep one-process or one-VM
  models; the spawning supervisor survives for them.
- **NixOS or any host OS change.** Discussed and set aside 2026-10-24.
- **Changing the deploy transport** (rsync stays).
- **Multiple hosts.** One hub per host, as today.

## Open design questions

One open (6, settled by the probe); the rest were settled by the boxholder on
2026-10-24 and are kept here as the record.

1. **The hub's view of a box: one published file.** Decision: the engine
   publishes `.beebox/hub-meta.json` and the hub reads only that, holding
   no box secret and no group membership. The trust point: the box writes
   it, so a box can mis-state its own ACL, which it can already do in
   `_config/box.json`.
2. **`keepRecent`.** Decision: drop; an idle box exits and the socket
   wakes it in a few seconds. If a cold start hurts, raise `--idle-exit`
   per box with a drop-in.
3. **Memory limits.** Decision: `MemoryHigh=1G`, `MemoryMax=2G`, covering
   the engine, the agent subprocess and Docling together; measure for a
   month. The boxholder found 1 GB as a hard limit tight.
4. **The hub secret.** Decision: one per box in `/run`, readable by that
   box only; nothing shared across boxes. (The hub secret is how a box
   knows a request's identity was verified by the hub.)
5. **Package installs from a box.** Decision: no new privileged path. A
   box records the package; the next deploy installs it with `bbx host
   sync` as root.
7. **The mobile session cookie at the hub** (found in implementation
   2026-10-24; decided 2026-10-24: option (b), the boxholder judged an
   unverified wake too easy a denial of service). Built: on a unit host the
   cookie key is HKDF-SHA256 over the box's hub secret
   (`core/mobile/session.ts`, `deriveMobileSessionKey`); the box derives it
   from its credential, the hub from the secret it minted for that box, and
   no secret file is written there. A reboot mints a new secret and the device
   re-mints its cookie from the bearer it holds. The spawning layout keeps the
   per-box file. The original text: The hub verifies three mobile credentials today; two are
   bearers it can now check by hash from `hub-meta.json`. The third, the
   `bbx_mobile` cookie, is signed with a per-box secret
   (`.beebox/mobile-session.secret`) that the box must not publish, so a hub
   outside the box cannot verify it. What is built: any request carrying a
   `bbx_mobile` cookie, whatever its value, is passed to the box, which
   verifies it (a bad cookie gets the box's 401). The one cost: a request
   with `Cookie: bbx_mobile=x` wakes a sleeping box unverified, the same
   class of wake the hash check closes for bearers (review round 3 confirmed
   the wording: no shape is checked, only the cookie's presence). Options for the boxholder: (a) accept, as built; (b)
   sign mobile cookies with a key derived from the per-box hub secret
   (HKDF), which the hub holds for that box and no sibling knows, so the hub
   verifies cookies too: about 40 engine lines, cookies re-minted after a
   reboot from the device bearer the app holds anyway; (c) Ed25519-signed
   cookies with the public key in `hub-meta.json`: no shared material, a
   larger change to `core/mobile/session.ts`. Lean: (b); (a) is the interim.
   Review finding (codex gpt-6-sol, 2026-10-24): the pass-through must not
   reach the hub's own `/api/boxes` listing, where a made-up cookie would
   list every slug; the listing now accepts only bearers the hub verified
   by hash, and a cookie-only mobile client lists from its box.
8. **Box display identity in the hub listing** (found in review 2026-10-24;
   decided 2026-10-24: option (b)). Built: `hub-meta.json` carries
   `identity: { name, symbol }` from the root landmark
   (`core/landmark/identity-sync.ts`); the hub's `describeBoxes` reads it on a
   unit host; the box's own identity read republishes the file when the
   identity changes, since a landmark card has no single writer. The
   original text: The hub's box picker and `/api/boxes` read each box's name
   and symbol from `_content` (`core/landmark/box-identity.ts`), which a
   unit host makes private; the picker then shows bare slugs with no symbol.
   Options: (a) accept the bare listing; (b) add `identity: { name, symbol }`
   to `hub-meta.json` (not secret, two more fields, the engine already
   rewrites the file on every input change). Lean: (b), after the probe.
9. **Fleet secret management from a box's Admin page** (found in review
   round 2, 2026-10-24; decided 2026-10-24: option (a), with the boxholder
   noting cross-box admin may change shape later). Built: on a unit host the
   secrets router refuses a slug other than the serving box and a machine-wide
   removal, naming the operator's `grant`/`export-box` commands, and
   `machineView.scope` is `"box"` so the Machine-wide tab says what it shows
   and hides removal. The original text: The secrets tRPC router
   (`src/webapp/trpc/routers/secrets.ts`) takes a target box slug and writes
   the store the serving process reads. On a unit host that is the box's own
   store, so granting from box A's Admin page to box B reports success and
   changes nothing B can read; the machine-wide view the page shows is A's
   store. Options: (a) on a unit host, make the surface box-scoped: refuse a
   slug other than the serving box, and say that grants to other boxes are
   made on the hub user's master store and re-exported (`bbx engine secrets
   export-box`); (b) a hub-owned secrets surface that writes the master and
   re-exports to every box (a new subsystem). Lean: (a) now, (b) if the
   operator's grant workflow turns out to need a page.
6. **Agent logins per box** (open, settled by the subplan's probe). One
   `claude auth login` and `codex login` per box user, repeated on expiry,
   or a copied credentials file that may break on token rotation. No
   effect on people using the boxes; the cost is the operator's. Lean:
   per box, unless the probe shows the copy survives a refresh.

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
- **The units and the wrapper** in a Docker smoke beside
  `bbx-host-apt.smoke.sh`: systemd in a container, two fixture boxes and
  users, the cross-box read refused, a hub-only restart keeping each box's
  secret. The filesystem probe the
  issue asks for lives here, since it needs two users.
- **Production drift** by `schedules/cross-box-leak-scan`'s host audit,
  extended to assert each box home is owned by its `bbx-<slug>` user and
  mode 0751 with `box/` and `box/.beebox/` 0751 and every other entry
  0700, that `hub-meta.json` is the only world-readable file under
  `.beebox/`, that no `bbx-*` user can read another's home contents, and
  that each `/run/beebox/<slug>.secret.env` is 0640 `beebox:bbx-<slug>`. A
  hub-user read of each box's `hub-meta.json` is part of the audit, so a
  mode drift that would blind the hub is reported.
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
7. Track C chunk 2: `bbx-box-run`, the per-box secret files, `bbx host
   install` recording only on a unit host.
8. Track E: the scheduler pass; `deploy.sh`, `add-box.sh`; the migration
   script, rehearsed on the throwaway VM with a copy of a test box.
9. Track F: `provision.sh` from `setup-server.sh`, `create-server.sh`
   user-data; a fresh VM provisioned end to end and destroyed.
10. Production migration, by hand, after a snapshot, with the boxholder
    present.

## Implementation status (2026-10-24, evening)

Built, committed and run on a throwaway Hetzner VM: every track, the smoke
(31/31), `cloud-init.yaml` + `provision.sh` from a blank server, `add-box.sh`
for two boxes, `migrate-to-box-users.sh` for a third (dry run, run, resume,
no-op rerun), thirteen `deploy.sh` runs as the fixes landed, the probe
(subplan chunk 1, its rows settled or handed to the boxholder). Questions 7,
8 and 9 were decided and built the same day. Open for the boxholder: the
agent login per box (subplan question 1) and the Google token (subplan
question 2), both decided at the production migration, which is step 10 and
has not run. The fixes the VM forced are listed under Track E's "Found on the
VM" and the following paragraph.

**Found on the VM, second pass.** A fresh host had no `/usr/local/bin/bbx`
(the old provisioner's link; the deploy makes it now), no scheduler home
(cloud-init's system user; tmpfiles and the deploy create it), no `hub.json`
(the provisioner writes an empty table on port 3210), and a canary that
failed with no box (it passes on a box-less host). `systemctl stop` of a unit
that does not exist yet failed the activation (only existing units are
stopped). Root's deploy had made a shared `/tmp` lock directory the hub user
could not write (per-user directories now). The engine's reference docs were
in a 0700 directory (`mkdtemp`), so a box user's `bbx engine init` died on the
fingerprint (opened; an unreadable fingerprint reads as "unwritable"). The
new `scheduler pass`, `secrets export-box` subcommands were not in the CLI
surface table and so unknown to the bundle. `hub-meta.json` came out 0600
under the unit's umask (set outright). The unit umask moved from 0077 to
0007 and the Docling model cache became writable (Track C). The migration's
`chmod` followed the box's engine link and made the install 0700 (skips
links; the deploy also opens the staged tree every run) and treated an
add-box-made box as unmigrated; its scheduler manifest is now derived from
the migrated `hub.json`. `useradd --system` with a UID above 999 only warned.
The deploy's VAPID append lacked a trailing newline.

## Rollout shape

**Tests first.** Each engine codepath names its test before it is written
(the idle decision as a pure function; socket serve under a passed fd; the
scheduler pass selection; the spool client). Done-when: change-selected
beebox tests pass; `test/hub/` passes; the Docker smoke passes; the
throwaway VM runs a box as its user, the cross-box read is refused, a
recorded package installs at the next `bbx host sync`, and a hub-only
restart keeps the box served.

**Migration approach.** Scripted, atomic per host, one-way after the
snapshot is discarded. Rehearsed on the throwaway VM with the test box
first. Production runs it once, with the boxholder, in a deploy window.

**Knowledge audits.** None.
