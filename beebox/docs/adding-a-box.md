# Adding a Box

How to provision a new box behind a `bbx hub` (the multi-box parent process —
see "Serving" in [`docs/implemented-plans/boxes-as-packages-v2.md`](implemented-plans/boxes-as-packages-v2.md)
for the full design). This doc covers the generic shape; the concrete
commands below are annotated where they're specific to one example
deployment (`box.example.com`) rather than something every hub needs.

## The pieces

- **The box itself** is a one-root box: a small Node package whose root
  directory is also the operational box — see
  [`docs/box-layout.md`](box-layout.md) for the full shape. `bbx init <path>`
  scaffolds a new one from scratch.
- **`hub.json`** is the routing table a `bbx hub` process reads: a map of URL
  slug → box path, plus optional `port`/`host`/`lazy`/`idleMs`/`keepRecent`.
  See `src/hub/hub-config.ts` for the schema. The hub does **not** hot-reload
  this file — adding or removing a box entry needs a hub restart (SIGHUP
  only reloads the crash-loop latch, not the box list). With `lazy: true`,
  every configured box starts "stopped" instead of spawning at hub startup —
  the hub cold-starts a box's `bbx serve` child on its first proxied request
  and idle-stops it again after `idleMs`, the same lazy-per-worktree
  semantics `bin/router.ts` uses for dev worktrees. `keepRecent: N`
  (lazy-only) keeps the N most-recently-used boxes alive rather than
  idle-stopping them, and pre-starts that set on a hub restart (recency is
  persisted to `hub-state.json` beside the config) — see `src/hub/CLAUDE.md`.
- **`bbx serve`** (no hub) is still the standalone story for a single box —
  see the root [`README.md`](../README.md) for that path. This doc is about
  the multi-box case.

## 1. Create the box

```bash
mkdir <name> && cd <name>
pnpm dlx --package=<beebox tarball> bbx init .
pnpm install
```

Fill in the seed `_content/briefing.briefing.card` with the box's purpose, key
people, and critical context — `bbx wakeup` (or the next scheduler tick)
compiles it into the agent's generated docs.

Push the repo somewhere the hub host can reach it (its own git remote is the
box's normal history — nothing hub-specific here).

## 2. Register it with the hub

Use `bbx hub add-box`, which writes the entry to the hub's `hub.json` (default
`~/.config/beebox/hub.json`, or wherever `bbx hub --config <path>` points):

```bash
bbx hub add-box <slug> /path/to/<name>     # the box root — one root, nothing else to resolve
bbx hub add-box <slug> /path/to/<name> --dry-run   # print the change, write nothing
```

Run it as the user that owns the config. It is idempotent: registering a box
that is already registered under the same slug reports that and leaves the
file alone.

The resulting entry is just:

```jsonc
{
  "boxes": {
    "<slug>": { "path": "/path/to/<name>" }
  }
}
```

The slug becomes the URL prefix (`http://<hub-host>/<slug>/...`); it can't be
one of the hub's own reserved prefixes (`healthz`, `auth`, `webhook`, `api`),
and two slugs can't resolve to the same box (the hub refuses to load a config
that would start two engine processes against one box's `events.db`). Both
rules are enforced by `bbx hub add-box` *before* it writes, using the hub's own
config loader — which is the reason to use it rather than editing the file:
hand-editing defers those errors to the hub's next startup, after the live
file has already been replaced.

The command deliberately refuses to create a `hub.json` that doesn't exist —
a config invented from scratch would drop the `port`/`host`/`lazy` settings
the running hub depends on. Write the first one by hand.

Restart the hub process to pick up the new entry:

```bash
systemctl restart beebox-hub   # example deployment: adjust to how you run bbx hub
```

## 3. Access control

Per-box access lives in the box's own `_config/box.json`, checked by
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

Secrets are **not** files in the box. They live in one machine-level store
(`~/.config/beebox/secrets.json`, 0600, outside every box tree) and a box reaches
one through a **grant** — see [`docs/secrets.md`](secrets.md) for the full
model. Provisioning a box is therefore granting, never copying:

```bash
bbx secrets status <box>                 # what this box is granted, and what it still needs
printf %s "$KEY" | bbx secrets set mistral   # store or rotate the one copy (stdin, never argv)
bbx secrets grant <box> mistral          # the per-box opt-in
bbx secrets copy-grants <from-box> <box> # give a new box the same grants a reference box holds
```

`copy-grants` is what `deploy/add-box.sh --secrets-from` runs. It skips
secrets that bind structurally to one box — a Telegram bot token routes to a
single webhook URL — and names each skip: that box needs its own, connected
from its admin page.

Without a granted key the affected connector emits a health warning but the box
still runs; `bbx secrets status` names exactly which grant is missing.

Legacy `_config/connectors/*.secret.json` files no longer work as a fallback —
the machine secret store is the only source a connector reads from — but
`bbx health` still flags any stray file it finds. Don't create new ones — move
a machine's existing files into the store once with `bbx secrets migrate`
(`--dry-run` prints the plan first), then delete the originals.

## Example deployment: box.example.com

The rest of this section documents one operator's concrete setup — adapt the
paths and service names for your own hub host, not copy them verbatim.

- Boxes live at `/home/beebox/boxes/<name>/`, one per directory, each its
  own git repo.
- `hub.json` lives at `/home/beebox/.config/beebox/hub.json`.
- The hub runs as a systemd unit (`beebox-hub` in examples above).
- On that deployment the whole of this document is one command:
  `deploy/add-box.sh <repo> [name]` does the clone, the `bbx init`, the access
  config, the secrets, both manifest registrations, the restart, and a canary
  check that the new box serves. For a box that does not exist yet,
  `deploy/add-box.sh --create <name>` covers step 1 as well — it scaffolds the
  box, pushes it to a private repo, and then does all of the above. See
  [`deploy/README.md`](../deploy/README.md).
  (`deploy/setup-server.sh`, which provisions a *bare* server, still generates
  the pre-hub `beebox-serve` unit — that gap is separate, and described in
  that same doc.)

## Troubleshooting

### Box exists but isn't served

Check the hub's own log/health output first (`GET /healthz` on the hub)
before assuming the box process itself is at fault — a box missing from
`hub.json`, or a slug typo, means the hub never spawns it at all.

### "API key not configured" warnings

The box has no grant for that connector's secret (see step 4 above).
`bbx secrets status <box>` says which — a missing grant, a granted name whose
value was never supplied, or a grant whose secret was removed.

### Permission denied writing to box directories

If a box was provisioned as `root` instead of its intended service user, its
files won't be writable by the process that runs `bbx hub`/`bbx serve`. Fix
ownership recursively for the affected box directory.
