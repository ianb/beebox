/**
 * Golden tests for the doctest-to-ts converter: each fixture in
 * fixtures/ converts to exactly its `.converted.txt`, and its
 * manifest lists every example. `UPDATE_GOLDEN=1` rewrites the goldens;
 * read the diff before committing one.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "tap";
import { convertDoctest } from "../../src/convert/test-file.js";

const FIXTURES = fileURLToPath(new URL("fixtures/", import.meta.url));

for (const name of readdirSync(FIXTURES).filter((f) => f.endsWith(".md"))) {
  void test(`converts ${name}`, async (t) => {
    const markdown = readFileSync(join(FIXTURES, name), "utf8");
    const { source, manifest } = convertDoctest(markdown, { filePath: join(FIXTURES, name) });
    const golden = join(FIXTURES, name.replace(/\.md$/, ".converted.txt"));
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, source);
    t.equal(source, readFileSync(golden, "utf8"));
    // The same fixture with the typed upgrade (doctest-upgrade.ts).
    const upgraded = convertDoctest(markdown, { filePath: join(FIXTURES, name), upgrade: true }).source;
    const upgradedGolden = join(FIXTURES, name.replace(/\.md$/, ".upgraded.txt"));
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(upgradedGolden, upgraded);
    t.equal(upgraded, readFileSync(upgradedGolden, "utf8"));
    // Every marker in the source is one manifest example, in order.
    const markers = [...source.matchAll(/\/\/ doctest:L(\d+)/g)].map((m) => Number(m[1]));
    t.check(markers, manifest.examples.map((e) => e.line));
  });
}

void test("a continue block with no test before it is an error", async (t) => {
  await t.checkThrows(() => convertDoctest("```ts continue\n1\n=> 1\n```\n", { filePath: "/x/orphan.doctest.md" }), "DoctestSyntaxError");
});
