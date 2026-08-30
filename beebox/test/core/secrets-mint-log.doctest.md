# Minting endpoints are audited too

Two endpoints hand a *derived* credential to the browser: `deepgramTempKey`
mints a TTL'd usage-scoped Deepgram key, and `openaiRealtimeKey` mints an
OpenAI realtime client secret. Neither discloses the box's stored key — but
both SPEND it, and a custody design that logged only value resolution would
audit the door and ignore the window (`docs/plans/secret-custody.md`, the
"operation surface" paragraph).

So the access log carries a third event, `mint`, beside `resolve` and `refuse`.
They stay deliberately **uncapped** (Decision 7: a hit rate limit is more
annoying and harder to understand than the risk it would bound) — the posture
is logged-and-visible, not throttled — and the log stays best-effort: a mint is
never blocked by an unwritable log.

Values are never logged, here as everywhere.

```ts setup
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessLogSegmentPath, recordSecretMint } from "../../src/core/secrets/access-log.js";
import { getBoxTimeISO } from "../../src/lib/time.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function readLog(iso) {
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

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
```
