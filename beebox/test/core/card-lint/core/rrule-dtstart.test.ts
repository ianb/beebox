// # An rrule without DTSTART warns
//
// A scheduled script's `rrule` with no DTSTART runs at midnight UTC on matching
// days (`parseScheduleRrule`), rarely the time a person meant, so the card
// linter warns and shows the fix. Schedules run in UTC; when the box has a
// timezone, the warning says to convert the start from it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { rruleDtstartWarnings } from "../../../../src/core/card-lint/core/rrule-dtstart.js";

void test("a rule without DTSTART warns; one with DTSTART, or no rrule, does not", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const messages = async (fields: Record<string, unknown>) =>
    (await rruleDtstartWarnings({ fields, boxRoot: box.root })).map((w) => w.message);
  t.check(
    {
      missing: await messages({ rrule: "FREQ=WEEKLY;BYDAY=MO" }),
      inline: await messages({ rrule: "FREQ=WEEKLY;BYDAY=MO;DTSTART=20261102T140000Z" }),
      ownLine: await messages({ rrule: "DTSTART:20261102T140000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO" }),
      cron: await messages({ cron: "0 6 * * *" }),
      multiLine: await messages({ rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO\nEXDATE:20261102T000000Z" }),
    },
    {
      missing: ["rrule has no DTSTART, so it runs at midnight UTC on matching days. Add the start in UTC: `FREQ=WEEKLY;BYDAY=MO;DTSTART=<yyyymmdd>T<hhmmss>Z`"],
      inline: [],
      ownLine: [],
      cron: [],
      multiLine: ["rrule has no DTSTART, so it runs at midnight UTC on matching days. Add the start in UTC: a first line `DTSTART:<yyyymmdd>T<hhmmss>Z`"],
    },
  );
});

void test("a box with a timezone is named in the warning", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
  t.check((await rruleDtstartWarnings({ fields: { rrule: "FREQ=DAILY" }, boxRoot: box.root })).map((w) => w.message), [
    "rrule has no DTSTART, so it runs at midnight UTC on matching days. Add the start in UTC, converted from this box's timezone (America/Chicago): `FREQ=DAILY;DTSTART=<yyyymmdd>T<hhmmss>Z`",
  ]);
});
