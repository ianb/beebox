// Which paths the plaintext renderer shows, and so which FileView puts on the
// card surface: text files, but not attachment directories, cards, JSON, or binaries.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isPlaintextPath } from "../../src/components/file-view-data.js";

void test("text files are plaintext; directories, cards, JSON, and binaries are not", async (t) => {
  const paths = ["src/app.ts", "notes.txt", "run.SH", "Name.attach", "Name.attach/sketch.ts", "docs", "Errands.doc.card", "data.json", "photo.png"];
  t.check(paths.map((path) => [path, isPlaintextPath(path)]), [
    ["src/app.ts", true],
    ["notes.txt", true],
    ["run.SH", true],
    // An attachment directory: the Directory renderer shows it, not a text card.
    ["Name.attach", false],
    ["Name.attach/sketch.ts", true],
    ["docs", false],
    ["Errands.doc.card", false],
    ["data.json", false],
    ["photo.png", false],
  ]);
});
