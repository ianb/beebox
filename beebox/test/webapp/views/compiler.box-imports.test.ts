// # Views compiler: box-root imports and the compile cache
//
// Views and figures share code through `src/lib/`. A relative import out of a
// card's attach folder breaks when the card moves (`bbx mv` does not rewrite
// code), so `@/…` names a file from the box root instead. The compile cache
// must also notice an edit to an imported file, not only to the entry.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bundleView, getViewMeta } from "../../../src/webapp/views/compiler/compile.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

async function put(root: string, [rel, text]: [string, string]): Promise<string> {
  const file = join(root, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

void test("`@/` resolves from the box root at any depth, and the cache sees imported edits", async (t) => {
  const box = await makeTmpBox({});
  await put(box.root, ["src/lib/chem.ts", "export const ATOM = \"hydrogen-one\";\n"]);
  await put(box.root, ["src/lib/elements.json", "{ \"H\": \"1.008\" }\n"]);
  const view = await put(box.root, ["src/views/atoms.tsx", "import { ATOM } from \"@/src/lib/chem\";\nexport default function V() { return ATOM; }\n"]);
  const figure = await put(box.root, [
    "_content/chem/deep/Atom.figure.attach/sketch.ts",
    "import { ATOM } from \"@/src/lib/chem\";\nimport elements from \"@/src/lib/elements.json\";\nexport default () => ATOM + elements.H;\n",
  ]);

  // The same specifier works from a view and from a figure three folders down.
  t.check((await bundleView(view)).output, any(String).includes("hydrogen-one"));
  t.check((await bundleView(figure, { cache: false })).output, any(String).includes("1.008"));

  // The cached view picks up an edit to the imported file; the view is untouched.
  await put(box.root, ["src/lib/chem.ts", "export const ATOM = \"helium-two-changed\";\n"]);
  t.check((await bundleView(view)).output, any(String).includes("helium-two-changed"));

  // A specifier that climbs out of the box root is refused.
  const escape = await put(box.root, ["src/views/escape.tsx", "import x from \"@/../outside\";\nexport default () => x;\n"]);
  await t.checkThrows(() => bundleView(escape), "Error: «*»leaves the box root«*»");
});

void test("`@/` outside a box says why it can't resolve", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "no-box-"));
  const file = await put(dir, ["v.tsx", "import x from \"@/src/lib/x\";\nexport default () => x;\n"]);
  await t.checkThrows(() => bundleView(file), "Error: «*»not in a box«*»");
});

// A symlink inside the box that points out of it is refused: the bundle is
// served to the browser, so `@/` must not read files from elsewhere.
void test("`@/` refuses a symlink that leads out of the box", async (t) => {
  const box = await makeTmpBox({});
  const outside = await mkdtemp(join(tmpdir(), "outside-"));
  const secret = await put(outside, ["secret.ts", "export const S = 1;\n"]);
  await mkdir(join(box.root, "src", "lib"), { recursive: true });
  await symlink(secret, join(box.root, "src", "lib", "linked.ts"));
  const view = await put(box.root, ["src/views/v.tsx", "import { S } from \"@/src/lib/linked\";\nexport default () => S;\n"]);
  await t.checkThrows(() => bundleView(view), "Error: «*»resolves outside the box root«*»");
});

// View metadata can come from an imported file; editing it refreshes the metadata.
void test("view metadata follows an edit to an imported file", async (t) => {
  const box = await makeTmpBox({});
  await put(box.root, ["src/lib/meta.ts", "export const DESCRIPTION = \"first\";\n"]);
  const view = await put(box.root, ["src/views/m.tsx", "export { DESCRIPTION as description } from \"@/src/lib/meta\";\nexport default () => null;\n"]);
  t.check((await getViewMeta(view)).description, "first");
  await put(box.root, ["src/lib/meta.ts", "export const DESCRIPTION = \"second, longer\";\n"]);
  t.check((await getViewMeta(view)).description, "second, longer");
});
