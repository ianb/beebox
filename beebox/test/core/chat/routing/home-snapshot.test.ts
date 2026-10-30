// # A sleeping box's home snapshot: written for the hub, readable only by it
//
// At a clean shutdown a box under a hub leaves its `quickChat.home` answer,
// encrypted under a key derived from its hub secret and slug; the hub answers
// the phone from it while the box sleeps (docs/implemented-plans/ios-box-screen-stale-list.md).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readHomeSnapshot, removeHomeSnapshot, writeHomeSnapshot, writeHomeSnapshotsAtShutdown, type HomeSnapshot,
} from "../../../../src/core/chat/routing/home-snapshot.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../../src/core/mobile/pairing.js";
import { hashToken } from "../../../../src/core/token-store.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const SECRET = "hub-secret-for-home-snapshot-test";
const snapshot: HomeSnapshot = {
  savedAt: "2026-10-26T15:12:00.000Z",
  home: {
    open: [], recentlySent: [], shortcuts: [],
    recentChats: [{ sessionId: "s-bike", label: "Fix the bike brakes", lastActivity: "2026-10-26T15:10:00.000Z", landmark: null }],
  },
  deviceTokenHashes: ["0f1e"],
  allowedEmails: [],
};

async function pairDevice(boxRoot: string, createdBy: string | null): Promise<string> {
  const ticket = createMobilePairingTicket(boxRoot, { createdBy });
  const redeemed = await redeemMobilePairingTicket(boxRoot, { pairingToken: ticket.token, deviceLabel: "test" });
  if (!redeemed) throw new Error("test pairing failed");
  return redeemed.deviceToken;
}

void test("the hub reads back what the box wrote, and the file holds no chat title", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  writeHomeSnapshot(box.root, { slug: "test1", hubSecret: SECRET, snapshot });

  t.check(readHomeSnapshot(box.root, { slug: "test1", hubSecret: SECRET }), snapshot);
  const file = join(box.root, ".beebox/quick-chat-home.snapshot.json");
  // Another user on the host may read the file (0644, as hub-meta.json is); it is ciphertext.
  t.check({ mentionsTitle: (await readFile(file, "utf8")).includes("bike"), mode: (await stat(file)).mode & 0o777 }, { mentionsTitle: false, mode: 0o644 });
});

void test("a different secret or slug opens nothing, with a warning", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  writeHomeSnapshot(box.root, { slug: "test1", hubSecret: SECRET, snapshot });
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => { warnings.push(message.replace(box.root, "<box>").split(": ")[0] ?? ""); };
  t.teardown(() => { console.warn = warn; });

  // A rebooted host or a restarted spawning hub has a new secret; a sibling box has another slug.
  t.check([
    readHomeSnapshot(box.root, { slug: "test1", hubSecret: "rotated-secret" }),
    readHomeSnapshot(box.root, { slug: "test2", hubSecret: SECRET }),
  ], [undefined, undefined]);
  t.check(warnings, [
    "[home-snapshot] <box>/.beebox/quick-chat-home.snapshot.json is malformed or not for this hub secret; ignoring it",
    "[home-snapshot] <box>/.beebox/quick-chat-home.snapshot.json is malformed or not for this hub secret; ignoring it",
  ]);
});

void test("a malformed file opens nothing; an absent one is silent", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  t.check(readHomeSnapshot(box.root, { slug: "test1", hubSecret: SECRET }), undefined);
  await writeFile(join(box.root, ".beebox/quick-chat-home.snapshot.json"), "{\"v\":1}");
  const warn = console.warn;
  console.warn = () => {};
  t.teardown(() => { console.warn = warn; });
  t.check(readHomeSnapshot(box.root, { slug: "test1", hubSecret: SECRET }), undefined);
});

void test("startup removes the snapshot, and removing an absent one is fine", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  writeHomeSnapshot(box.root, { slug: "test1", hubSecret: SECRET, snapshot });
  removeHomeSnapshot(box.root);
  removeHomeSnapshot(box.root);
  t.check(readHomeSnapshot(box.root, { slug: "test1", hubSecret: SECRET }), undefined);
});

// The box checks a pairer's membership on every request (`core/mobile/request-auth.ts`);
// the snapshot lists only devices that would pass, so the hub can serve no one else.
void test("shutdown writes the box's own home under a hub, for the devices whose pairer can open it", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const unowned = await pairDevice(box.root, null);
  await pairDevice(box.root, "removed@example.com");
  await writeHomeSnapshotsAtShutdown([{ slug: "test1", boxRoot: box.root }], undefined);
  t.check(readHomeSnapshot(box.root, { slug: "test1", hubSecret: SECRET }), undefined);

  process.env.BBX_TIME = "2026-10-26T15:12:00.000Z";
  t.teardown(() => { delete process.env.BBX_TIME; });
  await writeHomeSnapshotsAtShutdown([{ slug: "test1", boxRoot: box.root }], SECRET);
  t.check(readHomeSnapshot(box.root, { slug: "test1", hubSecret: SECRET }), {
    savedAt: "2026-10-26T15:12:00.000Z",
    home: { open: [], recentlySent: [], recentChats: [], shortcuts: [] },
    deviceTokenHashes: [hashToken(unowned)],
    allowedEmails: [],
  });
});
