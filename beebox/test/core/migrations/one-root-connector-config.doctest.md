# one-root migration: connector config box-path fields rewrite too

Round-8 hardening finding 3: `rewriteConnectorConfigRefs`
(`src/core/migrations/one-root-connector-config.ts`) rewrites the box-path
fields inside connector config JSON that the general move machinery never
touches — `executeMoves` relocates the config FILE itself but never opens it,
and the migration's ref rewriter only opens `.card`/`.md` files. Gmail's
`action.ref` / `rules[].action.ref` (a `type: "procedure"` action naming its
procedure card) is the primary case: left in v2 form (`"config/procedures/…"`,
no underscore), `gmail-config.ts`'s own parser rejects it post-migration
(the regex requires the `_config/` prefix), silently stopping every
subsequent sync.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { rewriteConnectorConfigRefs } from "../../../src/core/migrations/one-root-connector-config.js";
import { OneRootPreflightError } from "../../../src/core/migrations/one-root-errors.js";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-connector-config-"));
  await fs.mkdir(path.join(root, "_config", "connectors"), { recursive: true });
  return root;
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
```

## Every named rule's `action.ref` rewrites; a `track` action is untouched

```ts
const root = await makeFixture();
const gmailPath = path.join(root, "_config", "connectors", "gmail.json");
await fs.writeFile(
  gmailPath,
  JSON.stringify({
    rules: [
      { name: "receipts", query: "label:receipts", action: { type: "procedure", ref: "config/procedures/file-receipt.procedure.card" } },
      { name: "invoices", query: "label:invoices", action: { type: "procedure", ref: "config/procedures/file-invoice.procedure.card" } },
      { name: "track-only", query: "label:misc", action: { type: "track" } },
    ],
  }),
);

const journal = [];
await rewriteConnectorConfigRefs({ packageRoot: root, journal });
const rewritten = JSON.parse(await fs.readFile(gmailPath, "utf-8"));
JSON.stringify({
  firstRuleRef: rewritten.rules[0].action.ref,
  secondRuleRef: rewritten.rules[1].action.ref,
  trackActionUntouched: rewritten.rules[2].action,
})
=> {"firstRuleRef":"_config/procedures/file-receipt.procedure.card","secondRuleRef":"_config/procedures/file-invoice.procedure.card","trackActionUntouched":{"type":"track"}}
```

An untracked config's pre-rewrite bytes are journaled (no git copy to fall
back to on rollback):

```ts continue
JSON.stringify({ journalLength: journal.length, journaledPath: journal[0]?.oldAbs === gmailPath })
=> {"journalLength":1,"journaledPath":true}
```

```ts cleanup
await cleanup(root);
```

## A rewrite that breaks the connector's own parser aborts the migration

An action `ref` that maps to something `gmail-config.ts`'s parser still
rejects (here: a `.card` name it can't validate, forced by pointing at a
`.txt` extension the schema's regex doesn't allow) fails the migration
closed rather than land a gmail.json a real sync would silently choke on.

```ts
const root = await makeFixture();
const gmailPath = path.join(root, "_config", "connectors", "gmail.json");
await fs.writeFile(
  gmailPath,
  JSON.stringify({ query: "label:oops", action: { type: "procedure", ref: "config/procedures/oops.txt" } }),
);

const err = await rewriteConnectorConfigRefs({ packageRoot: root, journal: [] }).catch((e) => e);
JSON.stringify({ isPreflightError: err instanceof OneRootPreflightError, mentionsFile: err.message.includes("gmail.json") })
=> {"isPreflightError":true,"mentionsFile":true}
```

```ts cleanup
await cleanup(root);
```

## The Google Drive legacy `folders[].localPath` field rewrites too

A pre-card folder mount's `localPath` (`drive-config.ts`) is box-relative,
the same box-path-bearing shape as Gmail's `ref` — found in the audit of
every connector config schema this hardening pass covered.

```ts
const root = await makeFixture();
const drivePath = path.join(root, "_config", "connectors", "google-drive.json");
await fs.writeFile(drivePath, JSON.stringify({ folders: [{ driveFolderId: "abc123", localPath: "store/drive/Reports" }] }));

const journal = [];
await rewriteConnectorConfigRefs({ packageRoot: root, journal });
const rewritten = JSON.parse(await fs.readFile(drivePath, "utf-8"));
JSON.stringify({ localPath: rewritten.folders[0].localPath })
=> {"localPath":"_content/drive/Reports"}
```

```ts cleanup
await cleanup(root);
```

## No connector configs at all: nothing throws, nothing is written

```ts
const root = await makeFixture();
const journal = [];
await rewriteConnectorConfigRefs({ packageRoot: root, journal });
journal.length
=> 0
```

```ts cleanup
await cleanup(root);
```
