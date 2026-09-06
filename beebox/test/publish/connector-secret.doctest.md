# The publish connector credential: store round-trip

`src/publish/connector-secret.ts` both READS and WRITES the submissions
connector's R2 credential, which makes it the one migrated reader whose two
halves must agree (`docs/implemented-plans/secret-custody.md`, Track 3). It writes to the
machine store under `publish/<box-slug>` as a JSON string, marked single-box
(`owningBox` + `shareable: false` — the token is scoped to one box's ingestion
bucket, so a second grant would point another box's submissions at the wrong
bucket), and reads it straight back. The store is the only source: the in-tree
`_config/connectors/publish.secret.json` this was migrated from is no longer
read.

Every token below is an obvious placeholder.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureConnectorSecret,
  publishSecretName,
  readPublishSecret,
} from "../../src/publish/connector-secret.js";
import { grantSecret, listSecrets, setSecret } from "../../src/core/secrets/lifecycle.js";
import { createFakeTokensClient } from "../../src/services/cloudflare-tokens.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

/** Run `fn` with console.warn captured; returns [result, warnings]. */
async function withWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    return [await fn(), warnings];
  } finally {
    console.warn = original;
  }
}
```

## Mint → store → read, in one round trip

```ts
const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
const tokens = createFakeTokensClient();

const ensured = await ensureConnectorSecret(
  { boxRoot: box.root, accountId: "test-account", bucketName: "pub-ingest" },
  { tokens },
);
print(`stored as: ${ensured.storeName === publishSecretName(slug) ? ensured.storeName.replace(slug, "<slug>") : "MISMATCH"}`);
print(`minted: ${ensured.minted}`);

const entry = (await listSecrets()).find((s) => s.name === publishSecretName(slug));
print(`single-box: ${JSON.stringify({ owningBox: entry.owningBox === slug, shareable: entry.shareable })}`);
print(`granted: ${JSON.stringify(Object.values(entry.grants))}`);

const read = await readPublishSecret(box.root);
print(`reads back: ${JSON.stringify({ accountId: read.accountId, bucket: read.bucket })}`);
=>
stored as: publish/<slug>
minted: true
single-box: {"owningBox":true,"shareable":false}
granted: ["server"]
reads back: {"accountId":"test-account","bucket":"pub-ingest"}
```

A rerun mints nothing: the stored credential already resolves, and reruns must
never leave orphan Cloudflare tokens behind.

```ts continue
const again = await ensureConnectorSecret(
  { boxRoot: box.root, accountId: "test-account", bucketName: "pub-ingest" },
  { tokens },
);
JSON.stringify({ minted: again.minted, json: again.json, mintCalls: tokens.minted.length })
=> {"minted":false,"json":null,"mintCalls":1}
```

## A malformed stored value is not-configured, not a throw

The legacy FILE keeps its strictness (a broken one the boxholder wrote should
be fixed, not read as "no publishing"), but the STORE is machine-wide: one bad
entry must not throw inside every connector sync.

```ts continue
await setSecret({ name: publishSecretName(slug), value: "not-json-at-all" });
const [bad, warnings] = await withWarnings(() => readPublishSecret(box.root));
print(`result: ${bad}`);
print(`warned: ${warnings.some((w) => w.includes("is not valid JSON"))}`);
=>
result: null
warned: true
```

## A retired file on disk configures nothing

```ts continue
process.env.BBX_SECRETS_FILE = join(dir, "no-store-here.json");
await box.write(
  "_config/connectors/publish.secret.json",
  JSON.stringify({ accountId: "file-account", bucket: "file-bucket", apiToken: "placeholder-file-token" }),
);
await readPublishSecret(box.root)
=> null
```

No entry is `null` — publishing is simply off:

```ts continue
await rm(join(box.root, "_config/connectors/publish.secret.json"));
await readPublishSecret(box.root);
=> null
```

A grant to a DIFFERENT box is refused, with an explanation rather than a bare
denial — the routing breakage is the reason, so the message says so:

```ts continue
process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
await grantSecret({ slug: "some-other-box", name: publishSecretName(slug), access: "server" })
=> throws SecretNotShareableError
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
