---
title: "`add-box.sh` restarts a service that no longer exists and never registers the box with the hub"
workstream: add-box-process
area: beebox
labels: [deploy, provisioning, hub]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder asked what the process is for adding a box
needs: [manual-testing]
priority: normal
---

> **⏳ Awaiting manual testing** — the fix landed on `worktree-add-box-process`
> (`d72111bb` + `fe30d4d5`). Everything reachable without production is
> verified; the one thing that is not is a real run against the live server.
> Only the boxholder clears this — see [Manual testing](#manual-testing).

Adding a box to the deployed server is a half-automated process where the
automated half fails silently-ish and the manual half is only described in a
"known gap" note. The deliverable here is **one clean process**, not just the
one-line script fix.

## What's broken, verified against the live server 2026-08-17

`deploy/add-box.sh:150` ends with:

```bash
systemctl restart beebox-serve beebox-scheduler
```

**`beebox-serve` no longer exists.** The live units are
`beebox-hub.service` ("Bee Box Hub (per-box supervisor + router)") and
`beebox-scheduler.service`. So the script's final step fails, after it has
already done real work (clone, `bbx init`, `config/box.json`, secret copying) —
the worst place to fail, because the operator is left unsure how much landed.

It also **never writes the hub routing entry**, which is what actually serves
the box. `deploy/README.md:119-126` documents this as a known gap and says to
add the box by hand; nothing in the script's own output says so.

The comment at `add-box.sh:148` explains the restart in terms of
`~/.config/beebox/boxes.json`, which is the pre-hub manifest. That file still
exists on the server beside `hub.json`, which is its own small confusion worth
resolving: one of them is live and one is residue.

## What the process actually is today

1. `deploy/add-box.sh <owner/repo> [name] [--allow EMAIL] [--secrets-from BOX]`
   — clone, `bbx init`, `config/box.json`, copy connector secrets. Idempotent.
   Expect the restart at the end to fail.
2. Hand-edit `~/.config/beebox/hub.json` (the documented default path) to add
   `"<slug>": { "path": "/home/beebox/boxes/<name>" }`.
3. `systemctl restart beebox-hub` — the hub does **not** hot-reload its box
   list; SIGHUP only resets the crash-loop latch.
4. Access lives in the box's own `content/config/box.json` → `allowedEmails`,
   fail-closed (missing or empty means owner-only; the owner is never listed).
5. Connector secrets in `content/config/connectors/*.secret.json`.

Two `hub.json.bak-*` files sit next to the live config — hand-editing is
evidently the norm, which is the thing to fix.

## Fix directions

- **Make the script complete**: write the `hub.json` entry, restart
  `beebox-hub`, drop `beebox-serve`. Roughly three lines, and it makes
  `add-box.sh` the single command again.
- **Make it safe to re-run and safe to fail.** It already claims idempotence
  for the clone/init half; the hub-config edit needs the same property, plus a
  guard against the failure modes the hub itself rejects (a slug colliding with
  a reserved prefix — `healthz`/`auth`/`webhook`/`api` — or two slugs resolving
  to one box, which the hub refuses because it would run two engines against
  one `events.db`). Failing *before* mutating anything beats failing after.
- **Reconcile the docs.** `docs/adding-a-box.md` describes the generic shape
  with `bbx-hub` as an example unit name; the real unit is `beebox-hub`.
  `deploy/README.md`'s "known gap" note should disappear rather than being
  updated, because the gap should stop existing.
- **Decide `boxes.json`'s fate** — live config or residue. If residue, remove
  it and the comment that references it.

## The hard part: how this gets verified

Provisioning runs against production, and "add a box to check the script works"
is not a cheap test. Work out the verification story before writing the fix —
options worth weighing rather than assuming: a `--dry-run` that prints the
hub-config diff and the units it would restart; exercising the config-editing
logic as a pure function against a fixture `hub.json` in a doctest; a
throwaway slug added and removed on the server; or a local hub with a
temporary config directory.

The config-mutation logic almost certainly wants to be a testable module rather
than inline `jq` in bash — that is what makes the rest of this verifiable at
all.

## Constraint

The server hosts real personal boxes. **No real box slug, path, or content
detail belongs in this repo** — commit messages, test fixtures, and docs
included. Structural facts (`/home/beebox/boxes/<name>`, unit names, config
shape) are fine; the names of what is actually deployed are not. Use invented
slugs in fixtures and examples.

## What was built (2026-08-17)

`deploy/add-box.sh` is now the whole process. New `bbx hub add-box <slug>
<path>` (`beebox/src/hub/hub-config-edit.ts`) writes the `hub.json`
entry: it plans the edit, validates the candidate through the hub's own loader
(`parseHubConfig`, extracted from `loadHubConfig`), and only then writes it
atomically. The script validates every argument locally, `--dry-run`s the hub
edit against the live config before it clones, registers with the hub and then
the scheduler, restarts `beebox-hub` + `beebox-scheduler`, and drives the
hub's canary for the new slug.

`boxes.json` is **not** residue — it is the scheduler's live manifest (checked
on the server: both manifests hold the same box count). Only the comment
claiming `bbx serve` reads it was wrong.

Docs now match: the "known gap" note is gone, the unit is `beebox-hub`
throughout the live runbooks, and `rebuild-server.sh` no longer restarts the
dead unit either. `setup-server.sh`'s separate pre-hub provisioning gap is
unchanged and still documented in `deploy/README.md`.

A cross-model review found a bug the rewrite had inherited: `--allow` and
`--secrets-from` wrote to `$BOX_PATH/config/`, but a v2 box keeps `config/`
under `content/` — so `--allow` on a new box crashed the remote script. Fixed,
along with validating `hub.json` on the idempotent path (the script restarts
the hub afterwards), making a `bbx init` failure fatal, and printing success
only after the canary.

## Verification

Done: the config-edit module is a doctest against fixture configs with invented
slugs (`test/hub/hub-config-edit.doctest.md`, 25 assertions — add, idempotence,
package-root-vs-`content/`, reserved slug, malformed slug, duplicate box,
slug-repoint, missing config, unparseable config, concurrent-edit refusal); the
CLI was exercised end to end against a scratch hub config; the full suite passes
(7087). Read-only inspection of the server confirmed the unit names, that both
manifests are live and consistent, and the `content/config/` layout.

Not done: a real box added on the live server. That was deliberately not
attempted from an agent session.

## Manual testing

The server's `bbx` needs this code first, so this can only be tested after the
branch merges to `main` and deploys.

1. `./deploy/add-box.sh <repo> <name> --dry-run` — expect the planned hub entry
   and the list of steps, with nothing changed. Re-running `bbx hub add-box` for
   a box that is already registered should say "Already registered".
2. Try a bad slug (`--dry-run` with a name containing an uppercase letter or an
   underscore, and with the name `api`) — both should fail immediately, before
   any SSH work.
3. A real add: `./deploy/add-box.sh <repo> <name> --secrets-from <box>`. Expect
   it to end with "Canary OK" and the box to load at
   `https://box.example.com/<name>/`. Check that `content/config/connectors/`
   in the new box has the copied secrets (not a stray package-root `config/`).
4. Re-run the same command — expect a pull, both manifest steps reporting
   already-present, and a second "Canary OK".
