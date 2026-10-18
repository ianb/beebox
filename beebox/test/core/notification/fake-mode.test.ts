// # Fake mode: `BBX_NOTIFY_FAKE=1`
//
// With `BBX_NOTIFY_FAKE=1` every channel sends through its fake service, and a
// channel with nobody to reach gets a synthetic member, so a dev box exercises
// the whole delivery path with no phone or browser. The log
// records each delivery as `sent` with detail `fake`, and the Admin recent list
// and `bbx health` read it like any other.

import { test } from "tap";
import "agent-doctest/tap";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import type { TmpBox } from "../../helpers/doctest-helpers.js";
import { notifyBoxholder, notifyChannels } from "../../../src/core/notify-boxholder.js";
import type { NotificationInput } from "../../../src/core/notify-boxholder.js";
import type { Loudness } from "../../../src/core/notification/intent.js";
import { invariant } from "../../../src/shared/invariant.js";
import { pairFakePushDevice } from "../../../src/core/mobile/pairing.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";

const PUSH_STORE_DIR = path.join(os.tmpdir(), `bbx-notify-fake-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = PUSH_STORE_DIR;
const ENV = ["BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID", "BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY"];
for (const name of ENV) delete process.env[name];

const NOW = new Date("2026-09-26T12:00:00Z");
const intent = (loudness: Loudness): NotificationInput => ({ title: "Fake-mode check", body: "", target: { kind: "dashboard" }, loudness, source: "fake-doctest" });

async function logged(box: TmpBox) {
  const [n] = (await readRecent(box.root, { days: 1, now: NOW })).toReversed();
  invariant(n, "a notification was logged");
  return n.deliveries.map((d) => `${d.channel} ${d.status}${d.detail ? `: ${d.detail}` : ""}`).join("\n");
}

async function debugLines(box: TmpBox) {
  const text = await fs.readFile(path.join(box.root, ".beebox", "push-debug.log"), "utf-8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

// ## An empty box reaches every channel
//
// The box has no paired phone, no push subscription, and no
// keys. In fake mode none of that matters:
void test("The box has no paired phone, no push subscription, and no keys.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L49
  const box = await makeTmpBox({ git: true });
  process.env.BBX_NOTIFY_FAKE = "1";
  t.check(await notifyChannels(box.root), {
    apns: true,
    webPush: true,
  });

  // doctest:L54
  await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW });
  await t.checkText(await logged(box), `apns sent: fake
web-push sent: fake`);

  // Both push channels leave their debug lines, the APNs one naming the
  // synthetic phone:

  // doctest:L65
  await t.checkText((await debugLines(box)).map((l) => l.channel === "apns" ? `apns ${l.device} ${l.loudness} ${l.target}` : `web-push ${l.title}`).join("\n"), `apns synthetic phone loud dashboard
web-push Fake-mode check`);

  // A registered device is used in place of the synthetic one:

  // doctest:L74
  await pairFakePushDevice(box.root, { label: "dev phone" });
  await notifyBoxholder(box.root, { intent: intent("dot"), now: NOW });
  delete process.env.BBX_NOTIFY_FAKE;
  await t.checkText([await logged(box), (await debugLines(box)).at(-1).device].join("\n"), `apns sent: fake
dev phone`);
});

// ## The loudness and presence rules still apply
//
// Fake mode fakes the audience and the services, not the decision: a `quiet`
// notification while someone is in the app is still held back.
void test("Fake mode fakes the audience and the services, not the decision:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L93
  const box = await makeTmpBox({ git: true });
  process.env.BBX_NOTIFY_FAKE = "1";
  await writePresence(box.root, { activeWeb: 1, now: NOW });
  await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW });
  delete process.env.BBX_NOTIFY_FAKE;
  await t.checkText(await logged(box), `apns skipped: present
web-push skipped: present`);
});

// ## `BBX_PUSH_FAKE` still works for one release
//
// The old web-push-only switch is read as an alias, with a warning to rename it.
void test("The old web-push-only switch is read as an alias, with a warning to rename it.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await fs.rm(PUSH_STORE_DIR, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L113
  const box = await makeTmpBox({ git: true });
  process.env.BBX_PUSH_FAKE = "1";
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW });
  console.warn = origWarn;
  delete process.env.BBX_PUSH_FAKE;
  await t.checkText([await logged(box), warnings.filter((w) => w.includes("BBX_PUSH_FAKE")).length].join("\n"), `apns sent: fake
web-push sent: fake
1`);
});
