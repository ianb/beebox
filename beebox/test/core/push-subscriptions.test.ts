// # push-subscriptions: corrupt-store handling (Track D.3)
//
// `loadStore` used to share one catch between "no store yet" (ENOENT) and
// "store failed to parse" — both fell through to an empty store, and the next
// write then silently overwrote the corruption with a fresh, empty file,
// destroying every subscription. Missing and corrupt are now distinguished:
// missing is a normal empty store; corrupt throws `PushStoreCorruptError` and
// aborts the read-modify-write instead of writing over it. See
// `src/core/push-subscriptions.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { instanceOf } from "@ianbicking/tap-check/check";
import assert from "node:assert";
import { addSubscription, endpointsForBox, PushStoreCorruptError } from "../../src/core/push-subscriptions.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const storeDir = path.join(os.tmpdir(), `bbx-push-store-corrupt-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
const storeFile = path.join(storeDir, "push-subscriptions.json");

const SUB = { endpoint: "https://push.example/store-test", keys: { p256dh: "p", auth: "a" } };
const NOW = new Date("2026-07-01T00:00:00Z");

async function tryCall(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    return e;
  }
}

// ## No store file yet: reads succeed as empty, no throw
void test("No store file yet: reads succeed as empty, no throw", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  t.check(await endpointsForBox("some-box"), []);

  // ## A valid store round-trips through addSubscription / endpointsForBox

  await addSubscription({ boxSlug: "boxa", subscription: SUB, now: NOW });
  t.check(await endpointsForBox("boxa"), [SUB]);

  // ## A corrupt (invalid JSON) store throws PushStoreCorruptError on read

  await fs.writeFile(storeFile, "{ not valid json");
  const readResult = await tryCall(() => endpointsForBox("boxa"));
  t.check(readResult, instanceOf(PushStoreCorruptError));

  assert(readResult instanceof PushStoreCorruptError);
  t.check(readResult.storePath, storeFile);

  // ## A corrupt store also aborts a write attempt — the file is left untouched

  const beforeContent = await fs.readFile(storeFile, "utf-8");
  const writeResult = await tryCall(() => addSubscription({ boxSlug: "boxb", subscription: SUB, now: NOW }));
  t.check(writeResult, instanceOf(PushStoreCorruptError));

  const afterContent = await fs.readFile(storeFile, "utf-8");
  t.check(afterContent, beforeContent);

  // ## A store that parses as JSON but fails the shape schema also throws

  await fs.writeFile(storeFile, JSON.stringify({ "https://push.example/x": { keys: { p256dh: "p" } } }));
  t.check(await tryCall(() => endpointsForBox("boxa")), instanceOf(PushStoreCorruptError));
});
