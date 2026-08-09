# First-run setup stays silent once an owner exists

`maybeArmFirstRunSetup` prints a one-time claim link so a brand-new server can
have its owner account created. The gate used to be "zero local users", which is
wrong for the deployment shape this project actually runs: an owner who signs in
through Google OAuth has `CB_OWNER_EMAIL` set and *no* local password account,
so the local-user count is permanently zero. The link was therefore re-armed and
re-printed on every restart — 105 times on the deployed server — while being
unusable, since `POST /auth/setup` refuses to create an owner who doesn't match
`CB_OWNER_EMAIL`. The gate is now "no owner at all".

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { maybeArmFirstRunSetup } from "../../src/webapp/setup-token.js";

// Point the credential store at a path that does not exist, so there are zero
// local users in every case below — isolating the owner check as the variable.
process.env.CB_AUTH_FILE = path.join(os.tmpdir(), "cb-first-run-setup-doctest-absent.json");

function printedLines({ owner, openAccess }) {
  if (owner === null) delete process.env.CB_OWNER_EMAIL;
  else process.env.CB_OWNER_EMAIL = owner;
  const lines = [];
  const realLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    maybeArmFirstRunSetup({ publicUrl: "https://box.example.com", openAccess });
  } finally {
    console.log = realLog;
  }
  return lines;
}
```

## An OAuth-only owner (no local account) prints nothing

This is the deployed configuration, and the regression this test exists for.

```ts
printedLines({ owner: "owner@example.com", openAccess: false }).length
=> 0
```

## A genuinely unclaimed server still prints its claim link

```ts continue
const lines = printedLines({ owner: null, openAccess: false });
[lines.length, lines[0].startsWith("First-run setup: https://box.example.com/auth/setup?token=")]
=> [
  1,
  true
]
```

## Open access never prints, owner or not

There is no auth wall to claim past.

```ts continue
printedLines({ owner: null, openAccess: true }).length
=> 0
```

## Removing the last local member does not reopen first-run setup

An initialized store keeps an empty file as a durable setup tombstone.

```ts continue
await writeFile(process.env.CB_AUTH_FILE, JSON.stringify({ version: 1, users: [] }), { mode: 0o600 });
printedLines({ owner: null, openAccess: false }).length
=> 0
```

```ts cleanup
await rm(process.env.CB_AUTH_FILE, { force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_OWNER_EMAIL;
```
