// A file's language from its extension: the label on the card's back and the
// grammar that colours it. Unknown extensions are uncoloured text.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { languageForPath } from "../../src/lib/code-language.js";

void test("extensions map to a label and grammar, case-insensitively", async (t) => {
  const paths = ["a/b.tsx", "x.PY", "notes.txt", "Makefile", "run.log"];
  t.check(paths.map((path) => [path, languageForPath(path)]), [
    ["a/b.tsx", { label: "TypeScript", grammar: "typescript" }],
    ["x.PY", { label: "Python", grammar: "python" }],
    ["notes.txt", { label: "Text", grammar: null }],
    ["Makefile", { label: "Text", grammar: null }],
    ["run.log", { label: "Log", grammar: null }],
  ]);
});
