// # readCardTitle
//
// A card file's own `title:` for a label, trimmed, or null so the caller can
// fall back to the filename. Unreadable files and broken frontmatter are "no
// title", not an error: the nav and views lookups report existence separately.
// See `src/core/frontmatter-field.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readCardTitle } from "../../src/core/frontmatter-field.js";

void test("A declared title is trimmed; a blank, missing, or unreadable one is null", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-title-"));
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, text: string) => {
    fs.writeFileSync(path.join(dir, name), text);
    return path.join(dir, name);
  };
  const titles = await Promise.all([
    write("a.doc.card", "---\ntitle: '  Garden plan '\n---\nbody\n"),
    write("b.doc.card", "---\ntitle: '   '\n---\n"),
    write("c.doc.card", "---\nstatus: open\n---\n"),
    write("d.doc.card", "no frontmatter\n"),
    write("e.doc.card", "---\ntitle: [unclosed\n---\n"),
    path.join(dir, "missing.doc.card"),
  ].map(readCardTitle));
  t.check(titles, ["Garden plan", null, null, null, null, null]);
});
