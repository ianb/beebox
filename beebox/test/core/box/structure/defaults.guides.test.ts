// # `installGuides` — stock guides from before experiments lost `status`, and before `basis`
//
// Stock guides used to mark their seed experiment `status: active`; they now
// write `active: true`, last in the entry, where the `status-fields-2026-09`
// migration puts it. Their triage rules then said `source: default`; they now
// say `basis: default`, where the `source-fields-2026-09` migration puts it. An
// Their actions then said to create memo cards; they now say doc cards (the
// memo type was retired in 2026-10). An untracked box (no
// `_config/template-versions.json` entry) still holding any old stock copy takes
// the update in place instead of parking it. A tracked box
// whose copy differs from its recorded version keeps its copy: that is an edit.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { installGuides } from "../../../../src/core/box/structure/core.js";
import { createInitialGuideTemplate } from "../../../../src/schemas/guide/templates.js";
import { parse as parseYaml, stringify as stringifyYaml } from "../../../../src/lib/yaml-package.js";
import { isRecord } from "../../../../src/shared/is-record.js";

/** The calendar guide's two action instructions before events moved into calendar card folders (2026-10-29). */
const PRE_FOLDER_INSTRUCTIONS: Readonly<Record<string, string>> = {
  "Create Event": "Write a new .ics file in _content/calendar/ with proper ICS format including VTIMEZONE and TZID. Use X-BBX-CALENDAR-ID to target a specific calendar. The event will be pushed to Google Calendar on next sync.",
  "Edit Event": "Find the .ics file in _content/calendar/ and edit the relevant properties. Changes are pushed to Google Calendar on next sync.",
};

/**
 * The stock form before calendar events moved into calendar card folders,
 * re-rendered through the template's own YAML serializer so line folding
 * matches what shipped.
 */
function preFolderStock(name: string): string {
  const current = createInitialGuideTemplate({ name });
  if (name !== "calendar") return current;
  const fields: unknown = parseYaml(current.slice("---\n".length, current.lastIndexOf("---\n")));
  if (!isRecord(fields) || !Array.isArray(fields["actions"])) throw new Error("calendar guide has no actions");
  for (const action of fields["actions"]) {
    if (isRecord(action) && typeof action["name"] === "string" && PRE_FOLDER_INSTRUCTIONS[action["name"]] !== undefined) {
      action["instructions"] = PRE_FOLDER_INSTRUCTIONS[action["name"]];
    }
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}

/** The stock form before memo cards were retired: actions said "memo card". */
function preDocStock(name: string): string {
  return preFolderStock(name)
    .replace("(notes, bookmarks, captures)", "(memos, bookmarks, captures)")
    .replaceAll("Create a doc card", "Create a memo card");
}

/** The stock form before triage rules' `source` became `basis`. */
function preBasisStock(name: string): string {
  return preDocStock(name).replaceAll("\n    basis: ", "\n    source: ");
}

/** The pre-2026-09 stock form: `status: active` right after the experiment id. */
function oldStock(name: string): string {
  const current = preBasisStock(name);
  const withoutActive = current.replace("\n    active: true\n", "\n");
  const match = /\n {2}- id: [^\n]+\n/.exec(withoutActive);
  if (match === null) throw new Error("no experiment id line");
  const at = match.index + match[0].length;
  return `${withoutActive.slice(0, at)}    status: active\n${withoutActive.slice(at)}`;
}

async function boxWith(files: Record<string, string>) {
  const box = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-install-guides-"));
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(box, rel)), { recursive: true });
    await fs.writeFile(path.join(box, rel), content);
  }
  return box;
}

// ## An untracked box's old stock guides update in place
void test("An untracked box's old stock guides update in place", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(box, { recursive: true, force: true });
      await fs.rm(tracked, { recursive: true, force: true });
      await fs.rm(preBasis, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const box = await boxWith({
    "_config/intake.guide.card": oldStock("intake"),
    "_config/calendar.guide.card": oldStock("calendar"),
  });
  t.check(await installGuides(box), [
    "intake.guide.card (updated)",
    "calendar.guide.card (updated)",
  ]);

  t.check(await fs.readFile(path.join(box, "_config/intake.guide.card"), "utf-8"), createInitialGuideTemplate({ name: "intake" }));

  // ## An untracked box's pre-folder stock calendar guide updates in place

  const preFolder = await boxWith({ "_config/calendar.guide.card": preFolderStock("calendar") });
  t.teardown(() => fs.rm(preFolder, { recursive: true, force: true }));
  t.check((await installGuides(preFolder)).filter((entry) => entry.includes("calendar.guide.card")), [
    "calendar.guide.card (updated)",
  ]);

  // ## An untracked box's pre-`basis` stock guide updates in place

  const preBasis = await boxWith({ "_config/intake.guide.card": preBasisStock("intake") });
  t.check((await installGuides(preBasis)).filter((entry) => entry.includes("intake.guide.card")), [
    "intake.guide.card (updated)",
  ]);

  t.check(await fs.readFile(path.join(preBasis, "_config/intake.guide.card"), "utf-8"), createInitialGuideTemplate({ name: "intake" }));

  // ## An untracked box's pre-doc stock guides update in place

  const preDoc = await boxWith({ "_config/intake.guide.card": preDocStock("intake"), "_config/calendar.guide.card": preDocStock("calendar") });
  t.check(await installGuides(preDoc), [
    "intake.guide.card (updated)",
    "calendar.guide.card (updated)",
  ]);

  // ## A tracked box that diverged from its recorded version parks the update

  const tracked = await boxWith({
    "_config/intake.guide.card": oldStock("intake"),
    "_config/template-versions.json": JSON.stringify({ "_config/intake.guide.card": { sha256: "0".repeat(64), "installed-at": "2026-09-01T00:00:00Z" } }),
  });
  t.check((await installGuides(tracked)).filter((entry) => entry.includes("intake.guide.card")), [
    "_config/_template-updates/_config/intake.guide.card (update available)",
  ]);

  t.check(await fs.readFile(path.join(tracked, "_config/intake.guide.card"), "utf-8"), oldStock("intake"));
});
