// # Drive stamps refuse a card they cannot read back
//
// A Drive sync rewrites a card's frontmatter with fresh `drive:` and
// `last-sync` fields. If the existing block does not parse as a YAML mapping,
// writing the stamp would replace every other field the person wrote, so the
// stamp refuses and the file stays as it was. See
// `src/connectors/google-drive/card-stamp.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { instanceOf } from "@ianbicking/tap-check/check";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stampGfolderCard, UnreadableDriveCardError } from "../../../src/connectors/google-drive/card-stamp.js";

void test("A folder card with broken YAML is left untouched and the stamp fails with a named error", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drive-stamp-"));
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  const card = path.join(dir, "Shared.gfolder.card");
  const text = "---\ntitle: [unclosed\nnotes: kept\n---\nbody\n";
  fs.writeFileSync(card, text);
  const stamp = { name: "Shared", link: null, lastSync: "2026-10-23T12:00:00Z", error: null, problems: null };
  const outcome = await stampGfolderCard(card, stamp).then(() => null, (e: unknown) => e);
  t.check(outcome, instanceOf(UnreadableDriveCardError));
  t.check(fs.readFileSync(card, "utf8"), text);
});
