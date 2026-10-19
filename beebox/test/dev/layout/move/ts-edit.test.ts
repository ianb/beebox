// # `rewriteTsFile`: AST-located specifier rewrites

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { rewriteTsFile } from "../../../../src/dev/layout/move/ts-edit.js";

// ## Import, export-from, dynamic import, and require specifiers are all rewritten
void test("Import, export-from, dynamic import, and require specifiers are all rewritten", async (t) => {
  // doctest:L10
  const source = `import { a } from "./old.js";
export { b } from "./old.js";
const c = await import("./old.js");
const d = require("./old.js");
`;
  await t.checkText(rewriteTsFile({ path: "pkg/src/a.ts", text: source, rewrites: new Map([["./old.js", "./new.js"]]) }), `import { a } from "./new.js";
export { b } from "./new.js";
const c = await import("./new.js");
const d = require("./new.js");`);
});

// ## Only real specifier literals are touched, not an unrelated string that happens to match
void test("Only real specifier literals are touched, not an unrelated string that happens to match", async (t) => {
  // doctest:L26
  const source2 = `import { a } from "./old.js";
const label = "./old.js";
`;
  await t.checkText(rewriteTsFile({ path: "pkg/src/a.ts", text: source2, rewrites: new Map([["./old.js", "./new.js"]]) }), `import { a } from "./new.js";
const label = "./old.js";`);
});

// ## The original quote character is preserved
void test("The original quote character is preserved", async (t) => {
  // doctest:L38
  const source3 = "import { a } from './old.js';\n";
  await t.checkText(rewriteTsFile({ path: "pkg/src/a.ts", text: source3, rewrites: new Map([["./old.js", "./new.js"]]) }), "import { a } from './new.js';");
});

// ## Nothing to rewrite returns the text unchanged
void test("Nothing to rewrite returns the text unchanged", async (t) => {
  // doctest:L46
  const source4 = "import { a } from \"./keep.js\";\n";
  t.check(rewriteTsFile({ path: "pkg/src/a.ts", text: source4, rewrites: new Map([["./old.js", "./new.js"]]) }), source4);
});
