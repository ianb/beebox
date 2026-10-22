// # extfile sync: stamp version/size/mtime from the live file
//
// `syncExtfile` re-stamps an extfile card's drift metadata (`version`/`size`/
// `mtime`) from its live external file. It rewrites **only when the content hash
// changed** (churn control), and reports cards whose href can't be resolved
// instead of throwing. The box's own root is always an allowed root, so a target
// inside the box resolves without extra `externalRoots` config.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { readFile, utimes, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../../src/exports/cards.js";
import { isRecord } from "../../src/shared/is-record.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { syncExtfile } from "../../src/core/extfile-sync.js";

async function readFm(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, "utf8");
  const parsed: unknown = parseYaml(splitCardContent(content).frontmatterText) ?? {};
  assert.ok(isRecord(parsed));
  return parsed;
}

// ## A fresh card gets stamped with version/size/mtime
void test("A fresh card gets stamped with version/size/mtime", async (t) => {
  const box = await makeTmpBox();
  await box.write("store/src/foo.ts", "console.log(1);\n");
  const cardPath = box.path("store/review/Foo.extfile.card");
  await box.write("store/review/Foo.extfile.card", `---\ntype: extfile\nhref: file:${box.path("store/src/foo.ts")}\n---\n`);
  const r1 = await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
  t.check(r1, [{ path: cardPath, status: "stamped" }]);

  const fm = await readFm(cardPath);
  t.check(fm, {
    type: "extfile",
    href: `file:${box.path("store/src/foo.ts")}`,
    version: "sha256:b603d946eb2b",
    size: 16,
    mtime: isoDate(),
  });
});

// ## A bumped mtime with unchanged content is "unchanged" (no rewrite)
void test("A bumped mtime with unchanged content is \"unchanged\" (no rewrite)", async (t) => {
  const box = await makeTmpBox();
  await box.write("store/src/foo.ts", "console.log(1);\n");
  const cardPath = box.path("store/review/Foo.extfile.card");
  await box.write("store/review/Foo.extfile.card", `---\ntype: extfile\nhref: file:${box.path("store/src/foo.ts")}\n---\n`);
  await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
  const before = await readFm(cardPath);
  // Bump only the file's mtime; the bytes are identical.
  await utimes(box.path("store/src/foo.ts"), new Date("2031-01-01T00:00:00Z"), new Date("2031-01-01T00:00:00Z"));
  const r2 = await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
  t.check(r2, [{ path: cardPath, status: "unchanged" }]);

  const after = await readFm(cardPath);
  t.check(after, before);
});

// ## Changed content re-stamps with a new version
void test("Changed content re-stamps with a new version", async (t) => {
  const box = await makeTmpBox();
  await box.write("store/src/foo.ts", "console.log(1);\n");
  const cardPath = box.path("store/review/Foo.extfile.card");
  await box.write("store/review/Foo.extfile.card", `---\ntype: extfile\nhref: file:${box.path("store/src/foo.ts")}\n---\n`);
  await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
  t.check(await readFm(cardPath), {
    type: "extfile",
    href: `file:${box.path("store/src/foo.ts")}`,
    version: "sha256:b603d946eb2b",
    size: 16,
    mtime: isoDate(),
  });
  await writeFile(box.path("store/src/foo.ts"), "console.log(2);\nconsole.log(3);\n");
  const r3 = await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
  t.check(r3, [{ path: cardPath, status: "stamped" }]);

  t.check(await readFm(cardPath), {
    type: "extfile",
    href: `file:${box.path("store/src/foo.ts")}`,
    version: "sha256:efbba5d3dd49",
    size: 32,
    mtime: isoDate(),
  });
});

// ## An unresolvable href is reported, not thrown
void test("An unresolvable href is reported, not thrown", async (t) => {
  const box = await makeTmpBox();
  const cardPath = box.path("store/review/Gone.extfile.card");
  await box.write("store/review/Gone.extfile.card", "---\ntype: extfile\nhref: file:/nonexistent/nope.ts\n---\n");
  const r = await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
  t.check(r, [{ path: cardPath, status: "unresolved", detail: "Target not found" }]);
});
