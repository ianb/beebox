# Guidance writers in converted and unconverted boxes

The registry's instruction rows name `AGENTS.md`, but the engine updates before
a box's `agents-md-2026-10` migration runs. Every writer resolves its target
through `instructionFilePath`, so a box not yet converted keeps writing its
`CLAUDE.md` files and a converted box writes `AGENTS.md`. Plan:
`docs/plans/box-agents-md.md`, Track A.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox, type TmpBox } from "../../helpers/doctest-helpers.js";
import { syncBoxGuidance } from "../../../src/core/box/guidance-sync/core.js";
import { generateSkills } from "../../../src/core/box/guidance-sync/skills.js";
import { ensureInstructionMapInclude } from "../../../src/core/maps/finalize/core.js";
import { ensureAgentContext } from "../../../src/core/docs-gen/generate/agents-md.js";
import { AGENTS_MD_MIGRATION } from "../../../src/core/agent-instruction-files.js";

const GUIDES = ["src/schemas", "src/views", "src/tricks/scripts", "_config/feedback"];

/** What sits at a path: a real file, a symlink, or nothing. */
const kind = async (box: TmpBox, rel: string): Promise<string> =>
  fs.lstat(box.path(rel)).then((s) => (s.isSymbolicLink() ? "symlink" : "file"), () => "absent");

/**
 * A converted box: the scaffold's legacy guides and their ledger entries are
 * removed (as if the box had none yet), and the manifest records the migration.
 */
async function convertedBox(): Promise<TmpBox> {
  const box = await makeTmpBox({ git: "none" });
  for (const dir of GUIDES) await fs.rm(box.path(`${dir}/CLAUDE.md`), { force: true });
  await fs.rm(box.path("_config/template-versions.json"), { force: true });
  await fs.appendFile(box.path("_config/migrations.jsonl"), `${JSON.stringify({ name: AGENTS_MD_MIGRATION, "applied-at": "2026-10-09T00:00:00Z" })}\n`);
  return box;
}
```

## An unconverted box keeps its legacy guides

The scaffolded box is unconverted. An edited `src/schemas/CLAUDE.md` stays
where it is through a sync, and no stock `AGENTS.md` appears beside it.

```ts
const box = await makeTmpBox({ git: "none" });
await box.write("src/schemas/CLAUDE.md", "# Our own schema notes\n");
await syncBoxGuidance(box.root, { generators: false });
({
  legacy: await kind(box, "src/schemas/CLAUDE.md"),
  agents: await kind(box, "src/schemas/AGENTS.md"),
  edited: await box.read("src/schemas/CLAUDE.md"),
})
=> { legacy: "file", agents: "absent", edited: "# Our own schema notes\n" }
```

```ts cleanup
await box.cleanup();
```

## A converted box gets AGENTS.md guides

With no guides on disk, a converted box's sync installs each tracked guide as
`AGENTS.md`, recorded in the ledger under that name.

```ts
const box = await convertedBox();
await syncBoxGuidance(box.root, { generators: false });
const versions = JSON.parse(await box.read("_config/template-versions.json"));
({
  agents: await Promise.all(GUIDES.map((dir) => kind(box, `${dir}/AGENTS.md`))),
  legacy: await Promise.all(GUIDES.map((dir) => kind(box, `${dir}/CLAUDE.md`))),
  keys: Object.keys(versions).filter((k) => k.endsWith(".md")),
})
=> {
  agents: ["file", "file", "file", "file"],
  legacy: ["absent", "absent", "absent", "absent"],
  keys: ["_config/feedback/AGENTS.md", "src/schemas/AGENTS.md", "src/tricks/scripts/AGENTS.md", "src/views/AGENTS.md"],
}
```

The maps finalizer writes a mapped directory's include into a real
`AGENTS.md`, with no `CLAUDE.md` and no symlink. A tracked guide is still left
alone:

```ts continue
await fs.mkdir(box.path("_content/mapped"), { recursive: true });
await ensureInstructionMapInclude(box.root, "_content/mapped");
const stock = await box.read("src/views/AGENTS.md");
await ensureInstructionMapInclude(box.root, "src/views");
({
  agents: await kind(box, "_content/mapped/AGENTS.md"),
  legacy: await kind(box, "_content/mapped/CLAUDE.md"),
  include: (await box.read("_content/mapped/AGENTS.md")).trim(),
  guideUnchanged: (await box.read("src/views/AGENTS.md")) === stock,
})
=> { agents: "file", legacy: "absent", include: "@MAP.md", guideUnchanged: true }
```

The root writer creates the root `AGENTS.md` with the agent-guide include:

```ts continue
await fs.rm(box.path("CLAUDE.md"), { force: true });
await ensureAgentContext(box.root, []);
({ agents: await kind(box, "AGENTS.md"), legacy: await kind(box, "CLAUDE.md"), content: await box.read("AGENTS.md") })
=> { agents: "file", legacy: "absent", content: "@.beebox/agent-guide.md\n" }
```

The course skill tells the agent to make a course-local `AGENTS.md`:

```ts continue
await generateSkills(box.root);
const skill = await box.read(".claude/skills/build-course/SKILL.md");
({ agents: skill.includes("editable `AGENTS.md`"), legacy: skill.includes("CLAUDE.md") })
=> { agents: true, legacy: false }
```

```ts cleanup
await box.cleanup();
```

## The unconverted root writer and course skill keep CLAUDE.md

```ts
const box = await makeTmpBox({ git: "none" });
await fs.rm(box.path("CLAUDE.md"), { force: true });
await ensureAgentContext(box.root, []);
await generateSkills(box.root);
const skill = await box.read(".claude/skills/build-course/SKILL.md");
({
  root: await kind(box, "CLAUDE.md"),
  mirror: await kind(box, "AGENTS.md"),
  skill: skill.includes("editable `CLAUDE.md`"),
})
=> { root: "file", mirror: "symlink", skill: true }
```

```ts cleanup
await box.cleanup();
```
