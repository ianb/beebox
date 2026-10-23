// # Fake mode: `BBX_NOTIFY_FAKE=1`, or one box's `fakeNotifications`
//
// With `BBX_NOTIFY_FAKE=1` every channel sends through its fake service, and a
// channel with nobody to reach gets a synthetic member, so a dev box exercises
// the whole delivery path with no phone or browser. The log
// records each delivery as `sent` with detail `fake`, and the Admin recent list
// and `bbx health` read it like any other.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";
import { notifyBoxholder, notifyChannels } from "../../../src/core/notify-boxholder.js";
import type { NotificationInput } from "../../../src/core/notify-boxholder.js";
import type { Loudness } from "../../../src/core/notification/intent.js";
import { invariant } from "../../../src/shared/invariant.js";
import { pairFakePushDevice } from "../../../src/core/mobile/pairing.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";
import { notificationHealthChecks } from "../../../src/core/notification/health.js";

const PUSH_STORE_DIR = path.join(os.tmpdir(), `bbx-notify-fake-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = PUSH_STORE_DIR;
const ENV = ["BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID", "BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY"];
for (const name of ENV) delete process.env[name];

const NOW = new Date("2026-09-26T12:00:00Z");
const intent = (loudness: Loudness): NotificationInput => ({ title: "Fake-mode check", body: "", target: { kind: "dashboard" }, loudness, source: "fake-test" });

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
  const box = await makeTmpBox({ git: true });
  process.env.BBX_NOTIFY_FAKE = "1";
  t.check(await notifyChannels(box.root), {
    apns: true,
    webPush: true,
  });

  await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW });
  await t.checkText(await logged(box), `apns sent: fake
web-push sent: fake`);

  // Both push channels leave their debug lines, the APNs one naming the
  // synthetic phone:

  await t.checkText((await debugLines(box)).map((l) => l.channel === "apns" ? `apns ${l.device} ${l.loudness} ${l.target}` : `web-push ${l.title}`).join("\n"), `apns synthetic phone loud dashboard
web-push Fake-mode check`);

  // A registered device is used in place of the synthetic one:

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
  const box = await makeTmpBox({ git: true });
  process.env.BBX_NOTIFY_FAKE = "1";
  await writePresence(box.root, { activeWeb: 1, now: NOW });
  await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW });
  delete process.env.BBX_NOTIFY_FAKE;
  await t.checkText(await logged(box), `apns skipped: present
web-push skipped: present`);
});

// ## One box can be fake without the variable
//
// `fakeNotifications: true` in `_config/box.json` fakes that box only: a journey
// walk box built in a worktree whose other boxes send for real. A value other
// than `true` still reads as fake, with a warning, so a box that tried to say
// "fake" never sends for real. Box health names the setting while it is on.
void test("One box can be fake without the variable", async (t) => {
  const fake = await makeTmpBox({ git: true });
  const real = await makeTmpBox({ git: true });
  const typo = await makeTmpBox({ git: true });
  t.teardown(async () => {
    try {
      await fake.cleanup();
      await real.cleanup();
      await typo.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const writeConfig = (box: TmpBox, config: object) =>
    fs.writeFile(path.join(box.root, "_config", "box.json"), JSON.stringify(config));
  await fs.mkdir(path.join(fake.root, "_config"), { recursive: true });
  await fs.mkdir(path.join(typo.root, "_config"), { recursive: true });
  await writeConfig(fake, { fakeNotifications: true });
  await writeConfig(typo, { fakeNotifications: "yes" });
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  const reach = [await notifyChannels(fake.root), await notifyChannels(real.root), await notifyChannels(typo.root)];
  console.warn = origWarn;
  t.check(reach, [
    { apns: true, webPush: true },
    { apns: false, webPush: false },
    { apns: true, webPush: true },
  ]);
  t.check(warnings.filter((w) => w.includes("fakeNotifications")).map((w) => w.replace(typo.root, "<box>")), [
    '[notify] fakeNotifications in <box>/_config/box.json is "yes", not true; treating notifications as fake.',
  ]);

  await notifyBoxholder(fake.root, { intent: intent("loud"), now: NOW });
  await t.checkText(await logged(fake), `apns sent: fake
web-push sent: fake`);

  const fakeCheck = async (box: TmpBox) =>
    (await notificationHealthChecks(box.root, { now: NOW })).find((c) => c.name === "notifications-fake");
  t.check([await fakeCheck(fake), await fakeCheck(real)], [
    {
      name: "notifications-fake",
      ok: false,
      message: "Notifications on this box are fake (BBX_NOTIFY_FAKE, or fakeNotifications in _config/box.json); nothing reaches a phone",
      severity: "warning",
    },
    { name: "notifications-fake", ok: true, message: "Notifications on this box send for real", severity: "warning" },
  ]);
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
