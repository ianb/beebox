# scan-uploader

A stand-alone laptop client that uploads ScanSnap output to a box's scan-upload
endpoint. Read [README.md](README.md) for what it does and how it is set up;
this file is only the constraints that are not obvious from the code.

## This package is copied, not installed

The deliverable is a single `dist/scan-uploader.mjs` that runs on a machine with
no checkout, no `bbx`, and no `npm install`. Three consequences:

- **Zero runtime dependencies.** Node stdlib only. Do not add a dependency, and
  do not reach for a CLI tool as if it were one: `terminal-notifier` and `trash`
  are Homebrew installs, so anything that needs them degrades to an `osascript`
  fallback or a no-op. `smoke-install.sh` is the executable check that a clean
  clone still produces a bundle that runs from a bare directory.
- **Build-time code must not reach the runtime graph.** `src/build-revision.ts`
  shells out to `git`, which the target machines do not have; it stays in its own
  module that only `build.ts` imports. Verify with a grep on `dist/` after
  building, not by reasoning about tree-shaking.
- **A copied bundle never updates itself.** Nothing fetches it and nothing
  self-updates, so the only remedy for a stale copy is rebuilding and copying
  the file again. Say that, in any message about drift.

macOS-only behaviour (the `trash` disposition, `schedule`, notifications) either
refuses outright or degrades to a no-op elsewhere — match whichever the
neighbouring code does rather than inventing a third posture.

## The wire contract is shared with a package that shares no code

[`../beebox/docs/scan-upload-contract.md`](../beebox/docs/scan-upload-contract.md)
is the only coordination point with the server. Every site here that encodes
part of it carries `// WIRE CONTRACT (scan-upload): …`. Change both sides, that
document, and the server's route doctests in one change.

**If you change what a correct client must *do*, bump
`SCAN_CONTRACT_VERSION`** in `src/contract-version.ts` *and* in
`beebox/src/core/scan/contract-version.ts` — two spellings of one number, never
per-side versions. That covers the client obligations (settle gate, identity
snapshot, restat-before-disposition, which responses permit a disposition), the
check-state vocabulary, a status the client branches on, a limit the client must
respect, and the hash or path shape. It does *not* cover an additive field, a
`reason` string, or anything server-internal.

The real question is never "does this touch something the contract mentions", it
is **"can a client built before this change still do the right thing"** — so go
and read the client's handling before deciding. Relaxing a requirement usually
needs no bump (`parseRetryAfter` already defaults when the header is absent, so
a `429` that omits it is a non-event). The contract doc's
["When to bump"](../beebox/docs/scan-upload-contract.md) section has both
tables and the worked reasoning. **When it is unclear, bump:** a needless bump
costs one spurious "out of date" line, and a missed bump reports a stale client
as current, which is worse than having no version at all. Nothing can test that
you bumped it.

One shape needs more than a bump. Making the server **require** something new
refuses old clients on its own, and every copied bundle fails until someone
re-copies it by hand — so ship it accept-but-not-require first, confirm the
fleet has updated (the box's `scan-uploaders` health check reports each
uploader's build), and only then make it mandatory. The contract doc's "Adding
something the client must now send" has the sequence.

Two things that are *not* this number: the build stamp (`src/build-stamp.ts`) is
baked in by the build and never hand-edited, and `package.json`'s `version` is
inert — leave it alone rather than growing a second number that means something
different.

## Reporting to a human

The sweep runs under launchd with stdout going to
`~/Library/Logs/scan-uploader.log`, which nobody reads. Anything a person needs
to know goes through `src/notify.ts`, under two rules its header explains in
full: silence on a quiet sweep, and only newly-observed events. A *sticky*
condition — a rejected file the server keeps remembering, a drift verdict that
holds until someone re-copies the bundle — must not be notified per sweep, or
the reader learns to ignore notifications. Sticky conditions belong on stdout,
or on the box side where `bbx health` reports a standing condition without
nagging.

## Development

```bash
pnpm typecheck
pnpm lint
pnpm test                      # tap over test/**/*.doctest.md
pnpm exec tap test/<name>.doctest.md
pnpm build                     # only needed for the copy-the-bundle path
```

`bin/scan-uploader` (repo root) runs the CLI from source via tsx, so a checkout
needs no build. Tests use a fake HTTP server (`test/fake-scan-server.ts`) and
package-local temp dirs (`test/tmp/`) — never the real network, never `/tmp`.

Doctests here use bare fences (` ``` `, ` ```continue `, ` ```cleanup `), not
beebox's `ts`-tagged convention. Read
[`../agent-doctest/docs/syntax.md`](../agent-doctest/docs/syntax.md) first —
in particular that a `cleanup` block tears down the block it follows, so a
resource and its teardown belong in one `continue` chain.
