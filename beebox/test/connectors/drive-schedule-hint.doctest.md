# Saying that hourly Drive sync is off

`check-drive` ships seeded and disabled, so a box can hold a mount that was
verified the moment it was made and then quietly stops matching Drive. The mount
result and the settings page both read this state; what it must never do is say
something reassuring about a box it did not actually check.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import {
  checkDriveScheduleHint,
  checkDriveScheduleState,
} from "../../src/connectors/drive-schedule-hint.js";

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
      'runs: bbx wakeup --connector google-drive',
      ...(enabled === null ? [] : [`enabled: ${String(enabled)}`]),
      "---",
      "",
      "Sync Drive mounts hourly.",
      "",
    ].join("\n"),
  );
}
```

## A box with no seed is not a box with the sync off

The three states are distinct: a box that never received the schedule has
nothing for anyone to enable, and telling its owner to go enable something would
send them looking for a card that isn't there.

```ts
const box = await makeTmpBox();
await checkDriveScheduleState(box.root)
=> absent

await checkDriveScheduleHint(box.root)
=> null
```

The seeded card is disabled, which is the state the hint exists for. It names
what is off, who turns it on, and the one command that syncs the mount now
regardless.

```ts continue
await seedSchedule(box.root, false);
await checkDriveScheduleState(box.root)
=> disabled

(await checkDriveScheduleHint(box.root))?.includes("bbx force-wakeup --connector google-drive")
=> true
```

Once it is on there is nothing to say, and the same is true of a card that never
spelled `enabled` out — the field is optional and defaults to on
(`schemas/scheduled-script.tsx`), so absence must not read as off.

```ts continue
await seedSchedule(box.root, true);
JSON.stringify([await checkDriveScheduleState(box.root), await checkDriveScheduleHint(box.root)])
=> ["enabled",null]

await seedSchedule(box.root, null);
await checkDriveScheduleState(box.root)
=> enabled
```

```ts cleanup
await box.cleanup();
```
