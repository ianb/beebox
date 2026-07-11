# Adding a Box

How to provision a new box behind a `cb hub` (the multi-box parent process —
see "Serving" in [`docs/implemented-plans/boxes-as-packages-v2.md`](plans/boxes-as-packages-v2.md)
for the full design). This doc covers the generic shape; the concrete
commands below are annotated where they're specific to one example
deployment (`box.example.com`) rather than something every hub needs.

## The pieces

- **The box itself** is a v2 (package-layout) box: a small Node package with
  a `content/` directory inside it — see [`docs/box-layout.md`](box-layout.md)
  for the full shape. `cb init <path>` scaffolds a new one from scratch.
- **`hub.json`** is the routing table a `cb hub` process reads: a map of URL
  slug → box path, plus optional `port`/`host`/`lazy`/`idleMs`/`keepRecent`.
  See `src/hub/hub-config.ts` for the schema. The hub does **not** hot-reload
  this file — adding or removing a box entry needs a hub restart (SIGHUP
  only reloads the crash-loop latch, not the box list). With `lazy: true`,
  every configured box starts "stopped" instead of spawning at hub startup —
  the hub cold-starts a box's `cb serve` child on its first proxied request
  and idle-stops it again after `idleMs`, the same lazy-per-worktree
  semantics `bin/router.ts` uses for dev worktrees. `keepRecent: N`
  (lazy-only) keeps the N most-recently-used boxes alive rather than
  idle-stopping them, and pre-starts that set on a hub restart (recency is
  persisted to `hub-state.json` beside the config) — see `src/hub/CLAUDE.md`.
- **`cb serve`** (no hub) is still the standalone story for a single box —
  see the root [`README.md`](../README.md) for that path. This doc is about
  the multi-box case.

## 1. Create the box

```bash
mkdir <name> && cd <name>
pnpm dlx --package=<callback-box tarball> cb init .
pnpm install
```

Fill in the seed `content/briefing.briefing.card` with the box's purpose, key
people, and critical context — `cb wakeup` (or the next scheduler tick)
compiles it into the agent's generated docs.

Push the repo somewhere the hub host can reach it (its own git remote is the
box's normal history — nothing hub-specific here).

## 2. Register it with the hub

Add an entry to the hub's `hub.json` (default `~/.config/cb/hub.json`, or
wherever `cb hub --config <path>` points):

```jsonc
{
  "boxes": {
    "<slug>": { "path": "/path/to/<name>" }  // package root or content/ — the hub resolves either
  }
}
```

The slug becomes the URL prefix (`http://<hub-host>/<slug>/...`); it can't be
one of the hub's own reserved prefixes (`healthz`, `auth`, `webhook`, `api`),
and two slugs can't resolve to the same box (the hub refuses to load a config
that would start two engine processes against one box's `events.db`).

Restart the hub process to pick up the new entry:

```bash
systemctl restart cb-hub   # example deployment: adjust to how you run cb hub
```

## 3. Access control

Per-box access lives in the box's own `config/box.json`, checked by
`src/webapp/box-access.ts`:

```json
{ "allowedEmails": ["someone@example.com"] }
```

**This is fail-closed, not open**: a missing or empty `allowedEmails` means
*owner-only* access, not "any authenticated user." The owner is always
allowed and is never listed. Login itself (Google OAuth) is terminated by
the hub, which forwards the authenticated identity to each box over a
trusted internal header — the box's own `allowedEmails` check runs
regardless, so hub auth and per-box authorization are independent layers.

Webhooks (`/webhook/<slug>/...`) are unauthenticated by design so external
services (Telegram, etc.) can reach them.

## 4. Connector secrets

Per-box secrets go in the box's own `content/config/connectors/` (or
`config/connectors/` for a legacy-shape box):

```bash
echo '{"botToken":"...","webhookSecret":"..."}' > config/connectors/telegram.secret.json
```

Without a key, the affected connector emits a health warning but the box
still runs.

## Example deployment: box.example.com

The rest of this section documents one operator's concrete setup — adapt the
paths and service names for your own hub host, not copy them verbatim.

- Boxes live at `/home/callback/boxes/<name>/`, one per directory, each its
  own git repo.
- `hub.json` lives at `/home/callback/.config/cb/hub.json`.
- The hub runs as a systemd unit (`cb-hub` in examples above); see
  [`deploy/README.md`](../deploy/README.md) for the full provisioning story,
  including the current gap between that design and what the checked-in
  provisioning scripts (`deploy/add-box.sh`, `deploy/setup-server.sh`)
  actually automate today (they still target the pre-hub `callback-serve` +
  manifest shape — see that doc's "Known gaps" section).

## Troubleshooting

### Box exists but isn't served

Check the hub's own log/health output first (`GET /healthz` on the hub)
before assuming the box process itself is at fault — a box missing from
`hub.json`, or a slug typo, means the hub never spawns it at all.

### "API key not configured" warnings

The box is missing a connector secret (see step 4 above).

### Permission denied writing to box directories

If a box was provisioned as `root` instead of its intended service user, its
files won't be writable by the process that runs `cb hub`/`cb serve`. Fix
ownership recursively for the affected box directory.
