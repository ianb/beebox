# scan-uploader

A stand-alone laptop client that uploads scanned files (from a Fujitsu
ScanSnap or similar) to a [callback-box](../callback-box) instance's
scan-upload endpoint. TypeScript, zero runtime dependencies (Node stdlib
only), bundled by esbuild into a single self-contained script — `node
dist/scan-uploader.mjs` runs it on any machine with no checkout, no `cb`,
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

Files the server rejects (failed validation) are never moved or deleted —
they stay in place, print with the server's reason, and make the process
exit non-zero. Pass `--retry-rejected` to re-`PUT` them (the server
re-validates; useful after a validator fix upstream).

This package is the client half of a wire contract shared with the server;
the server side and the exact request/response shapes live in
[`../callback-box/docs/scan-upload-contract.md`](../callback-box/docs/scan-upload-contract.md).
Every place in this codebase that encodes part of that contract carries a
`// WIRE CONTRACT (scan-upload): …` comment — change both sides together.

## Config

JSON file, path given as the first CLI argument (default
`./scan-uploader.json`, resolved relative to the current directory):

```json
{
  "targets": [
    {
      "folder": "/Users/user/Scans/Family",
      "serverUrl": "https://cb.example.org",
      "box": "family",
      "tokenPath": "/Users/user/.scan-tokens/family.token",
      "disposition": "archive"
    }
  ]
}
```

- `folder` — absolute path to watch. Required.
- `serverUrl` — the callback-box instance's base URL. Required.
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
node dist/scan-uploader.mjs [config.json] [--retry-rejected]
node dist/scan-uploader.mjs --help
```

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
- **Post-scan hook**: point the ScanSnap application's post-scan action at
  a one-line shell wrapper that runs `node /path/to/scan-uploader.mjs
  /path/to/scan-uploader.json`. The same command doubles as a manual or
  periodic sweep (e.g. a cron job) — the check endpoint's dedup makes a
  hook-plus-sweep double-run harmless.

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
