// # Minting endpoints are audited too
//
// Two endpoints hand a *derived* credential to the browser: `deepgramTempKey`
// mints a TTL'd usage-scoped Deepgram key, and `openaiRealtimeKey` mints an
// OpenAI realtime client secret. Neither discloses the box's stored key — but
// both SPEND it, and a custody design that logged only value resolution would
// audit the door and ignore the window (`docs/implemented-plans/secret-custody.md`, the
// "operation surface" paragraph).
//
// So the access log carries a third event, `mint`, beside `resolve` and `refuse`.
// They stay deliberately **uncapped** (Decision 7: a hit rate limit is more
// annoying and harder to understand than the risk it would bound) — the posture
// is logged-and-visible, not throttled — and the log stays best-effort: a mint is
// never blocked by an unwritable log.
//
// Values are never logged, here as everywhere.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
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
import { makeTmpBox } from "../../helpers/test-helpers.js";

async function readLog(iso: string) {
  const lines = (await readFile(accessLogSegmentPath(iso), "utf-8")).trim().split("\n");
  return lines.map((line) => JSON.parse(line));
}

// ## A mint appends one line naming the box, the secret, and the purpose
void test("A mint appends one line naming the box, the secret, and the purpose", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  const box = await makeTmpBox();

  await recordSecretMint({ boxRoot: box.root, slug: "example-box", secret: "deepgram", purpose: "deepgram-temp-key" });
  await recordSecretMint({ boxRoot: box.root, slug: "example-box", secret: "openai-thinking", purpose: "openai-realtime-client-secret" });

  const deepgramMint = { ts: isoDate(), box: "example-box", secret: "deepgram", purpose: "deepgram-temp-key", event: "mint" };
  const realtimeMint = { ts: isoDate(), box: "example-box", secret: "openai-thinking", purpose: "openai-realtime-client-secret", event: "mint" };
  t.check(await readLog(getBoxTimeISO(box.root)), [deepgramMint, realtimeMint]);

  // Uncapped by design — ten mints in a row are ten log lines, not a refusal:

  const mints = Array.from({ length: 10 }, () => recordSecretMint({ boxRoot: box.root, slug: "example-box", secret: "deepgram", purpose: "deepgram-temp-key" }));
  await Promise.all(mints);
  t.check(await readLog(getBoxTimeISO(box.root)), [deepgramMint, realtimeMint, ...Array.from({ length: 10 }, () => deepgramMint)]);

  // Without an authoritative slug the box's own is derived from disk, so a mint is
  // always attributable to some box:

  await recordSecretMint({ boxRoot: box.root, secret: "deepgram", purpose: "deepgram-temp-key" });
  const derived = (await readLog(getBoxTimeISO(box.root))).at(-1);
  t.check(derived, { ...deepgramMint, box: str`bbx-test-${any(String)}` });

  // ## Segments older than twelve months are deleted
  //
  // `bbx wakeup` housekeeping runs `pruneSecretAccessLog`. It keeps the current
  // month and the twelve before it, and leaves files it did not write alone.
  // `lastUsed` on the store entry is untouched, so "is this still in use" survives
  // the deletion of the segment that recorded the use.

  const logDir = secretsLogDir();
  await mkdir(logDir, { recursive: true });
  for (const name of ["2025-08.jsonl", "2025-09.jsonl", "2025-10.jsonl", "2026-10.jsonl", "notes.txt", "2024-01.jsonl.bak", "2024-13.jsonl"]) {
    await writeFile(join(logDir, name), "");
  }
  await setSecret({ name: "deepgram", value: "placeholder-deepgram-key" });
  await mutateSecretStore({ purpose: "test" }, (store) => {
    const entry = store.secrets.deepgram;
    if (entry !== undefined) entry.lastUsed = { "example-box": "2025-08-15T12:00:00.000Z" };
  });

  t.check(ACCESS_LOG_RETENTION_MONTHS, 12);
  t.check(await pruneSecretAccessLog(new Date("2026-10-17T12:00:00Z")), ["2025-08.jsonl", "2025-09.jsonl"]);
  t.check((await readdir(logDir)).toSorted(), ["2024-01.jsonl.bak", "2024-13.jsonl", "2025-10.jsonl", "2026-10.jsonl", "notes.txt"]);
  const store = await loadSecretStore();
  t.check(store.ok && store.value.secrets.deepgram?.lastUsed, { "example-box": "2025-08-15T12:00:00.000Z" });
  t.check(await pruneSecretAccessLog(new Date("2026-10-17T12:00:00Z")), []);

  // A machine with no log yet has nothing to sweep:

  process.env.BBX_SECRETS_FILE = join(dir, "never-used", "secrets.json");
  t.check(await pruneSecretAccessLog(new Date()), []);
});
