---
title: "`bbx serve` isn't a box command — extract the server out of the `bbx` CLI"
workstream: unknown
area: beebox
labels: [cli, packaging, boxes]
priority: backlog
---

`bbx` is the box-agent-facing command surface. `bbx serve` is an operator/dev
command — agents aren't supposed to run it — so it doesn't belong there. It
should be extracted behind something like `pnpm serve` / its own entry point.

`bbx` currently exposes **62 registered top-level commands**. `serve` and `hub`
are the clearest non-agent ones; the whole surface deserves a pass, tracked in
[audit the `bbx` subcommand surface](2026-08-08-audit-bbx-subcommand-surface.md).

## The bigger cost is dependencies, not bundle bytes

The bundle-size worry turns out to be mostly wrong, and the real problem is
worse. `scripts/build-cli.mjs` sets `packages: "external"`, so third-party deps
are **not** bundled — `dist/cli.mjs` is 2.7 MB of our own source. Splitting the
server out would trim that (`src/webapp` is 17,058 lines and `src/hub` 2,399, of
~191,000 total), but bytes aren't the point.

The dependency weight is. `beebox/package.json` declares **46 runtime
dependencies**, and **boxes are packages that depend on `beebox`** — so
every box install pulls the whole server tree even though box code imports only
the three public specifiers (`beebox/{cards,schema,view-widgets}`):

- `fastify` + `@fastify/{cookie,multipart,static,websocket}`
- `@trpc/server`
- **`better-sqlite3`** — a native addon, so every box install *compiles* it.
  This is why a Node major bump breaks boxes with `NODE_MODULE_VERSION`
  mismatches; that pain propagates to every box that will never serve anything.

Extraction would let a box depend on a small cards/schema/view package and skip
the server tree entirely. That's the win worth having.

Two need a judgment call rather than an assumption:

- `esbuild` — used by the view compiler (`src/webapp/views/compiler.ts`). Boxes
  don't compile their own views, the engine does, so this looks server-side, but
  confirm against `bbx view test` / `view-typecheck`, which are plausibly
  box-facing.
- `react` / `react-dom` — box view code imports React directly, so these are
  probably legitimately box dependencies, not server-only. Don't strip them
  reflexively.

## Real callers to migrate

`bbx serve` is not just a dev convenience — extraction has to keep these working:

- `src/hub/supervisor.ts:432` spawns `["serve", boxRoot, "--slug", …]` as a
  child process per box. The hub is how prod runs; see
  `beebox/CLAUDE.md`.
- systemd units in `deploy/setup-server.sh:210` and
  `deploy/migrate-to-callback-user.sh:93` invoke `/usr/local/bin/bbx serve`
  directly (`deploy/README.md:191` says the live server now runs `bbx hub`, so
  these may be stale — check before touching).
- The dev router reaches it through `bbx hub` (`bin/router.ts` →
  `hub.json` → child spawn).

So the extraction is a packaging change with a deploy story, not a rename.
Sequence it so prod is never mid-migration: ship the new entry point, move
callers, then remove the `bbx` subcommand.

## Open questions

- One extracted package, or does `hub` go with it? They're the same audience.
- Does the split follow the `beebox/{cards,schema,view-widgets}` export
  boundary that already exists, or is it a separate package?
- What do the box templates and `bbx init` need to change to stop declaring the
  server tree?
