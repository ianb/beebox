// # health: engine-link and box-schemas checks
//
// `engineHealthChecks` is the health-check family that would have caught the
// 2026-07 incident where every local box's engine symlink went dead after the
// engine checkout was renamed: `engine-link` verifies a box's
// `node_modules/beebox` resolves to a readable engine (and isn't pinned
// to a transient worktree), and `box-schemas` surfaces box-local schema files
// that failed to load (keep-last-good otherwise hides them).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, symlink, rm, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";
import { engineHealthChecks, boxSchemaFieldsCheck } from "../../../../../../src/webapp/trpc/routers/health/checks/engine.js";
import { cardSchema } from "../../../../../../src/exports/cards.js";
import { invalidateBoxSchemas } from "../../../../../../src/schemas.js";
import { makeTmpBox } from "../../../../../helpers/test-helpers.js";

// Hand-scaffold a v3 (one-root) shape inside a tmp box: package.json
// declaring a beebox dependency and recording the shape, beside `_config/`.
async function scaffoldV3(box: Awaited<ReturnType<typeof makeTmpBox>>): Promise<string> {
  await box.write(
    "pkg/package.json",
    JSON.stringify({ name: "tmp-box", private: true, dependencies: { "beebox": "^0.1.0" }, beebox: { shapeVersion: 3, created: "2026-01-01T00:00:00.000Z" } }),
  );
  await box.write("pkg/_config/.gitkeep", "");
  return box.path("pkg");
}

function byName<T extends { name: string }>(checks: T[], name: string): T | undefined {
  return checks.find((c) => c.name === name);
}

// ## Healthy v3 box: engine link resolves to a readable engine
//
// (A fake engine directory outside any `beebox-worktrees` path — linking the
// test's own running engine would legitimately trip the worktree-pinned
// warning below whenever the suite runs from a worktree.)
void test("(A fake engine directory outside any beebox-worktrees path — linking the test...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const boxRoot = await scaffoldV3(box);
  await box.write(
    "engines/main/beebox/package.json",
    JSON.stringify({ name: "beebox", version: "9.9.9" }),
  );
  await mkdir(box.path("pkg/node_modules"), { recursive: true });
  await symlink(box.path("engines/main/beebox"), box.path("pkg/node_modules/beebox"));

  const healthy = await engineHealthChecks(boxRoot);
  const link = byName(healthy, "engine-link");
  t.check(link, { name: "engine-link", ok: true, message: "engine dependency resolves (beebox 9.9.9)", severity: "warning" });

  t.check(byName(healthy, "box-schemas"), { name: "box-schemas", ok: true, message: "box-local schemas load cleanly", severity: "error" });

  // ## Dead engine symlink: error naming the target and the repair
  //
  // The incident shape — the link's target checkout was renamed away.

  await rm(box.path("pkg/node_modules/beebox"));
  await symlink(box.path("nonexistent-checkout/beebox"), box.path("pkg/node_modules/beebox"));

  const dead = await engineHealthChecks(boxRoot);
  const deadLink = byName(dead, "engine-link");
  t.check(deadLink, {
    name: "engine-link",
    ok: false,
    message: `node_modules/beebox is a dead symlink (→ ${box.path("nonexistent-checkout/beebox")}) — box-local schemas and templates will not load. Repoint it: ln -sfn <engine-checkout>/beebox ${box.path("pkg/node_modules/beebox")}`,
    severity: "error",
  });

  // ## Worktree-pinned engine link: warning (it dies with the worktree)
  //
  // A resolvable link that points into a `beebox-worktrees` checkout, on a box
  // that is not itself a worktree clone — how test1 broke in the incident.

  await box.write(
    "beebox-worktrees/some-feature/beebox/package.json",
    JSON.stringify({ name: "beebox", version: "0.1.0" }),
  );
  await rm(box.path("pkg/node_modules/beebox"));
  await symlink(box.path("beebox-worktrees/some-feature/beebox"), box.path("pkg/node_modules/beebox"));

  const pinned = await engineHealthChecks(boxRoot);
  const pinnedLink = byName(pinned, "engine-link");
  t.check(pinnedLink, {
    name: "engine-link",
    ok: false,
    message: `node_modules/beebox points into a worktree (→ ${box.path("beebox-worktrees/some-feature/beebox")}) — it will go dead when that worktree is removed. Repoint at the main checkout.`,
    severity: "warning",
  });

  await unlink(box.path("pkg/node_modules/beebox"));
  await mkdir(box.path("callback-worktrees/old-feature/beebox"), { recursive: true });
  await writeFile(box.path("callback-worktrees/old-feature/beebox/package.json"), JSON.stringify({ name: "beebox", version: "0.1.0" }));
  await symlink(box.path("callback-worktrees/old-feature/beebox"), box.path("pkg/node_modules/beebox"));

  t.check((await engineHealthChecks(boxRoot)).find((c) => c.name === "engine-link")?.ok, false);

  // ## Broken box-local schema file: box-schemas error names the file

  await box.write("pkg/src/schemas/widget.ts", "import { nope } from \"./does-not-exist.js\";\n");
  // The registry caches per-box schema snapshots; in the server a change
  // trigger invalidates on schema edits, so the test does the same.
  invalidateBoxSchemas(boxRoot);
  const withBroken = await engineHealthChecks(boxRoot);
  const schemas = byName(withBroken, "box-schemas");
  t.check(schemas, {
    name: "box-schemas",
    ok: false,
    message: "1 box-local schema file(s) failed to load — their card types are missing or stale: widget.ts: does not export a default cardSchema()",
    severity: "error",
  });

  // ## Box-local schema with a reserved field name: box-schema-fields warns
  //
  // A box-local schema that declares `status` or redeclares a global still loads;
  // this warning is how the box finds out. It names the type, the field, and what
  // to write instead.

  const book = cardSchema("book", {
    fields: { name: z.string(), status: z.enum(["owned", "wanted"]) },
  });
  const shelf = cardSchema("shelf", { fields: { name: z.string() } });

  const fieldCheck = boxSchemaFieldsCheck([book, shelf]);
  t.check(fieldCheck, {
    name: "box-schema-fields",
    ok: false,
    message: "1 reserved field name(s) in box-local schemas: book.status: `status` is a reserved field name: record the specific fact instead: a named boolean per state (`archived: true`), a specifically named enum (`operating: open | closed`), the presence of the result, or an error field",
    severity: "warning",
  });

  t.check(boxSchemaFieldsCheck([shelf]).ok, true);
});

// ## Through the engine link
//
// A box on the portable spec has `node_modules/beebox → ../.beebox/engine`,
// and `.beebox/engine` holds this machine's engine path. The check reports and
// repairs that link: a missing link, a dead one, and one pinned to a worktree.
void test("engine-link reports the .beebox/engine link a portable box resolves through", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const boxRoot = await scaffoldV3(box);
  const engineLink = box.path("pkg/.beebox/engine");
  await mkdir(box.path("pkg/node_modules"), { recursive: true });
  await mkdir(box.path("pkg/.beebox"), { recursive: true });
  await symlink("../.beebox/engine", box.path("pkg/node_modules/beebox"));
  const message = async (): Promise<string | undefined> => byName(await engineHealthChecks(boxRoot), "engine-link")?.message;

  const missing = await message();
  await symlink(box.path("gone/beebox"), engineLink);
  const dead = await message();
  await box.write("beebox-worktrees/feature/beebox/package.json", JSON.stringify({ name: "beebox", version: "0.1.0" }));
  await unlink(engineLink);
  await symlink(box.path("beebox-worktrees/feature/beebox"), engineLink);
  const pinned = await message();
  t.check({ missing, dead, pinned }, {
    missing: `the engine link ${engineLink} is missing — box-local schemas and templates will not load. Create it: ln -sfn <engine-checkout>/beebox ${engineLink}`,
    dead: `.beebox/engine is a dead symlink (→ ${box.path("gone/beebox")}) — box-local schemas and templates will not load. Repoint it: ln -sfn <engine-checkout>/beebox ${engineLink}`,
    pinned: `.beebox/engine points into a worktree (→ ${box.path("beebox-worktrees/feature/beebox")}) — it will go dead when that worktree is removed. Repoint at the main checkout.`,
  });
});

// ## A portable box needs its engine link even while the old install works
//
// After the engine-link migration, `node_modules/beebox` can still point
// straight at the old engine until the next install. That install goes
// through `.beebox/engine`, so a portable box without a usable link is an
// error now, not after the install.
void test("engine-link checks .beebox/engine for a portable box whose install still points elsewhere", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write(
    "pkg/package.json",
    JSON.stringify({ name: "tmp-box", private: true, dependencies: { beebox: "link:.beebox/engine" }, beebox: { shapeVersion: 3, created: "2026-01-01T00:00:00.000Z" } }),
  );
  await box.write("pkg/_config/.gitkeep", "");
  await box.write("engines/main/beebox/package.json", JSON.stringify({ name: "beebox", version: "9.9.9" }));
  await mkdir(box.path("pkg/node_modules"), { recursive: true });
  await symlink(box.path("engines/main/beebox"), box.path("pkg/node_modules/beebox"));
  const boxRoot = box.path("pkg");
  const engineLink = box.path("pkg/.beebox/engine");

  const missing = byName(await engineHealthChecks(boxRoot), "engine-link");
  await mkdir(box.path("pkg/.beebox"), { recursive: true });
  await symlink(box.path("engines/main/beebox"), engineLink);
  const linked = byName(await engineHealthChecks(boxRoot), "engine-link");
  t.check({ missing, linked }, {
    missing: {
      name: "engine-link",
      ok: false,
      message: `the engine link ${engineLink} is missing — box-local schemas and templates will not load. Create it: ln -sfn <engine-checkout>/beebox ${engineLink}`,
      severity: "error",
    },
    linked: { name: "engine-link", ok: true, message: "engine dependency resolves (beebox 9.9.9)", severity: "warning" },
  });
});
