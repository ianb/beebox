# Boxes on the server

Provisioning a box behind the hub: the pieces, the by-hand steps, the one-command path, and what goes wrong.

## What it is

How to provision a new box behind a `bbx hub` (the multi-box parent process —
see "Serving" in [`docs/implemented-plans/boxes-as-packages-v2.md`](../implemented-plans/boxes-as-packages-v2.md)
for the full design). This doc covers the generic shape; the concrete
commands below are annotated where they're specific to one example
deployment (`box.example.com`) rather than something every hub needs.

## The pieces

- **The box itself** is a one-root box: a small Node package whose root
  directory is also the operational box — see
  [`docs/box-layout.md`](../box-layout.md) for the full shape. `bbx init <path>`
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
  see the root [`README.md`](../../README.md) for that path. This doc is about
  the multi-box case.

## Create the box

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

## Register it with the hub

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

## Access control

Per-box access is `allowedEmails` in the box's `_config/box.json`, fail-closed to
owner-only when absent: [per-box access control](configuration.md#per-box-access-control).

## Connector secrets

Secrets are **not** files in the box. They live in one machine-level store
(`~/.config/beebox/secrets.json`, 0600, outside every box tree) and a box reaches
one through a **grant** — see [`docs/secrets.md`](../secrets.md) for the full
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

## One command: `add-box.sh`

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
  box, pushes it to a private repo, and then does all of the above.
  (`deploy/setup-server.sh`, which provisions a *bare* server, still generates
  the pre-hub `beebox-serve` unit; that gap is described under
  [provisioning](provisioning.md#setting-up-the-host-hetznersetup-serversh).)

The whole process, in one command: clone the box repo, `bbx init` it, seed
access + connector secrets, register it with **both** manifests, restart the
services, and verify the new box actually serves. There is no by-hand
`hub.json` step.

```bash
# Using owner/repo shorthand
./deploy/add-box.sh ianb/hearth

# Using full SSH URL
./deploy/add-box.sh git@github.com:ianb/hearth.git

# With custom local name (this is also the URL slug)
./deploy/add-box.sh ianb/hearth my-family

# See what it would do, without changing anything (read-only on the server)
./deploy/add-box.sh ianb/hearth --dry-run
```

**A brand-new box** (no repo yet) uses `--create`, which scaffolds the box with
`bbx init`, pushes it to a private GitHub repo, and then adds it exactly as
above:

```bash
./deploy/add-box.sh --create hearth --allow someone@example.com --secrets-from lighthouse

# Into a repo you already made in the web UI (it must still be empty):
./deploy/add-box.sh --create hearth --repo ianb/hearth
```

The repo defaults to `<your gh login>/<box-name>` and is created private. An
existing **empty** repo is adopted; one that already has commits is refused,
because pushing a fresh scaffold over it would either do nothing or clobber it
— add that one with the plain form instead. The scaffold happens in a temp
directory and is not kept locally: the box's homes are its repo and the server.
Needs the `gh` CLI, authenticated.

Each box is served at `https://box.example.com/<box-name>/`.

The box name doubles as the URL slug, so it must be lowercase letters, digits,
and hyphens. Two manifests are written, and both are live:

- `~/.config/beebox/hub.json` — the hub's routing table (which slug serves which
  box). Written by `bbx hub add-box`, which validates the resulting config with
  the hub's own loader *before* replacing the file, so a reserved slug
  (`healthz`/`auth`/`webhook`/`api`) or a second slug for an already-registered
  box fails with nothing changed.
- `~/.config/beebox/boxes.json` — the scheduler's box list. Written by
  `bbx boxes add`.

Neither hot-reloads, so the script restarts `beebox-hub` and
`beebox-scheduler`. It then drives the hub's canary for the new slug, which
cold-starts the box and requires the box's own `/healthz` to answer through the
hub — so a successful run means the box process really came up and served, not
just that files were written. (It is a loopback check: nginx, TLS, the public
URL, and per-user access are not exercised.)

**Order of operations:** every argument's shape is validated, and the hub edit
is `--dry-run`ed against the live config, *before* anything is cloned — which
is where the failures this script used to hit at the very end now surface. It
is not a transaction, though: a failure in the clone, the `bbx init`, the
manifests, or the restart leaves the earlier steps done. The script names the
step that failed, and re-running is safe.

Re-running is idempotent: pull + re-init, both manifest steps no-op, access
config left alone.

**The box's push credential is set up too.** A GitHub deploy key attaches to
exactly one repo, so each box gets its own, reached through a per-box ssh host
alias (`IdentitiesOnly yes` keeps ssh from offering every key and tripping
GitHub's max-auth-attempts limit):

```
Host github.com-box-<name>
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_box_<name>
  IdentitiesOnly yes
```

`add-box.sh` creates the key if absent, writes that stanza, and points the box's
`origin` at `git@github.com-box-<name>:owner/repo.git`. Registering the public
key on GitHub is the step it cannot do for you on the plain path, so the script
ends by printing the key and the instruction — **including "Allow write
access"**, without which the box fetches but never pushes.

That last part matters more than it looks: a box with no usable push credential
works in every visible way — it serves, agents run, commits land locally — and
simply never reaches its remote, with nothing saying so. Admin → Backup reports
the symptom per box (see `src/core/box/backup-status.ts`).

On `--create`, where `gh` is already authenticated and already making the repo,
the key is registered automatically with write access. It is **sticky**: the
check is on the key material *and its write access*, not a title — so a re-run
finds the box's key already present and does nothing, a key an operator added by
hand under a different title still counts, and a key registered **read-only** is
reported rather than accepted (it would fetch and never push, which is the
failure this exists to prevent wearing a disguise). Read-only keys are not
auto-upgraded: GitHub has no in-place permission change, so fixing one means
deleting and re-adding it, which is the operator's call. The script never
rotates or replaces a credential on its own — a silent re-register is
indistinguishable from the orphaned-key failure — so replacing one means
removing the old key on GitHub and re-running deliberately.

If registration does not happen on a `--create` run, the script **exits
non-zero** after printing the manual step. The box is added and serving at that
point, but it cannot reach its remote, and exiting 0 would report exactly the
silent success this change exists to end.

Two caveats worth knowing. A key added through `gh` is tied to gh's auth token:
de-authorizing the GitHub CLI later removes the key, and the box stops pushing
silently. And the ssh alias is verified with `ssh -G` after the stanza is
written — if some other stanza already claims that alias with a different
identity, the script refuses rather than pointing `origin` at a key that will
not work.

A non-GitHub remote is left alone — the alias convention is a GitHub deploy-key
mechanism, and rewriting a remote for another host would only break it. An
`https://github.com/...` URL *is* handled: it clones fine, but a deploy key is
an SSH credential, so origin is moved to the aliased SSH form rather than left
on a URL the key cannot authenticate.

`--dry-run` still needs a `bbx` on the server that has `bbx hub add-box` — i.e.
a deploy from 2026-08 or later. On an older build the preflight fails with an
unknown-command error.

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
