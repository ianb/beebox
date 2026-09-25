---
title: "Box agents install distro packages on their host"
status: implemented
workstream: box-host-packages
issues:
  - ../../../issues/closed/features/2026-09-16-box-installs-distro-packages.md
---
# Box agents install distro packages on their host

When a box agent needs a command-line tool that the distro packages but the host
lacks (gLabels for label PDFs, `file`), I want the agent to install it itself,
so the boxholder does not have to SSH in and run `sudo apt install`. This plan
adds `bbx host install`: a per-box record of needed packages, and a root-owned
wrapper that installs only additive, service-free packages from the host's apt
sources.

**Issues addressed:** `issues/features/2026-09-16-box-installs-distro-packages.md`.
Related, not resolved here:
`issues/features/2026-09-16-box-python-library-path-and-policy.md` (Python
libraries belong in `uv`, not apt) and
`issues/features/2026-09-16-sandboxed-trick-helpers.md` (sandboxes that carry no
tools of their own; see *Could this be simpler?*). Searched `issues/`, `src/`
and `docs/` for `host install`, `host-packages` and `bbx-host`: no prior
implementation or duplicate issue.

## Smallest fix and budget

**Smallest fix:** install `glabels` by hand on the server. That fixes the one
report and repeats for every later tool; the issue records the same wall three
times in one week (`file`, poppler/imagemagick delegates, gLabels).

**Smallest version of the capability:** a sudoers entry plus a root-owned
wrapper script, and the agent calls `sudo` on it directly. No CLI, no record.
The chosen design adds a thin `bbx host` CLI, a per-box manifest, a health
check, and a Docker reinstall hook. *Could this be simpler?* says what those
buy.

Tracks: root wrapper + smoke test (bash); deploy install (bash); `bbx host` CLI,
manifest, health check (TypeScript); Docker image (bash/Dockerfile); agent guide,
knowledge audit, security report (docs).

Estimate, additions plus deletions:

| Part | Source | Tests |
|---|---|---|
| `deploy/server-bin/bbx-host-apt` wrapper | ~180 | ~150 (Docker smoke) |
| `deploy.sh` install step | ~30 | covered by smoke + manual deploy check |
| `bbx host` CLI + manifest module | ~220 | ~200 (doctest) |
| Health check | ~60 | in the same doctest |
| Dockerfile + entrypoint | ~25 | `smoke-docker.sh` run |
| **Total** | **~515** | **~350** |

Authored docs (agent guide line, security report rows, knowledge audit entry,
`deploy/README.md` note): ~120 lines. No generated output. Well under the
2,000-line BIG CHANGE line.

## Stated preferences this plan trades against

- **Boxholder decisions, 2026-09-17** (this session), recorded here as the
  plan's premises:
  1. Privilege: a NOPASSWD sudoers entry for one root-owned validating wrapper.
     Rejected: a root request queue (no sudo, but async and more parts) and
     per-install boxholder approval (defeats "a box should be able to do it").
  2. Sources: distro repositories only. No arbitrary `.deb` files, because a
     `.deb` runs its maintainer scripts as root, which equals giving the agent
     root.
  3. macOS: unsupported. The command says so clearly and records the need.
  4. Services: refuse any install that would add a package shipping a system
     service. Rejected: install-but-don't-start, and allow.
- **The boxholder's original position** (quoted in the issue): *"installing
  packages is something I think a box should be able to do. Distro packages are
  generally very safe."*
- **Principle 3, validate at boundaries** (`docs/engineering-principles.md:37`).
  The sudo boundary is the most important boundary here. All enforcement lives
  in the root-side wrapper. The TypeScript CLI validates too, but only to give
  better errors; it is not trusted.
- **Principle 4, resilient and never silent** (`:49`). Every refusal names the
  package and the reason. Every attempt is logged on the host.
- **Principle 6, right-sized defensiveness** (`:75`), and the memory
  *stop over-engineering rare failures*. The wrapper blocks the concrete
  root-escalation routes (below). It does not try to audit distro maintainer
  scripts; the boxholder decided that distro packages are trusted.
- **Bias toward strict / fail closed** (boxholder memory). This conflicts with
  decision 4 in one way: some harmless packages ship a oneshot unit
  (`ssl-cert.service`) or a masked boot script (`x11-common`) and will be
  refused. A false refusal sends the agent back to the boxholder, which is the
  status quo, so strict wins.
- **TypeScript over JavaScript** (boxholder memory). The wrapper is bash on
  purpose: it runs as root, so it may only execute root-owned system binaries.
  A TypeScript wrapper would run `node` and modules from `/opt/beebox`, which
  the box user owns (`deploy/deploy.sh:509`:
  *`queue_remote command chown -R beebox:beebox "$INSTALL_DIR"`*). Root would
  then execute code the box user can write.
- **Cross-model review, 2026-09-17** (Codex gpt-5.5) found three gaps in the
  first draft, now fixed in Track 1: the sources rule contradicted decision 2
  by allowing NodeSource; "service" missed cron, D-Bus system activation,
  setuid files and sudoers/polkit rules; and the install was not bound to the
  inspected versions. Two proposals were declined, each with a reason in its
  section: a health warning on macOS, and making the Docker sync manual.
- **Principle 8, one way to do each thing** (`:95`). Python libraries keep
  their `uv` path (related issue). The agent guide says that distro packages
  are for system tools, not Python imports.

## What already exists

- **Fleet package list.** `deploy/hetzner/setup-server.sh:33` installs the
  standard apt list at provisioning only. `deploy/deploy.sh:806` fails a deploy
  when a declared tool is missing. **Reuse:** unchanged. Agent-installed
  packages never enter the required-tools check, so they cannot fail a deploy.
- **Root-side deploy steps.** `deploy/deploy.sh:493` `queue_remote()` collects
  root commands. Its `stdin` form embeds a heredoc body from the deploying
  machine. **Reuse** to install the wrapper and the sudoers file from the local
  checkout. Do not copy them out of `/opt/beebox`: `RSYNC_OPTS`
  (`deploy/deploy.sh:406`, *`-az --delete`*) uses rsync's default size-and-mtime
  check, so a box-user edit that keeps size and mtime would survive the rsync
  and then be installed as root.
- **Server helper precedent.** `deploy/server-bin/bbx-wait-quiet` is the one
  existing server-side helper script. **Reuse** the directory.
- **Health checks.** `src/webapp/trpc/routers/health.ts:45` `HealthCheck`
  (*`severity: "error" | "warning"`*). Separate check modules already exist
  (`health-templates.ts`, `health-package-docs.ts`, imported at `:42-43`).
  **Reuse:** add `health-host-packages.ts` in the same shape. `bbx health`
  (`src/cli/commands/health.ts`) prints it with no change.
- **CLI registration.** `src/cli/surface-commands.ts:46,110` registers
  top-level commands. **Reuse:** add `hostCommand`.
- **Box config files.** `_config/` holds per-box JSON (`_config/box.json`,
  read by `src/core/box/config.ts:254`; `_config/transcription.json`, read at
  `src/core/box/index.ts:172`). **Reuse** the location for
  `_config/host-packages.json`.
- **Agent tool promise.** `src/core/agent-guide/chat.ts:15`: *"Always available
  on the box host, reach for them directly: `pandoc` …"*. **Extend** with one
  sentence.
- **Docker image.** `docker/Dockerfile` runs as `node` (`USER node`). It has no
  sudo today. `docker/entrypoint.sh` runs a bounded convergence step before
  serving. **Reuse** that step for the reinstall.
- **Security posture.** `docs/security-report.md:234` records that the agent
  *"can run arbitrary shell as the box user"*. `:347` and item 12 (`:434`)
  record that all boxes on a host share one OS user. Consequence: this plan
  does not create cross-box reach, which already exists. It creates **root**
  reach, restricted to package installs.
- **systemd hardening.** Searched `deploy/` for `NoNewPrivileges`,
  `ProtectSystem`, `RestrictSUIDSGID`: none. `sudo` from a box process is not
  blocked by the units in this repo. The live server's units were switched by
  hand (`setup-server.sh` header), so this must be checked read-only before
  shipping.

## Prior art (external)

Verified by experiment in `ubuntu:24.04` (apt 2.8.3), 2026-09-17. Scripts are in
this session's scratch space. The design depends on each result:

- **apt treats a name with `.` or `+` as a regex when no package matches
  exactly.** `apt-get install -s -- 'glabel.*'` selected
  `python3-shippinglabel` and others. The Debian name alphabet includes `.` and
  `+`, so a character check alone cannot stop this. Fix: require an exact match
  from `apt-cache pkgnames -- <name> | grep -qxF -- <name>` (tested: `glabels`
  matches; `glabel.`, `lib.+` and the virtual `mail-transport-agent` do not).
- **A raw sudoers `apt-get install *` grants root.** `-o
  APT::Update::Pre-Invoke::=<cmd>` and `-o DPkg::Pre-Invoke::=<cmd>` run
  commands as root, and `apt-get install ./x.deb` installs a local file. These
  are documented apt/dpkg configuration hooks
  (https://manpages.ubuntu.com/manpages/noble/man5/apt.conf.5.html). This is why
  the wrapper takes names only and builds the apt command line itself.
- **gLabels passes the service rule on a server-like host.** On a base with
  systemd, dbus and the `setup-server.sh` package list installed,
  `glabels --no-install-recommends` adds 27 packages, upgrades 0, and none ship
  a system unit or init script. On a bare container the same install pulls
  `systemd` and `dbus`, which ship units. So the rule **must inspect only
  newly installed packages**, never the whole dependency tree.
- **The rule refuses daemons as intended.** `openssh-server` (ssh.service,
  ssh.socket) and `postfix` (postfix.service, plus `ssl-cert.service` from a
  dependency) are detected.
- **Known false refusal.** `python3-reportlab` on a bare base pulls
  `x11-common`, which ships `/etc/init.d/x11-common`, while systemd masks it
  (`/usr/lib/systemd/system/x11-common.service -> /dev/null`). On the
  server-like base, `x11-common` is already present, so reportlab adds 4
  packages and passes. Accepted: see *Stated preferences*.
- **`apt-get --no-remove`** aborts when a removal would be needed
  (apt-get(8)). **`--no-download`** installs only from the archive cache
  (apt-get(8)); it is what ties the install to the inspected files.

## Tracks / scope

### Track 1 — Root wrapper `bbx-host-apt`

**What.** A bash script, installed as `/usr/local/sbin/bbx-host-apt`
(root:root 0755). It is the only root code path. The sudoers entry allows the
box user to run it with any arguments; the script rejects everything except one
form.

**Why this needs to change.** Without it, the only way to install a package is
a human with root. A plain sudoers rule for `apt-get` gives root (see *Prior
art*).

**Direction.** Interface:

```
bbx-host-apt install --box <slug> -- <pkg> [<pkg> ...]
```

Steps, in order:

1. Parse argv strictly. `<slug>` matches `^[a-z0-9][a-z0-9-]{0,63}$` and is
   logged as caller-claimed, because the box user is shared. From 1 to 10
   packages, each matching `^[a-z0-9][a-z0-9+.-]{1,63}$`. Anything else exits 64.
2. Reset the process state before anything else. On first entry the script
   re-executes itself as
   `exec /usr/bin/env -i BBX_HOST_APT_CLEAN=1 PATH=/usr/sbin:/usr/bin:/sbin:/bin
   LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive /bin/bash --noprofile --norc
   /usr/local/sbin/bbx-host-apt "$@"`. The path is fixed, not `$0`. After the
   re-exec: `set -euf -o pipefail`, `IFS=$' \t\n'`, `umask 022`, `cd /`. Take
   `flock /run/bbx-host-apt.lock` before touching the private apt state, so
   two boxes cannot interleave. Usage errors are logged too, without the
   rejected argv. (sudo's
   `env_reset` already drops most variables; the re-exec does not depend on
   the sudoers defaults.)
3. **Distro sources only.** Every apt call gets one private configuration,
   so no third-party source (NodeSource, `setup-server.sh:55`) can supply a
   package:
   `-o Dir::Etc::sourcelist=/dev/null`
   `-o Dir::Etc::sourceparts=/var/lib/bbx-host-apt/sources.list.d`
   `-o Dir::State::Lists=/var/lib/bbx-host-apt/lists`
   `-o Dir::Cache::archives=/var/cache/bbx-host-apt/archives`
   `-o DPkg::Lock::Timeout=300`. The wrapper fills the private sources
   directory with copies of only the distro files
   (`/etc/apt/sources.list.d/ubuntu.sources` or `debian.sources`) and fails
   when there is none. The legacy `/etc/apt/sources.list` is ignored: it can
   hold any repository (implementation review, round 2). Keyrings stay the
   host's. All
   private directories are root-owned 0755 (the archive 0700), created by
   deploy, and checked by the wrapper with `stat` (owner root, not a symlink).
   Then `apt-get update -qq` fills the private lists. The host's own apt lists
   and sources are not touched.
4. Each name must be an exact package (the regex guard above). Names already
   installed (`dpkg-query -W -f='${db:Status-Abbrev}'` = `ii `) are reported
   and dropped. If none remain, exit 0.
5. Simulate `apt-get -s install --no-install-recommends --no-remove -- <names>`.
   Refuse when any `Inst <pkg> [<oldver>]` line shows an upgrade, or any `Remv`
   line appears. The `Inst` lines give the new set as exact `name=version`
   pairs.
6. Clear the private archive, then `--download-only` the exact
   `name=version` set into it.
7. For each downloaded `.deb`, list its files with `dpkg-deb -c`. Refuse, naming
   the package and the file, when any entry is:
   - a system unit: `(usr/)?lib/systemd/system/*.{service,socket,timer,path}`,
     or anything under `etc/systemd/system/`;
   - an init script: `etc/init.d/*`;
   - a root cron job: `etc/cron.d/*`, `etc/cron.{hourly,daily,weekly,monthly}/*`;
   - D-Bus system activation: `usr/share/dbus-1/system-services/*`;
   - a systemd generator: `(usr/)?lib/systemd/system-generators/*`;
   - a privilege grant: `etc/sudoers.d/*`, `etc/polkit-1/*`,
     `usr/share/polkit-1/rules.d/*`;
   - a setuid or setgid file (mode column contains `s` or `S`).
   Not covered, and recorded as residual risk: capabilities that a `postinst`
   sets with `setcap`, udev rules, tmpfiles rules, systemd user units.
8. Re-simulate the exact `name=version` set with `--no-download`. The new set
   must equal the inspected set. Then install that set with `--no-download
   --no-install-recommends --no-remove`. Every package comes from the inspected
   files at the inspected version; any drift fails the install.
9. Append one JSON line to `/var/log/beebox/host-apt.log` (root:root 0644):
   time, `SUDO_USER`, claimed box, requested names, new set, outcome, reason.

Exit codes: `0` installed or already present; `2` refused by policy, with the
reason on stderr; `1` apt or system error. Output is plain text for the CLI to
relay.

**Vocabulary lock-ins.** Command path `/usr/local/sbin/bbx-host-apt`; log
`/var/log/beebox/host-apt.log`; sudoers file
`/etc/sudoers.d/beebox-host-apt`; exit codes 0/1/2/64.

**First implementation chunk.** The script plus
`deploy/server-bin/bbx-host-apt.smoke.sh`. The smoke test builds a server-like
`ubuntu:24.04` image (systemd, dbus, the `setup-server.sh` list), adds a
`beebox` user and the sudoers file, and asserts:

- `glabels` installs and is logged.
- `openssh-server` → exit 2, naming `ssh.service`.
- `glabel.` → exit 2, not an exact package.
- `-o APT::Update::Pre-Invoke::=touch /pwn` → exit 64, and `/pwn` does not
  exist.
- `./x.deb` → exit 64.
- A caller-set `APT_CONFIG` has no effect.
- An install that needs an upgrade is refused. Set this up by pinning an older
  version of a dependency first.
- A package from a local third-party `file:` repository in
  `/etc/apt/sources.list.d/` → exit 2, not a package in the distro sources.
- A distro package that ships a setuid or setgid file → exit 2. The concrete
  package is chosen while writing the test.

### Track 2 — Deploy installs the wrapper and sudoers entry

**What.** `deploy/deploy.sh` installs both files on every deploy, before the
tool check at `:806`.

**Why.** `setup-server.sh` never re-runs on a live server (its own header,
lines 7-12). Deploy is the only path that reaches production.

**Direction.**
`queue_remote stdin bash -c 'install -o root -g root -m 0755 /dev/stdin
/usr/local/sbin/bbx-host-apt' < "$SCRIPT_DIR/server-bin/bbx-host-apt"`. The
content comes from the deploying checkout, not from `/opt/beebox`. The sudoers
line `beebox ALL=(root) NOPASSWD: /usr/local/sbin/bbx-host-apt` is written to a
temp file, checked with `visudo -cf`, then moved to
`/etc/sudoers.d/beebox-host-apt` (0440). `mkdir -p /var/log/beebox`. A
`visudo` failure fails the deploy. `setup-server.sh` gets no copy: it provisions
a server that is then deployed, so the deploy step covers it. Note that in
`deploy/README.md`.

**Vocabulary lock-ins.** None beyond Track 1.

**First implementation chunk.** The deploy step and the README note. Verify
with `bash -n`. Run the step by hand in the Track 1 smoke container, feeding it
the same stdin body.

### Track 3 — `bbx host` CLI, manifest, health check

**What.** Agent-facing commands, a per-box record, and a health warning for
recorded packages that are missing.

**Why.** The raw sudo call gives no per-box record. The host log does not say
why a box needed a package, and a rebuilt server or recreated container loses
the packages with no trace.

**Direction.**

- `_config/host-packages.json`:
  `{ "packages": { "<name>": { "why": "<reason>", "added": "YYYY-MM-DD" } } }`.
  Parsed with a Zod schema in `src/core/host-packages.ts`, which holds the pure
  functions: `parseHostPackages`, `addHostPackages`,
  `missingHostPackages(recorded, installed)`, and
  `validatePackageName` (the same pattern as the wrapper).
- `bbx host install <pkg...> --why "<reason>"`. `--why` is required. The
  command records the packages in the manifest first, then runs
  `sudo -n /usr/local/sbin/bbx-host-apt install --box <slug> -- <pkgs>` and
  relays the output. The record stays even when the install is refused: it is
  the box's statement of need, and health keeps it visible. The command prints
  that the manifest changed and should be committed. It does not commit.
- `bbx host sync`: installs every recorded package that is missing. Used by
  the Docker entrypoint and after a server rebuild.
- **Backend detection:** `/usr/local/sbin/bbx-host-apt` exists → apt backend.
  Otherwise the command records the need and exits 3 with: *"This host does not
  allow box package installs (macOS, or a server without the wrapper). Recorded
  `<pkg>` in `_config/host-packages.json`. Ask the boxholder to install it."*
  `sudo -n` failing with a password prompt, or blocked by `NoNewPrivileges`,
  gets its own message that names the cause.
- **Health:** `hostPackagesCheck` in `health-host-packages.ts`. An empty or
  absent manifest → no check row. With `dpkg-query` available, missing packages
  → `warning`: *"Recorded host packages not installed: glabels. Run `bbx host
  sync`."* Without `dpkg-query` (macOS) → `ok`, with the message that recorded
  packages cannot be checked on this host, and the message lists them. A
  warning there could never clear: the backend is unsupported and package
  names are not command names, so no check could prove the tool is present. A manifest that does not parse → `warning` with the parse error.

**Vocabulary lock-ins.** `bbx host install`, `bbx host sync`, `--why`,
`_config/host-packages.json`, fields `why` and `added`. Exit 3 = unsupported
host.

**First implementation chunk.** `src/core/host-packages.ts` and
`test/core/host-packages.doctest.md` (parse, add, missing-diff, name
validation, including `glabel.*` rejected by the TS check as well).

### Track 4 — Docker image

**What.** The container gets the same wrapper and reinstalls recorded packages
at start.

**Why.** Docker is the documented install path (`setup-server.sh` header). A
recreated container loses every apt install.

**Direction.** The Dockerfile installs `sudo`, copies the wrapper to
`/usr/local/sbin/` (root-owned), and writes a sudoers entry for `node`. The
image is Debian bookworm, not Ubuntu; the wrapper uses only apt/dpkg
primitives common to both. The smoke test also runs against
`debian:bookworm-slim`. The entrypoint convergence step runs
`bbx host sync --box "$BOX_ROOT"`. On failure it prints a warning and the
container keeps serving, and health shows the gap. Blocking startup on an apt
mirror outage would take the box down for a missing optional tool. The sync
is automatic because container recreation is routine (every image upgrade),
and the wrapper applies the same policy whether the agent or the entrypoint
calls it.

**Vocabulary lock-ins.** None new.

**First implementation chunk.** The Dockerfile and entrypoint edits. Verify
with `docker/smoke-docker.sh` plus one `bbx host install file` inside the
running container.

### Track 5 — Agent guide, knowledge audit, security report

**What.** Tell box agents about the capability. Record the new privilege
surface.

**Direction.**

- One sentence after `src/core/agent-guide/chat.ts:15`: *"Missing a system
  tool that Ubuntu/Debian packages? `bbx host install <pkg> --why "<reason>"`
  installs it from the distro repositories. It refuses packages that add a
  service or upgrade anything; on hosts without support it records the need
  and you ask the boxholder. Python libraries are not host packages."*
- A knowledge-audit entry, below.
- `docs/security-report.md` (via the `security-report` skill): a privilege row
  for the sudo wrapper in the §5 process-model table, and a §8 entry. Fix the
  stale §5 row while there: it names a `callback` user
  (`security-report.md:241`), but provisioning uses `beebox`
  (`setup-server.sh:19`). The
  residual risk is root execution of distro maintainer scripts for any
  service-free distro package, chosen by an LLM, host-wide.

## Could this be simpler?

**Simplest version:** the wrapper and sudoers entry only (Tracks 1-2). The
agent guide says `sudo /usr/local/sbin/bbx-host-apt install --box <slug> --
<pkg>`. About 210 lines. It works on the production server today.

What Track 3 adds:

- **The box records why it needed a package.** Without the manifest, a rebuilt
  server loses every agent install silently, and the first sign is a trick
  failing weeks later. That breaks principle 4 (never silent). The manifest
  plus the health warning turns that into a visible, fixable state.
- **A clean result on macOS.** Without the CLI, the agent on a laptop box runs
  a missing path and gets `sudo: command not found`-style noise, and nothing
  records the need. That goes against boxholder decision 3.

What Track 4 adds: the Docker path is the documented install. Without it a
Docker box has no capability at all, and after every container recreation the
packages are gone with no trace.

**Sandboxes as a substitute.** The trick-helpers issue targets `unshare` with
no separate root filesystem, so a sandbox sees the host's binaries and brings
no tools. A rootless per-box container (its own rootfs, apt as fake root)
would let agents install anything without host root. It would also change how
every agent command runs, and on macOS it needs a VM. That is a separate,
larger project. It is not a reason to wait.

**Considered and dropped:**
- An exception for masked init scripts (`x11-common`): a false refusal only
  routes back to the boxholder.
- Refusing udev rules, tmpfiles rules and systemd user units: many plain
  libraries ship udev rules, and user units never run for a service account
  with no login session. Recorded as residual risk in step 7.
- A deploy step that syncs every box's manifest: that couples deploys to box
  content, which the issue's *deploy list* section rejects.

## Subplans

None. The one research question (does the service rule block gLabels?) was
settled by the experiment under *Prior art*.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent passes apt options (`-o …Pre-Invoke`) or a `.deb` path through sudo | smoke (T1) | argv parser, exit 64 | clear |
| Name with `.`/`+` becomes an apt regex and installs something else | smoke + doctest | exact-match guard (T1 step 4) | clear |
| Box user edits `/opt/beebox/.../bbx-host-apt`, and deploy installs it as root | manual deploy check | installed from the deploying checkout's stdin (T2) | n/a (prevented) |
| Package closure contains a daemon (postfix, openssh-server) | smoke | step 7 refusal | clear, names the unit file |
| New package adds a setuid binary, sudoers/polkit rule, root cron job, or D-Bus system service | smoke (setuid case) | step 7 refusal | clear |
| `postinst` grants a file capability with `setcap` | none | none; residual risk in the security report | silent, accepted: distro-vetted, and rare |
| A third-party source (NodeSource) supplies the package | smoke (extra source in the image) | private sources dir (step 3) | n/a (prevented) |
| Harmless package refused (oneshot unit, masked init script) | smoke (x11-common case on bare base) | refusal message says to ask the boxholder | clear; accepted |
| Install would upgrade a shared library that other boxes use | smoke | step 5 refusal | clear |
| Install would remove a package | smoke | `--no-remove` + step 5 | clear |
| Apt lists change between inspection and install | none (race) | exact `name=version` set + re-simulation + `--no-download` (step 8) | clear (exit 1) |
| Two boxes install at once | none | `flock` + apt lock timeout | clear |
| unattended-upgrades holds the dpkg lock for minutes | none | `DPkg::Lock::Timeout=300`, then exit 1 | clear |
| Live server's unit sets `NoNewPrivileges`, so sudo fails | read-only check before ship | CLI names the cause | clear |
| Manifest hand-edited into invalid JSON | doctest | health warning with parse error; `install` refuses to overwrite it | clear |
| Server rebuilt; recorded packages gone | doctest (missing-diff) | health warning → `bbx host sync` | clear |
| Docker entrypoint sync fails (mirror down) | smoke-docker manual | warn and serve; health shows the gap | clear |
| Agent installs for a one-off job; the package stays forever, host-wide | none | host log + manifest show it | visible, not prevented |

No critical gap: every row is tested, handled, or clear.

## Agent-flow / user-flow edge cases

- **Wrong tool for the job:** the agent tries apt for a Python library
  (`python3-reportlab`). ADDRESSED in the guide sentence (T5). The related
  issue owns the `uv` path.
- **Stale ref:** a recorded package is renamed or dropped by a distro upgrade.
  `sync` fails on the exact-match guard with *"not a package in this host's
  sources"*; health keeps warning. ADDRESSED (clear), resolution is human.
- **Two agents on one manifest:** chat and a scheduled trick both run `bbx host
  install`. The read-modify-write is small and git shows both. DEFERRED: no
  lock; last writer wins on the JSON file, and the lost entry reappears only if
  that agent re-runs. Acceptable at current concurrency.
- **Hand-edit drift:** the boxholder adds a package by hand without `why`.
  ADDRESSED: the schema makes `why` required, and health reports the parse
  error.
- **Fabricated value:** a vague `--why "needed"`. GAP, accepted: the reason is
  for the boxholder's review, and no code can judge it.
- **Validation error UX:** every refusal says which package, which rule, and
  the next step (ask the boxholder). ADDRESSED in T1/T3 messages; the knowledge
  audit checks that the agent reacts correctly.
- **Transition state:** the CLI ships before the wrapper is deployed. The
  wrapper is absent, so the CLI reports "unsupported host" and records the
  need. After the deploy, `bbx host sync` completes it. ADDRESSED.

## NOT in scope

- **Arbitrary `.deb` files and third-party apt sources.** Boxholder decision 2.
- **Uninstalling packages.** Removal can break other boxes. The boxholder
  removes by hand; the agent may drop its manifest entry.
- **A Homebrew backend.** Boxholder decision 3. Names differ and gLabels has no
  formula.
- **Other distros (dnf, pacman).** No such host exists. Backend detection
  leaves room for them.
- **Per-box package isolation (rootless containers).** A separate project.
  See *Could this be simpler?*.
- **Python libraries.** Owned by `2026-09-16-box-python-library-path-and-policy.md`.
- **Adding gLabels to the fleet list.** The boxholder chose the capability
  instead (issue, *Why this beats…*).
- **Re-running `setup-server.sh` from deploy.** Existing issue
  `issues/code-quality/2026-08-07-deploy-infra-drift-setup-server-not-rerun.md`.
- **Installing anything on production during this work.** Handoff constraint.
  Production runs the wrapper only after `/finish` and a deploy.

## Open design questions

- **Does the manifest belong in `_config/box.json`?** Lean: no. A separate
  file keeps a field-level schema out of the box config, and hand edits to it
  cannot break box loading.

## Knowledge audits

New agent-facing concept: *how you get a missing system tool*. Add one entry to
`src/dev/knowledge-audits.yaml`, `id: host-package-install`,
`expected_level: knows_directly`. Probe: the agent needs `glabels` to render a
label PDF, and the command is missing. The expected answer uses `bbx host
install glabels --why …`, does not suggest `sudo apt`, and says what to do if
the command reports an unsupported host. Run it on the worktree's `test1`
clone with an absolute `--box` path (memory: *knowledge-audit --box is a
path*), and record the status comment.

## What will hold this after it ships

- **Decisions as pure functions** (`src/core/host-packages.ts`): name
  validation, manifest parse/add, missing-diff. Doctested in
  `test/core/host-packages.doctest.md`, the cheapest tier.
- **Root-side policy:** `deploy/server-bin/bbx-host-apt.smoke.sh` in Docker.
  This is a **new test norm**: a Docker-based smoke test for a server script.
  There is precedent in `docker/smoke-docker.sh`. It is not part of the
  per-commit suite (it needs Docker and network). The wrapper header says to
  run it whenever the wrapper changes. The policy cannot live in TypeScript;
  see *Stated preferences*.
- **Health check:** a doctest calling `hostPackagesCheck` with an injected
  installed-set reader, so no dpkg is needed on macOS CI.
- **The agent's behaviour:** the knowledge audit.

## Implementation order

1. Track 1: wrapper + smoke test (Ubuntu 24.04 and Debian bookworm). Commit.
2. Track 3 core: `host-packages.ts` + doctest. Commit.
3. Track 3 CLI + health check, with the "unsupported host" path verified on
   this Mac and in the smoke container. Commit.
4. Track 2: deploy step + README note. Commit.
5. Track 4: Dockerfile + entrypoint; run `smoke-docker.sh`. Commit.
6. Track 5: guide sentence, knowledge audit (run it), security report via the
   skill. Commit.
7. Cross-model review of the branch; fix; re-run the smoke tests and doctests.
8. Before `/finish`: a read-only check of the live units
   (`systemctl show beebox-hub -p NoNewPrivileges`), reported to the boxholder.

## Rollout shape

Done when these pass:

- `bbx-host-apt.smoke.sh` on both images, with every case in Track 1's first
  chunk.
- `test/core/host-packages.doctest.md`, plus the health-check doctest.
- `pnpm typecheck` and eslint on the changed files.
- `smoke-docker.sh`, plus an install inside the container.
- The `host-package-install` knowledge audit, run and recorded.

No data migration. The manifest is new, and an absent file means "nothing
recorded". Production gets the wrapper on the first deploy after `/finish`.
The first real install (gLabels on the reporting production box) is the boxholder's or the
box agent's to run after that.
