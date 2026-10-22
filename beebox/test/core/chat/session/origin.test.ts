// # `localOrigin` — which machine holds a chat's transcript
//
// A transcript lives in one engine store on one machine. `localOrigin()` names
// that machine so a husk can record it (`docs/implemented-plans/chat-session-identity.md`,
// Track 2): a stable UUID minted once at `~/.local/share/beebox/origin-id`, plus the
// current hostname as a display label. The hostname is never the id — a laptop
// renames itself when its network location changes.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { any } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { localOrigin, readOrCreateOriginId } from "../../../../src/core/chat/session/origin.js";

// ## the first read mints the id; later reads return the same one
//
// `BBX_ORIGIN_ID_FILE` points the helper somewhere other than the real per-user
// state dir — nothing else about the behaviour changes.
void test("BBXORIGINIDFILE points the helper somewhere other than the real per-user stat...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_ORIGIN_ID_FILE"];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  process.env["BBX_ORIGIN_ID_FILE"] = box.path("origin-id");

  const first = await localOrigin();
  t.check(first, { id: any(String).matches(/^[\da-f-]{36}$/), name: os.hostname() });

  const onDisk = (await readFile(box.path("origin-id"), "utf-8")).trim();
  t.check(onDisk, first.id);

  const second = await localOrigin();
  t.check(second, first);
});

// ## two first runs at once converge on one id
//
// Nothing serializes the very first read: a boot and a chat send can both find no
// file and both mint. Creation is exclusive, so one of them wins and the other
// reads the winner's id — the alternative (each writing its own) would leave the
// two halves of one machine stamping husks with different origins.
//
// `readOrCreateOriginId` rather than `localOrigin` because the memo would hand
// the second caller the first one's promise, and the race would never happen.
void test("Nothing serializes the very first read:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const idFile = box.path("state/origin-id");
  const [a, b] = await Promise.all([readOrCreateOriginId(idFile), readOrCreateOriginId(idFile)]);

  t.check(a, b);

  t.check(a, (await readFile(idFile, "utf-8")).trim());
});

// ## an existing id is read, never replaced
void test("an existing id is read, never replaced", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_ORIGIN_ID_FILE"];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await writeFile(box.path("origin-id"), "b0d1e2f3-4567-4890-abcd-ef0123456789\n");
  process.env["BBX_ORIGIN_ID_FILE"] = box.path("origin-id");

  t.check((await localOrigin()).id, "b0d1e2f3-4567-4890-abcd-ef0123456789");
});

// ## a corrupt file is an error, not a fresh identity
//
// A missing file is the ordinary first-run case. A file that holds something
// other than a UUID was edited or truncated by something else, and quietly
// replacing it would re-origin every session this machine holds — every one of
// them would start reading as if it had run elsewhere.
void test("A missing file is the ordinary first-run case.", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_ORIGIN_ID_FILE"];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await writeFile(box.path("origin-id"), "not-a-uuid\n");
  process.env["BBX_ORIGIN_ID_FILE"] = box.path("origin-id");

  await t.checkThrows(async () => (await localOrigin()), "CorruptOriginIdError");
});
