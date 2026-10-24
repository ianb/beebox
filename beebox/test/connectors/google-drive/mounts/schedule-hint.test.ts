// # Saying that hourly Drive sync is off
//
// `check-drive` ships seeded and disabled, so a box can hold a mount that was
// verified the moment it was made and then quietly stops matching Drive. The mount
// result and the settings page both read this state; what it must never do is say
// something reassuring about a box it did not actually check.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import {
  checkDriveScheduleHint,
  checkDriveScheduleState,
} from "../../../../src/connectors/google-drive/mounts/schedule-hint.js";

/** Write a `check-drive` schedule card with the given `enabled:` line, or none. */
async function seedSchedule(boxRoot: string, enabled: boolean | null): Promise<void> {
  const dir = join(boxRoot, "_config/schedules");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "check-drive.scheduled-script.card"),
    [
      "---",
      "type: scheduled-script",
      "description: Sync mounted Google Drive files and folders",
      'cron: "0 * * * *"',
      "runs: bbx wakeup --connector google-drive",
      ...(enabled === null ? [] : [`enabled: ${String(enabled)}`]),
      "---",
      "",
      "Sync Drive mounts hourly.",
      "",
    ].join("\n"),
  );
}

// ## A box with no seed is not a box with the sync off
//
// The three states are distinct: a box that never received the schedule has
// nothing for anyone to enable, and telling its owner to go enable something would
// send them looking for a card that isn't there.
void test("The three states are distinct:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  t.check(await checkDriveScheduleState(box.root), "absent");

  t.check(await checkDriveScheduleHint(box.root), null);

  // The seeded card is disabled, which is the state the hint exists for. It names
  // what is off, who turns it on, and the one command that syncs the mount now
  // regardless.

  await seedSchedule(box.root, false);
  t.check(await checkDriveScheduleState(box.root), "disabled");

  t.check(
    await checkDriveScheduleHint(box.root),
    "Hourly Drive sync (check-drive) is off, so this mount only updates when something asks it to. Ask the boxholder whether to turn it on — they enable it under Schedules in box settings. Either way, `bbx force-wakeup --connector google-drive` syncs it now.",
  );

  // Once it is on there is nothing to say, and the same is true of a card that never
  // spelled `enabled` out — the field is optional and defaults to on
  // (`schemas/scheduled-script.tsx`), so absence must not read as off.

  await seedSchedule(box.root, true);
  t.check([await checkDriveScheduleState(box.root), await checkDriveScheduleHint(box.root)], [
    "enabled",
    null,
  ]);

  await seedSchedule(box.root, null);
  t.check(await checkDriveScheduleState(box.root), "enabled");
});

// ## A card whose frontmatter does not parse is skipped, and the hint says why
void test("A check-drive card with broken YAML reads as invalid, not as switched off", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const dir = join(box.root, "_config/schedules");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "check-drive.scheduled-script.card"), "---\ncron: [unclosed\n---\n");
  t.check({ state: await checkDriveScheduleState(box.root), hint: await checkDriveScheduleHint(box.root) }, {
    state: "invalid",
    hint: "Hourly Drive sync (check-drive) does not run: its schedule card's frontmatter does not parse, so the scheduler skips it. Ask the boxholder to fix it under Schedules in box settings. Either way, `bbx force-wakeup --connector google-drive` syncs it now.",
  });
});

