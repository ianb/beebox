// Every member of the sketch's `View` is documented: TEA.md or BRUSHES.md
// names it as `v.<name>`, so a new call cannot ship undocumented. And no
// member of `View` or `Util` hands a sketch a GPU object.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

/** The body of `export interface <name> … {` in `source`, to its closing brace at column 0. */
function interfaceBody(source: string, name: string): string {
  const start = source.indexOf(`\nexport interface ${name}`);
  assert.ok(start !== -1, `interface ${name} in core/tea.ts`);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end);
}

/** Member names declared at the interface's first level (two-space indent). */
function memberNames(body: string): string[] {
  const names = [...body.matchAll(/^ {2}(?:readonly )?(\w+)\??[(:<]/gmu)].map((m) => m[1] ?? "");
  return [...new Set(names)];
}

const tea = read("src/core/tea.ts");
/** Every `v.<name>` the two sketch docs mention. */
const documented = new Set([...`${read("TEA.md")}\n${read("BRUSHES.md")}`.matchAll(/\bv\.(\w+)/gu)].map((m) => m[1]));

test("every View member is named as v.<name> in TEA.md or BRUSHES.md", () => {
  const names = memberNames(interfaceBody(tea, "View"));
  assert.ok(names.length > 40, `found ${names.length} View members; the parser missed some`);
  const missing = names.filter((name) => !documented.has(name));
  assert.deepEqual(missing, [], `View members with no v.<name> in TEA.md or BRUSHES.md: ${missing.join(", ")}`);
});

test("no View or Util member is typed with a GPU object", () => {
  for (const name of ["View", "Util"]) {
    const gpu = interfaceBody(tea, name).match(/\bGPU\w*/gu) ?? [];
    assert.deepEqual(gpu, [], `${name} mentions ${gpu.join(", ")}`);
  }
});
