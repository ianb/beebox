# scan-uploader

A stand-alone laptop client that uploads scanned files (from a Fujitsu
ScanSnap or similar) to a [beebox](../beebox) instance's
scan-upload endpoint. TypeScript, zero runtime dependencies (Node stdlib
only), bundled by esbuild into a single self-contained script — `node
dist/scan-uploader.mjs` runs it on any machine with no checkout, no `bbx`,
and no `npm install`.

## What it does

Each run, for every configured folder:

1. Walks the folder (non-recursive; skips dotfiles and its own `imported/`
   archive subdirectory).
2. Applies a **settle gate** — skips any file modified in the last 10
   seconds, since ScanSnap writes multi-page PDFs incrementally.
3. Snapshots each surviving file's identity (device, inode, size,
   nanosecond mtime) and computes its SHA-256.
4. Asks the server which hashes it already knows about
   (`POST /api/scan/check`), then `PUT`s the unknown ones.
5. **Restats before disposition**: only after the server has confirmed a
   file (`accepted`/`duplicate` on PUT, or `pending`/`imported` from the
   check) *and* a fresh stat shows the file's identity hasn't changed does
   it apply the configured disposition. If the scanner touched the file in
   the meantime, the file is left alone — the next run picks it up fresh.
6. Applies the target's disposition: `keep` (default, no-op), `archive`
   (move into `<folder>/imported/`), or `trash` (move to the OS Trash via
   the `trash` CLI or, failing that, an AppleScript Finder fallback — macOS
   only). It never deletes a file outright.

If a run skipped anything as unsettled, it waits out the settle window and
re-walks those folders — up to three rounds, then it leaves the rest to the
next sweep. A folder-change trigger fires the instant a file appears, which is
inside the settle window, so without this the run would skip the very file
that woke it. A target whose folder is missing or unreadable fails that target
alone; the others are still swept.

Files the server rejects (failed validation) are never moved or deleted —
they stay in place, print with the server's reason, and make the process
exit non-zero. Pass `--retry-rejected` to re-`PUT` them (the server
re-validates; useful after a validator fix upstream).

This package is the client half of a wire contract shared with the server;
the server side and the exact request/response shapes live in
[`../beebox/docs/scan-upload-contract.md`](../beebox/docs/scan-upload-contract.md).
Every place in this codebase that encodes part of that contract carries a
`// WIRE CONTRACT (scan-upload): …` comment — change both sides together.

## Setup

The box's settings page (**Settings → Scan uploaders**) walks through this
and mints the token; the steps in full:

1. **Install** (once, on any machine — a dev checkout already qualifies):

   ```bash
   git clone <repo> && cd <repo>
   pnpm install --filter "scan-uploader..."
   ```

   That's it — `bin/scan-uploader` runs the CLI straight from source via
   `tsx`, so a checkout is always current; no build step. (Note: the
   workspace's `nodeLinker: hoisted`, root `pnpm-workspace.yaml`, means the filtered
   install still materializes the full hoisted tree (~1.3 GB) — it works
   verbatim from a clean clone, verified by `smoke-install.sh`, but isn't
   lighter than a full install.)

   For additional machines that shouldn't hold a full checkout, build once
   (`pnpm --filter scan-uploader build`) to produce the self-contained
   `dist/scan-uploader.mjs`, and copy just that one file to any machine
   with Node.

2. **Mint a token** in the box's settings page (shown once — keep the page
   open until step 3 has consumed it).

3. **Configure** (run on the uploader machine; paste the token when
   prompted — it is never passed as an argument). On a checkout, the
   `bin/scan-uploader` wrapper at the repo root runs the built bundle;
   on a copy-the-file machine, substitute `node scan-uploader.mjs`:

   ```bash
   bin/scan-uploader configure https://<host>/<box> \
     --name <token-name> --folder <scan-folder>
   ```

   With no `--config`, this writes/updates `./scan-uploader.json` if one
   already exists there, else `~/.config/scan-uploader.json` (created if
   this is the first target on this machine — see "Config" below). It also
   stores the token at `~/.scan-tokens/<box>.token` (0600) and verifies
   against the server. Repeat per box with its own folder and token.

4. **ScanSnap profile** — see "ScanSnap profile setup" below.

5. **Install the agent** (`scan-uploader schedule install`) — this is what
   makes a scan upload the moment it lands; see "Scheduling the sweep".

`smoke-install.sh` is the executable check that step 1 works from a clean
clone and that the built bundle runs self-contained.

### Scheduling the sweep

The launchd agent is the trigger, on two schedules at once. It watches every
configured folder (`WatchPaths`), so a scan uploads within seconds of landing,
and it also sweeps on an interval as the backstop for scans that arrive while
the machine is asleep or a filesystem event is missed. The `check` endpoint's
dedup makes the two firing back-to-back harmless.

The trigger lives here rather than in the scanner because **ScanSnap Home's
post-scan action launches an application bundle, not a shell script** — there
is no supported way to point it at a command. Watching the folder gets the
same result without touching ScanSnap's configuration, and also catches files
dropped in by hand.

On macOS, `schedule` manages a `launchd` LaunchAgent that runs the sweep on
an interval:

```bash
bin/scan-uploader schedule install                 # every 15 minutes (default)
bin/scan-uploader schedule install --interval 30   # every 30 minutes
bin/scan-uploader schedule status
bin/scan-uploader schedule uninstall
```

`install` resolves its config the same way as everything else (see
"Config" below) and refuses if that file is missing or fails the strict
reader — an installed schedule pointing at a broken config would just fail
silently into a log file. It writes
`~/Library/LaunchAgents/org.beebox.scan-uploader.plist` and loads it
(`RunAtLoad` is also set, so a sweep runs immediately and again after any
reboot/login, catching scans that landed while the machine was off).
Output goes to `~/Library/Logs/scan-uploader.log`. `uninstall` is
idempotent — running it again when nothing is installed reports that and
exits cleanly. `schedule` is macOS-only (same posture as the `trash`
disposition) — it refuses outright on other platforms rather than silently
no-op.

On a checkout, the scheduled sweep runs through `bin/scan-uploader` itself
(source mode — same tsx run as everything else), so its sweeps track
source just like a manual run does; a copied-bundle machine's schedule
instead runs the bundle directly with `node`, as before. If a LaunchAgent
was installed before this distinction existed (bundle-mode plist on a
checkout), re-run `schedule install` once to pick up the source-mode
plist — `install` always rewrites in place.

## Config

JSON file, path given as the first CLI argument. With no explicit path (the
bare run, and the `--config` default for `configure`/`schedule install`),
it resolves the same way everywhere:

1. `./scan-uploader.json` (relative to the current directory), if it
   exists — a hand-maintained or previously-configured repo-local config
   keeps working from that directory.
2. Otherwise `~/.config/scan-uploader.json` — a single, cwd-independent
   default, so `bin/scan-uploader` (with no arguments) works the same from
   anywhere once `configure` has run at least once. No XDG environment
   variable is consulted; it's always plain `~/.config`.

`configure` writes to whichever of those already exists; if neither does,
it creates `~/.config/scan-uploader.json`. Either way it preserves any
unknown keys already in the file. Shape, for hand-maintenance:

```json
{
  "targets": [
    {
      "folder": "/Users/user/Scans/Family",
      "serverUrl": "https://beebox.run",
      "box": "family",
      "tokenPath": "/Users/user/.scan-tokens/family.token",
      "disposition": "archive"
    }
  ]
}
```

- `folder` — absolute path to watch. Required. `configure` resolves what
  you pass to an absolute path; `schedule install` refuses a relative one,
  since launchd would resolve it against its own working directory and
  watch the wrong place.
- `serverUrl` — the beebox instance's base URL. Required.
- `box` — the box slug this folder uploads to. Required.
- `tokenPath` — path to a file containing the bearer scan-token (minted via
  the box's `scanTokens` admin UI/tRPC procedures). The file's contents are
  read fresh on every run and trimmed of surrounding whitespace. Required.
- `disposition` — `"keep"` (default), `"archive"`, or `"trash"`.
  `"trash"` is refused at config load on any platform other than macOS —
  there's no `unlink` fallback.

The config is validated strictly at load: an unrecognized field value, a
missing required field, or an empty `targets` array all fail closed with a
message naming exactly what's wrong.

## Usage

```bash
bin/scan-uploader [config.json] [--retry-rejected]      # from the repo root
bin/scan-uploader configure <server-url-with-box> --folder <path> [options]
bin/scan-uploader schedule <install|uninstall|status> [options]
bin/scan-uploader --help
```

`bin/scan-uploader` (repo root) wraps the built `dist/scan-uploader.mjs`;
on a machine holding only the copied bundle, run
`node scan-uploader.mjs <same args>`. The package also declares the bundle
as its `bin`, so it is npx-able if it's ever published.

`configure` (see Setup above) takes the token on stdin — piped, or prompted
without echo on a TTY — and supports `--disposition`, `--name`, and
`--config`; `configure --help` has the details. `schedule` manages the
periodic-sweep LaunchAgent (see "Scheduling the sweep" above); `schedule
--help` has the details.

Exit code is non-zero if any file was rejected or hit a transport-level
error (hash mismatch, over the size limit, or exhausted rate-limit
retries); zero otherwise. One line per file action is printed to stdout
(`uploaded`, `duplicate`, `rejected`, `skipped-unsettled`,
`skipped-identity-changed`); a one-line summary per target follows.

## ScanSnap profile setup

Configure one ScanSnap profile per box:

- **Format**: searchable PDF (ScanSnap's own OCR text layer — the server's
  document-extraction pipeline reads that layer rather than re-OCRing).
- **Output**: one PDF per scan job (don't batch unrelated documents into a
  single multi-document PDF — splitting a mixed batch is out of scope on
  both the scanner and server sides).
- **Destination folder**: the `folder` configured for that box above.
- **Nothing else** — in particular, no post-scan action. ScanSnap Home can
  only launch an application bundle there, not a script, so uploads are
  triggered by the launchd agent watching the destination folder instead
  (`schedule install`; see "Scheduling the sweep" above).

## Development

```bash
pnpm install   # from the monorepo root
pnpm build     # bundles src/cli.ts -> dist/scan-uploader.mjs
pnpm typecheck
pnpm lint
pnpm test      # doctests (agent-doctest) against a fake HTTP server + tmp fixtures
```

Tests use a fake HTTP implementation of the two scan routes
(`test/fake-scan-server.ts`) and package-local temp directories
(`test/tmp/`, gitignored) — never the real network or `/tmp`.
