// # The seeded briefing has a person-facing title
//
// The root page lists the briefing card by its `title:`, and a card without one
// shows its filename ("briefing"). The seed carries "About this box". A box
// whose briefing is still the previous stock seed takes the title through
// template sync; a briefing a person or agent wrote into keeps its text.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { containing } from "@ianbicking/tap-check/check";
import { createHash } from "node:crypto";
import { createBriefingTemplate } from "../../../../src/schemas/briefing.js";
import { TEMPLATE_STOCK_HASHES } from "../../../../src/core/template-stock-hashes.js";
import { installBriefing } from "../../../../src/core/box/structure/defaults.js";
import { writeVersions } from "../../../../src/core/install-template-file.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const ROOT = "_content/briefing.briefing.card";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
/** The seed before the title was added. */
const SEED_WITHOUT_TITLE = createBriefingTemplate().replace("title: About this box\n", "");

void test("A new box's briefing is titled 'About this box'", async (t) => {
  const box = await makeTmpBox();
  t.check(await installBriefing(box.root), true);
  t.check((await box.read(ROOT)).split("\n").slice(0, 4), ["---", "type: briefing", "title: About this box", "purpose: What this box is for."]);
});

void test("The previous stock seed is superseded and takes the title", async (t) => {
  const box = await makeTmpBox();
  t.check(TEMPLATE_STOCK_HASHES["briefing-seed"].superseded, containing([sha(SEED_WITHOUT_TITLE)]));
  await box.write(ROOT, SEED_WITHOUT_TITLE);
  await writeVersions(box.root, { [ROOT]: { sha256: sha(SEED_WITHOUT_TITLE), "installed-at": "2026-10-01T00:00:00.000Z", stock: SEED_WITHOUT_TITLE } });
  await installBriefing(box.root);
  t.check(await box.read(ROOT), createBriefingTemplate());
});

void test("A briefing someone wrote into keeps its text", async (t) => {
  const box = await makeTmpBox();
  const edited = SEED_WITHOUT_TITLE.replace("What this box is for.", "Keeping track of the washing machine.");
  await box.write(ROOT, edited);
  await writeVersions(box.root, { [ROOT]: { sha256: sha(SEED_WITHOUT_TITLE), "installed-at": "2026-10-01T00:00:00.000Z", stock: SEED_WITHOUT_TITLE } });
  await installBriefing(box.root);
  t.check(await box.read(ROOT), edited);
});
