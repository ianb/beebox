// # Guidance writers in converted and unconverted boxes
//
// The registry's instruction rows name `AGENTS.md`, but the engine updates before
// a box's `agents-md-2026-10` migration runs. Every writer resolves its target
// through `instructionFilePath`, so a box not yet converted keeps writing its
// `CLAUDE.md` files and a converted box writes `AGENTS.md`. Plan:
// `docs/implemented-plans/box-agents-md.md`, Track A.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import { makeTmpBox, type TmpBox } from "../../helpers/doctest-helpers.js";
import { syncBoxGuidance } from "../../../src/core/box/guidance-sync/core.js";
import { ensureInstructionMapInclude } from "../../../src/core/maps/finalize/core.js";
import { ensureAgentContext } from "../../../src/core/docs-gen/generate/agents-md.js";

const GUIDES = ["src/schemas", "src/views", "src/tricks/scripts", "_config/feedback"];

/** What sits at a path: a real file, a symlink, or nothing. */
const kind = async (box: TmpBox, rel: string): Promise<string> =>
  fs.lstat(box.path(rel)).then((s) => (s.isSymbolicLink() ? "symlink" : "file"), () => "absent");

/**
 * A converted box (every new box is: its manifest records the migration) with
 * the scaffold's guides and their ledger entries removed, as if it had none yet.
 */
async function convertedBox(): Promise<TmpBox> {
  const box = await makeTmpBox({ git: "none" });
  for (const dir of GUIDES) await fs.rm(box.path(`${dir}/AGENTS.md`), { force: true });
  await fs.rm(box.path("_config/template-versions.json"), { force: true });
  return box;
}

// ## An unconverted box keeps its legacy guides
//
// A box made before the migration (`legacyInstructions`) is unconverted. An edited `src/schemas/CLAUDE.md` stays
// where it is through a sync, and no stock `AGENTS.md` appears beside it.
void test("A box made before the migration (legacyInstructions) is unconverted.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L41
  const box = await makeTmpBox({ git: "none", legacyInstructions: true });
  await box.write("src/schemas/CLAUDE.md", "# Our own schema notes\n");
  await syncBoxGuidance(box.root, { generators: false });
  t.check(
    ({
      legacy: await kind(box, "src/schemas/CLAUDE.md"),
      agents: await kind(box, "src/schemas/AGENTS.md"),
      edited: await box.read("src/schemas/CLAUDE.md"),
    }),
    {
    legacy: "file",
    agents: "absent",
    edited: `# Our own schema notes
`,
  },
  );
});

// ## A converted box gets AGENTS.md guides
//
// With no guides on disk, a converted box's sync installs each tracked guide as
// `AGENTS.md`, recorded in the ledger under that name.
void test("With no guides on disk, a converted box's sync installs each tracked guide as...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L62
  const box = await convertedBox();
  await syncBoxGuidance(box.root, { generators: false });
  const versions = JSON.parse(await box.read("_config/template-versions.json"));
  t.check(
    ({
      agents: await Promise.all(GUIDES.map((dir) => kind(box, `${dir}/AGENTS.md`))),
      legacy: await Promise.all(GUIDES.map((dir) => kind(box, `${dir}/CLAUDE.md`))),
      keys: Object.keys(versions).filter((k) => k.endsWith(".md")),
    }),
    {
    agents: [
      "file",
      "file",
      "file",
      "file",
    ],
    legacy: [
      "absent",
      "absent",
      "absent",
      "absent",
    ],
    keys: [
      "_config/feedback/AGENTS.md",
      "src/schemas/AGENTS.md",
      "src/tricks/scripts/AGENTS.md",
      "src/views/AGENTS.md",
    ],
  },
  );

  // The maps finalizer writes a mapped directory's include into a real
  // `AGENTS.md`, with no `CLAUDE.md` and no symlink. A tracked guide is still left
  // alone:

  // doctest:L82
  await fs.mkdir(box.path("_content/mapped"), { recursive: true });
  await ensureInstructionMapInclude(box.root, "_content/mapped");
  const stock = await box.read("src/views/AGENTS.md");
  await ensureInstructionMapInclude(box.root, "src/views");
  t.check(
    ({
      agents: await kind(box, "_content/mapped/AGENTS.md"),
      legacy: await kind(box, "_content/mapped/CLAUDE.md"),
      include: (await box.read("_content/mapped/AGENTS.md")).trim(),
      guideUnchanged: (await box.read("src/views/AGENTS.md")) === stock,
    }),
    {
    agents: "file",
    legacy: "absent",
    include: "@MAP.md",
    guideUnchanged: true,
  },
  );

  // The root writer creates the root `AGENTS.md` with the agent-guide include:

  // doctest:L98
  await fs.rm(box.path("CLAUDE.md"), { force: true });
  await ensureAgentContext(box.root, []);
  t.check(({ agents: await kind(box, "AGENTS.md"), legacy: await kind(box, "CLAUDE.md"), content: await box.read("AGENTS.md") }), {
    agents: "file",
    legacy: "absent",
    content: `@.beebox/agent-guide.md
`,
  });
});

// ## The unconverted root writer keeps CLAUDE.md
void test("The unconverted root writer keeps CLAUDE.md", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L111
  const box = await makeTmpBox({ git: "none", legacyInstructions: true });
  await fs.rm(box.path("CLAUDE.md"), { force: true });
  await ensureAgentContext(box.root, []);
  t.check(
    ({
      root: await kind(box, "CLAUDE.md"),
      mirror: await kind(box, "AGENTS.md"),
    }),
    {
    root: "file",
    mirror: "symlink",
  },
  );
});
