---
title: "`add-box.sh` restarts a service that no longer exists and never registers the box with the hub"
workstream: unattached
area: callback-box
labels: [deploy, provisioning, hub]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder asked what the process is for adding a box
---

Adding a box to the deployed server is a half-automated process where the
automated half fails silently-ish and the manual half is only described in a
"known gap" note. The deliverable here is **one clean process**, not just the
one-line script fix.

## What's broken, verified against the live server 2026-08-17

`deploy/add-box.sh:150` ends with:

```bash
systemctl restart callback-serve callback-scheduler
```

**`callback-serve` no longer exists.** The live units are
`callback-hub.service` ("Callback Box Hub (per-box supervisor + router)") and
`callback-scheduler.service`. So the script's final step fails, after it has
already done real work (clone, `cb init`, `config/box.json`, secret copying) —
the worst place to fail, because the operator is left unsure how much landed.

It also **never writes the hub routing entry**, which is what actually serves
the box. `deploy/README.md:119-126` documents this as a known gap and says to
add the box by hand; nothing in the script's own output says so.

The comment at `add-box.sh:148` explains the restart in terms of
`~/.config/cb/boxes.json`, which is the pre-hub manifest. That file still
exists on the server beside `hub.json`, which is its own small confusion worth
resolving: one of them is live and one is residue.

## What the process actually is today

1. `deploy/add-box.sh <owner/repo> [name] [--allow EMAIL] [--secrets-from BOX]`
   — clone, `cb init`, `config/box.json`, copy connector secrets. Idempotent.
   Expect the restart at the end to fail.
2. Hand-edit `~/.config/cb/hub.json` (the documented default path) to add
   `"<slug>": { "path": "/home/callback/boxes/<name>" }`.
3. `systemctl restart callback-hub` — the hub does **not** hot-reload its box
   list; SIGHUP only resets the crash-loop latch.
4. Access lives in the box's own `content/config/box.json` → `allowedEmails`,
   fail-closed (missing or empty means owner-only; the owner is never listed).
5. Connector secrets in `content/config/connectors/*.secret.json`.

Two `hub.json.bak-*` files sit next to the live config — hand-editing is
evidently the norm, which is the thing to fix.

## Fix directions

- **Make the script complete**: write the `hub.json` entry, restart
  `callback-hub`, drop `callback-serve`. Roughly three lines, and it makes
  `add-box.sh` the single command again.
- **Make it safe to re-run and safe to fail.** It already claims idempotence
  for the clone/init half; the hub-config edit needs the same property, plus a
  guard against the failure modes the hub itself rejects (a slug colliding with
  a reserved prefix — `healthz`/`auth`/`webhook`/`api` — or two slugs resolving
  to one box, which the hub refuses because it would run two engines against
  one `events.db`). Failing *before* mutating anything beats failing after.
- **Reconcile the docs.** `docs/adding-a-box.md` describes the generic shape
  with `cb-hub` as an example unit name; the real unit is `callback-hub`.
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
included. Structural facts (`/home/callback/boxes/<name>`, unit names, config
shape) are fine; the names of what is actually deployed are not. Use invented
slugs in fixtures and examples.
