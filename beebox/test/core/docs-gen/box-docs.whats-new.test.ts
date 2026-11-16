// # The person's changelog is copied into the box
//
// `docs/box/whats-new.md` ships in the package but is not a package doc: every
// docs refresh copies it to `_content/docs/generated/whats-new.md`, where the
// person opens it from Settings. Plan: `plan:whats-new`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWhatsNew } from "../../../src/core/docs-gen/box-docs.js";
import { engineDocFilenames } from "../../../src/core/docs-gen/package-docs/core.js";
import { WHATS_NEW_PATH } from "../../../src/shared/whats-new-path.js";

async function fixture(t: { teardown: (fn: () => Promise<void>) => void }): Promise<{ boxRoot: string; packageRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "whats-new-"));
  t.teardown(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "pkg");
  const boxRoot = join(root, "box");
  await mkdir(join(packageRoot, "docs", "box"), { recursive: true });
  await mkdir(boxRoot);
  await writeFile(join(packageRoot, "docs", "box", "whats-new.md"), "# What's new\n\n- 2026-11-15: A new control.\n");
  return { boxRoot, packageRoot };
}

void test("A refresh writes the box copy, marked as generated", async (t) => {
  const { boxRoot, packageRoot } = await fixture(t);
  await copyWhatsNew({ boxRoot, packageRoot });
  const copy = await readFile(join(boxRoot, WHATS_NEW_PATH), "utf-8");
  t.check(copy, any(String).includes(`DOCID:${WHATS_NEW_PATH}`));
  t.check(copy, any(String).includes("- 2026-11-15: A new control."));
});

void test("A changed source and a deleted copy are both rewritten", async (t) => {
  const { boxRoot, packageRoot } = await fixture(t);
  await copyWhatsNew({ boxRoot, packageRoot });
  await writeFile(join(packageRoot, "docs", "box", "whats-new.md"), "# What's new\n\n- 2026-11-16: Newer.\n");
  await copyWhatsNew({ boxRoot, packageRoot });
  t.check(await readFile(join(boxRoot, WHATS_NEW_PATH), "utf-8"), any(String).includes("Newer."));
  await rm(join(boxRoot, WHATS_NEW_PATH));
  await copyWhatsNew({ boxRoot, packageRoot });
  t.check(await readFile(join(boxRoot, WHATS_NEW_PATH), "utf-8"), any(String).includes("Newer."));
});

void test("The changelog is not a package doc", async (t) => {
  // The list is the package docs named whats-new.md: none.
  t.check(engineDocFilenames().filter((f) => f === "whats-new.md"), []);
});
