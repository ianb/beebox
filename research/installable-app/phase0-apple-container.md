# Phase 0: the beebox image under Apple's `container` (2026-09-29)

Question: can a macOS app run the existing Linux image through Apple's
container runtime, with the box in a folder the user sees in Finder? This
note records a hands-on test on the boxholder's Mac (Apple silicon, 16 GB,
macOS 26.5.2) with `container` 1.5.0 (Containerization 0.48.0 underneath).
The image is `beebox/docker/Dockerfile`, unchanged.

## Verdict

Feasible. The folder share keeps ownership right in both directions, git
and git-annex work on it, SQLite WAL works on it, the box serves through a
published port, and `claude auth login` works inside. The costs are memory
sizing, slower file operations on the share, disk footprint, and some rough
edges in the runtime. None of them blocks an app.

## Results

| Check | Result |
|---|---|
| Runtime install without root | Works: the signed `.pkg` expanded to a directory, then `container system start --install-root <dir> --app-root <dir>`. An app can carry the runtime in its bundle |
| Image build (`container build`) | Works in ~5 min with `-c 6 -m 5G`. Fails with the default 2 GB builder: the frontend `tsc` runs out of heap |
| Ownership on a bind-mounted host folder | Inside, files show as the container user (UID 1000); on the Mac, as the host user (501). Both directions, new files included |
| git + git-annex on the share | Correct: annex symlinks, executable hooks, `git annex fsck` pass. The Mac side can run `git status`, `git log`, and `git annex fsck` on a repo created in the VM |
| SQLite WAL on the share | `events.db`, `-wal`, `-shm` created; no errors in the server log |
| `bbx engine init` onto the share | 8.8 s |
| Serve + `-p 127.0.0.1:3290:3210` | HTTP 200 from the Mac 6 s after `container run -d`; `/box/` redirects to login as expected; first-run setup link printed |
| Idle memory of the serving VM | ~715 MB of a 4 GB allocation |
| `claude auth login` inside | Prints the sign-in URL and waits for the pasted code (not completed) |
| `codex` inside | Not on PATH; see below |

Small-file workload (`bench.sh`: 2000 cards + 50 × 1 MB annexed files, then
add, commit, status, edit, log, fsck), seconds:

| Phase | Mac native | Container, shared folder | Container, VM disk |
|---|---|---|---|
| write files | 0.78 | 3.20 | 0.19 |
| `git annex add` 50 files | 2.13 | 1.34 | 0.48 |
| `git add` 2000 cards | 1.73 | 3.71 | 0.74 |
| commit | 0.29 | 0.21 | 0.02 |
| `git status` × 5 | 0.06 | 0.06 | 0.01 |
| edit 200 + commit | 0.58 | 1.56 | 0.15 |
| `git log -p` | 0.17 | 1.23 | 0.04 |
| `git annex fsck --fast` | 0.49 | 2.86 | 0.14 |

The share is 1–7× slower than native and 3–20× slower than the VM's own
disk. At this box size every operation stays within a few seconds. A box
with years of history will feel the `git log -p` and fsck rows most.

## Findings for the app design

1. **Memory must be sized from the host.** Defaults are 1 GB per container
   and 2 GB for the builder; neither runs our build. Oversizing is worse: a
   12 GB builder on this 16 GB Mac, with other workloads running, froze the
   machine and it had to be force-restarted. The app sets the VM size from
   `hw.memsize` and leaves most memory to macOS. A 3–4 GB box VM is enough
   for serving.
2. **The app ships a prebuilt image; it never builds one.** The builder's
   BuildKit cache reached 16 GB in one build. A pulled image is ~0.9 GB of
   compressed content and a few GB unpacked. This makes the published image
   ([installation-remaining-work](../../issues/features/2026-07-19-installation-remaining-work.md)
   item 6) a hard prerequisite.
3. **The runtime state directory cannot move.** The kernel link and the
   image snapshots are recorded as absolute paths; after a move, the runtime
   failed until its state was wiped. The app picks one location (under
   `~/Library/Application Support`) and keeps it.
4. **The build context walks ignored directories.** With 3.3 GB of runtime
   state under the repo's `scratch/` (listed in `.dockerignore`), the
   context transfer failed ("unable to write data to the archive"). Only a
   build-time concern; noted for anyone building with `container build`.
5. **Box folder: the share is viable.** Finder, Time Machine, and the user's
   own git tools see a normal repo. Keep the VM-disk option in reserve for
   very large boxes.
6. **The image has gaps an app would expose.** In the container, `qpdf` is
   missing (PDF scan uploads get a 503; the server log says so at startup),
   `uv`/Docling is missing, and `codex` is installed only as a transitive
   dependency at `/app/node_modules/.pnpm/node_modules/.bin/codex`, so the
   documented in-container `codex login --device-auth` cannot run. Recorded
   in [docker-image-missing-qpdf-and-docling](../../issues/bugs/2026-09-29-docker-image-missing-qpdf-and-docling.md).
7. **Logins still need a terminal.** Both agent logins are URL + pasted code.
   An app needs an in-app or admin-UI flow for them before it is
   self-service.

## Not tested

- Completing a real Claude or Codex login, and an agent run inside the VM.
- Behavior across Mac sleep and wake, and restart after reboot.
- Tailscale inside the image.
- Embedding the Containerization Swift package directly (this test used the
  `container` CLI, which is built on it).
- Box-local `pnpm install` on the share at first serve, measured on its own.

## Reproducing

Runtime and state: `~/Library/Caches/beebox-phase0/` (outside the repo).
`guarded-build.sh` there runs `container build -c 6 -m 5G` under a watchdog
that kills the build when macOS free memory falls below 20%; `bench.sh` is
the workload above.
