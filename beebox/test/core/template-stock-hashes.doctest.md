# Template stock-hash ledger (rollout forcing function)

The box-local CLAUDE.md guides (`_config/schemas/CLAUDE.md`, `views/CLAUDE.md`)
ship through `installTemplateFile` with a `priorStockHashes` allowlist: a field
box whose on-disk guide matches any listed hash is recognized as our own
unmodified stock and cleanly overwritten on `bbx init`; a box matching none
(user-edited) is parked under `config/_template-updates/`.

The failure mode this guards: if you change a guide constant but forget to record
the *superseded* hash, boxes still on the old version match nothing and silently
**park** the update forever — discovered only by SSHing into a server box. So the
ledger (`src/core/template-stock-hashes.ts`) records `current` + every
`superseded` hash per guide, and this test fails if a constant drifts from its
recorded `current`. **When it fails, run `pnpm template-stock:update`** — it
retires the old hash into `superseded[]` (keeping `priorStockHashes` complete) and
records the new `current`.

(All logic lives in the setup block so the assertion lines carry no `=>` arrow
that the doctest separator would trip over.)

```ts setup
import { createHash } from "node:crypto";
import { MANAGED_STOCK_TEMPLATES } from "../../src/core/box/templates.js";
import { TEMPLATE_STOCK_HASHES } from "../../src/core/template-stock-hashes.js";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// Guides whose live content no longer matches the ledger's `current`.
function driftedGuides(): string[] {
  const out: string[] = [];
  for (const t of MANAGED_STOCK_TEMPLATES) {
    if (sha256(t.content) !== TEMPLATE_STOCK_HASHES[t.name]?.current) out.push(t.name);
  }
  return out;
}

// True when the managed set and the ledger keys are the same set.
function managedMatchesLedger(): boolean {
  const managed: string[] = [];
  for (const t of MANAGED_STOCK_TEMPLATES) managed.push(t.name);
  return JSON.stringify(managed.toSorted()) === JSON.stringify(Object.keys(TEMPLATE_STOCK_HASHES).toSorted());
}

// Entries where `current` also appears in `superseded`, or any hash repeats.
function inconsistentEntries(): string[] {
  const out: string[] = [];
  for (const [name, e] of Object.entries(TEMPLATE_STOCK_HASHES)) {
    const all = [e.current, ...e.superseded];
    if (e.superseded.includes(e.current) || new Set(all).size !== all.length) out.push(name);
  }
  return out;
}
```

## Every managed guide's live hash matches the ledger's `current`

If this lists a guide, its constant changed without the ledger being updated —
run `pnpm template-stock:update`.

```ts
driftedGuides()
=> []
```

## Every managed guide has a ledger entry, and vice versa

Adding a `MANAGED_STOCK_TEMPLATES` entry (or a ledger key) without the other side
would leave a guide untracked or a dangling record.

```ts
managedMatchesLedger()
=> true
```

## The ledger is internally consistent

`current` must not also appear in `superseded`, and no hash may be listed twice.

```ts
inconsistentEntries()
=> []
```
