# Minting endpoints are audited too

Two endpoints hand a *derived* credential to the browser: `deepgramTempKey`
mints a TTL'd usage-scoped Deepgram key, and `openaiRealtimeKey` mints an
OpenAI realtime client secret. Neither discloses the box's stored key — but
both SPEND it, and a custody design that logged only value resolution would
audit the door and ignore the window (`docs/implemented-plans/secret-custody.md`, the
"operation surface" paragraph).

So the access log carries a third event, `mint`, beside `resolve` and `refuse`.
They stay deliberately **uncapped** (Decision 7: a hit rate limit is more
annoying and harder to understand than the risk it would bound) — the posture
is logged-and-visible, not throttled — and the log stays best-effort: a mint is
never blocked by an unwritable log.

Values are never logged, here as everywhere.

```ts setup
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACCESS_LOG_RETENTION_MONTHS,
  accessLogSegmentPath,
  pruneSecretAccessLog,
  recordSecretMint,
} from "../../../src/core/secrets/access-log.js";
import { setSecret } from "../../../src/core/secrets/lifecycle.js";
import { loadSecretStore, mutateSecretStore, secretsLogDir } from "../../../src/core/secrets/store.js";
import { getBoxTimeISO } from "../../../src/lib/time.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

async function readLog(iso: string) {
  const lines = (await readFile(accessLogSegmentPath(iso), "utf-8")).trim().split("\n");
  return lines.map((line) => JSON.parse(line));
}
```

## A mint appends one line naming the box, the secret, and the purpose

```ts
const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
const box = await makeTmpBox();

await recordSecretMint({ boxRoot: box.root, slug: "example-box", secret: "deepgram", purpose: "deepgram-temp-key" });
await recordSecretMint({ boxRoot: box.root, slug: "example-box", secret: "openai-thinking", purpose: "openai-realtime-client-secret" });

const events = await readLog(getBoxTimeISO(box.root));
for (const e of events) print(`${e.event} ${e.box} ${e.secret} ${e.purpose}`);
print(`each line is timestamped: ${events.every((e) => typeof e.ts === "string")}`);
=>
mint example-box deepgram deepgram-temp-key
mint example-box openai-thinking openai-realtime-client-secret
each line is timestamped: true
```

Uncapped by design — ten mints in a row are ten log lines, not a refusal:

```ts continue
const mints = Array.from({ length: 10 }, () => recordSecretMint({ boxRoot: box.root, slug: "example-box", secret: "deepgram", purpose: "deepgram-temp-key" }));
await Promise.all(mints);
(await readLog(getBoxTimeISO(box.root))).length
=> 12
```

Without an authoritative slug the box's own is derived from disk, so a mint is
always attributable to some box:

```ts continue
await recordSecretMint({ boxRoot: box.root, secret: "deepgram", purpose: "deepgram-temp-key" });
const derived = (await readLog(getBoxTimeISO(box.root))).at(-1);
derived.box.startsWith("bbx-doctest-")
=> true
```

## Segments older than twelve months are deleted

`bbx wakeup` housekeeping runs `pruneSecretAccessLog`. It keeps the current
month and the twelve before it, and leaves files it did not write alone.
`lastUsed` on the store entry is untouched, so "is this still in use" survives
the deletion of the segment that recorded the use.

```ts continue
const logDir = secretsLogDir();
await mkdir(logDir, { recursive: true });
for (const name of ["2025-08.jsonl", "2025-09.jsonl", "2025-10.jsonl", "2026-10.jsonl", "notes.txt", "2024-01.jsonl.bak"]) {
  await writeFile(join(logDir, name), "");
}
await setSecret({ name: "deepgram", value: "placeholder-deepgram-key" });
await mutateSecretStore({ purpose: "test" }, (store) => {
  const entry = store.secrets.deepgram;
  if (entry !== undefined) entry.lastUsed = { "example-box": "2025-08-15T12:00:00.000Z" };
});

print(`retention: ${ACCESS_LOG_RETENTION_MONTHS} months`);
print(`pruned: ${(await pruneSecretAccessLog(new Date("2026-10-17T12:00:00Z"))).join(", ")}`);
print(`kept: ${(await readdir(logDir)).toSorted().join(", ")}`);
const store = await loadSecretStore();
print(`lastUsed survives: ${store.ok && store.value.secrets.deepgram?.lastUsed?.["example-box"]}`);
print(`second sweep: ${(await pruneSecretAccessLog(new Date("2026-10-17T12:00:00Z"))).length}`);
=>
retention: 12 months
pruned: 2025-08.jsonl, 2025-09.jsonl
kept: 2024-01.jsonl.bak, 2025-10.jsonl, 2026-10.jsonl, notes.txt
lastUsed survives: 2025-08-15T12:00:00.000Z
second sweep: 0
```

A machine with no log yet has nothing to sweep:

```ts continue
process.env.BBX_SECRETS_FILE = join(dir, "never-used", "secrets.json");
(await pruneSecretAccessLog(new Date())).length
=> 0
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
