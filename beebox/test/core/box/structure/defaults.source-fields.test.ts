// # Stock schedules and personality from before `reason` and `basis`
//
// Stock schedules used to say why they exist in `source:`; they now say it in
// `reason:`. The stock personality's tone and traits said `source: default`; they
// now say `basis: default`. A box's older stock copy updates or parks in place.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { parse } from "yaml";
import { installPersonality, installSchedules } from "../../../../src/core/box/structure/core.js";
import { createInitialPersonalityTemplate } from "../../../../src/schemas/personality/schema.js";
import { splitCardContent } from "../../../../src/cards/frontmatter.js";

const SCHEDULE = "_config/schedules/refresh-maps.scheduled-script.card";
const PERSONALITY = "_config/main.personality.card";

async function freshBox(): Promise<string> {
  const box = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-source-fields-stock-"));
  await installSchedules(box);
  return box;
}

const read = (box: string, rel: string) => fs.readFile(path.join(box, rel), "utf-8");
const exists = (p: string) => fs.access(p).then(() => true, () => false);

// ## An untracked box's pre-`reason` stock schedule updates in place
//
// The box has turned the schedule off, a box-owned field, which the update keeps:
void test("The box has turned the schedule off, a box-owned field, which the update keeps:", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(box, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L34
  const box = await freshBox();
  const current = await read(box, SCHEDULE);
  await fs.rm(path.join(box, "_config/template-versions.json"));
  await fs.writeFile(path.join(box, SCHEDULE), `${current.replace("\nreason: ", "\nsource: ").replace("---\n", "---\nenabled: false\n")}`);
  t.check((await installSchedules(box)).filter((entry) => entry.startsWith("refresh-maps")), [
    "refresh-maps.scheduled-script.card (updated)",
  ]);

  // doctest:L41
  t.check(parse(splitCardContent(await read(box, SCHEDULE)).frontmatterText), {
    cron: "0 5 * * *",
    "not-before": "20h",
    description: "Refresh MAP.md files when files or directories were added/deleted",
    runs: "bbx procedure run refresh-maps",
    reason: "Daily check; precheck no-ops when nothing changed",
    enabled: false,
  });
});

// ## The stock personality: an older copy parks the update
//
// The personality has no prior-stock list, so an untracked box with an older
// stock copy parks the update:
void test("The personality has no prior-stock list, so an untracked box with an older st...", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(box, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L55
  const box = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-source-fields-personality-"));
  const template = createInitialPersonalityTemplate();
  const old = template.replaceAll("\n    basis: ", "\n    source: ");
  await fs.mkdir(path.join(box, "_config"), { recursive: true });
  await fs.writeFile(path.join(box, PERSONALITY), old);
  await installPersonality(box);
  const parked = path.join(box, "_config/_template-updates/_config/main.personality.card");
  t.check(await exists(parked), true);
});
