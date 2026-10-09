# Migration on a real box: CLAUDE.md becomes AGENTS.md

`agents-md-2026-10` runs against a box the new engine already serves. Before
the migration, the engine's writers keep the box on `CLAUDE.md` through the
instruction-file resolver. After it, they find `AGENTS.md` everywhere, with the
template ledger and parked updates moved along. The framework reopens a box
whose migration stopped partway, so every interruption point must be a state
the template sync and `generateDocs` handle. Plan: `docs/implemented-plans/box-agents-md.md`,
Track B and "What will hold this after it ships".

The fixture is an unconverted box (`makeTmpBox({ legacyInstructions: true })`)
after one `generateDocs`, which gives it a root `CLAUDE.md` and `AGENTS.md`
symlink mirrors. On top: an edited schemas guide whose ledger entry records an
older `stock` and a pending update parked beside it, and a mapped directory
with a map include stub and its mirror.

```ts setup
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { runAgentsMd } from "../../../src/scripts/migrate/agents-md/run.js";
import { syncBoxGuidance } from "../../../src/core/box/guidance-sync/core.js";
import { generateDocs, generatedDocsAreCurrent } from "../../../src/core/docs-gen/generate/core.js";
import { isTemplateManagedPath, listParkedTemplateUpdates, readVersions, writeVersions } from "../../../src/core/install-template-file.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const OLD_STOCK = "# Schemas\n\nRead the schema docs before writing here.\n";
const EDITED = "# Our schemas\n\nAlways add a summary field.\n";
const SKIP = new Set([".git", "node_modules", ".agents", "_template-updates"]);
const git = (root: string, args: string) => execSync(`git ${args}`, { cwd: root, encoding: "utf8" }).trim();

/** Every instruction file in the box, as `path (file|symlink)`. */
async function instructionFiles(root: string, dir = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await instructionFiles(root, rel)));
    else if (entry.name === "CLAUDE.md" || entry.name === "AGENTS.md") out.push(`${rel} (${entry.isSymbolicLink() ? "symlink" : "file"})`);
  }
  return out.toSorted();
}

/** The parts of the box the migration must carry through every state. */
async function guideState(root: string) {
  const versions = await readVersions(root);
  const keys = Object.keys(versions).filter((k) => k.startsWith("src/schemas/"));
  const guide = (await instructionFiles(root, "src/schemas")).find((f) => f.endsWith("(file)"))?.split(" ")[0];
  return {
    keys,
    stock: keys.map((k) => versions[k]?.stock === OLD_STOCK),
    parks: await listParkedTemplateUpdates(root),
    edited: guide === undefined ? null : (await fs.readFile(path.join(root, guide), "utf8")) === EDITED,
  };
}

/**
 * A valid intermediate state: no directory holds two real instruction files,
 * and no converted directory sits below one still on CLAUDE.md (parents
 * convert first). Returns the violations.
 */
async function violations(root: string): Promise<string[]> {
  const files = await instructionFiles(root);
  const real = (name: string) => files.filter((f) => f.endsWith(`${name} (file)`)).map((f) => path.posix.dirname(f.split(" ")[0]));
  const legacy = real("CLAUDE.md");
  const converted = real("AGENTS.md");
  const out = legacy.filter((d) => converted.includes(d)).map((d) => `both in ${d}`);
  for (const dir of converted) {
    for (const parent of legacy) {
      if (parent !== dir && (parent === "." || dir.startsWith(`${parent}/`))) out.push(`${dir} converted below unconverted ${parent}`);
    }
  }
  return out;
}

const template = await makeTmpBox({ git: true, legacyInstructions: true });
await generateDocs(template.root, { force: true });
const fixtureVersions = await readVersions(template.root);
const currentStock = fixtureVersions["src/schemas/CLAUDE.md"]?.stock ?? "";
fixtureVersions["src/schemas/CLAUDE.md"] = { sha256: sha(OLD_STOCK), "installed-at": "2026-09-01T00:00:00.000Z", stock: OLD_STOCK, pending: sha(currentStock) };
await writeVersions(template.root, fixtureVersions);
await template.write("src/schemas/CLAUDE.md", EDITED);
await template.write("_config/_template-updates/src/schemas/CLAUDE.md", currentStock);
await template.write("_content/mapped/MAP.md", "# Mapped\n");
await template.write("_content/mapped/CLAUDE.md", "@MAP.md\n");
await fs.symlink("CLAUDE.md", template.path("_content/mapped/AGENTS.md"));
template.commitAll("fixture");

/** A fresh copy of the fixture box. */
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "bbx-agents-md-"));
  await fs.cp(template.root, root, { recursive: true, verbatimSymlinks: true });
  return root;
}
```

## The fixture starts unconverted

Every instruction file is a `CLAUDE.md` with its symlink mirror:

```ts
const root = await fixture();
await instructionFiles(root)
=> [
  "AGENTS.md (symlink)",
  "CLAUDE.md (file)",
  "_config/feedback/AGENTS.md (symlink)",
  "_config/feedback/CLAUDE.md (file)",
  "_content/mapped/AGENTS.md (symlink)",
  "_content/mapped/CLAUDE.md (file)",
  "src/schemas/AGENTS.md (symlink)",
  "src/schemas/CLAUDE.md (file)",
  "src/tricks/scripts/AGENTS.md (symlink)",
  "src/tricks/scripts/CLAUDE.md (file)",
  "src/views/AGENTS.md (symlink)",
  "src/views/CLAUDE.md (file)",
]
```

## Before the migration, the sync writes nothing at AGENTS.md

The new engine's sync on the unconverted box keeps the edited legacy guide and
its park, and plants no real `AGENTS.md`:

```ts continue
await syncBoxGuidance(root, { generators: true });
({ files: (await instructionFiles(root)).filter((f) => f.startsWith("AGENTS") || f.includes("/AGENTS")).map((f) => f.split(" ")[1]), state: await guideState(root) })
=> {
  files: ["(symlink)", "(symlink)", "(symlink)", "(symlink)", "(symlink)", "(symlink)"],
  state: { keys: ["src/schemas/CLAUDE.md"], stock: [true], parks: ["src/schemas/CLAUDE.md"], edited: true },
}
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true });
```

## The migration converts the box; the sync then agrees

The dry run lists the steps, parents first, and writes nothing:

```ts
const root = await fixture();
const dry = await runAgentsMd({ boxRoot: root, mode: "plan" });
({ code: dry.code, lines: dry.lines })
=> {
  code: 0,
  lines: [
    "rename CLAUDE.md -> AGENTS.md (replaces symlink) (dry run; pass --apply)",
    "rename _config/feedback/CLAUDE.md -> _config/feedback/AGENTS.md (replaces symlink) (dry run; pass --apply)",
    "ledger _config/feedback/CLAUDE.md -> _config/feedback/AGENTS.md (dry run; pass --apply)",
    "rename _content/mapped/CLAUDE.md -> _content/mapped/AGENTS.md (replaces symlink) (dry run; pass --apply)",
    "rename src/schemas/CLAUDE.md -> src/schemas/AGENTS.md (replaces symlink) (dry run; pass --apply)",
    "ledger src/schemas/CLAUDE.md -> src/schemas/AGENTS.md (dry run; pass --apply)",
    "park src/schemas/CLAUDE.md -> src/schemas/AGENTS.md (dry run; pass --apply)",
    "rename src/views/CLAUDE.md -> src/views/AGENTS.md (replaces symlink) (dry run; pass --apply)",
    "ledger src/views/CLAUDE.md -> src/views/AGENTS.md (dry run; pass --apply)",
    "rename src/tricks/scripts/CLAUDE.md -> src/tricks/scripts/AGENTS.md (replaces symlink) (dry run; pass --apply)",
    "ledger src/tricks/scripts/CLAUDE.md -> src/tricks/scripts/AGENTS.md (dry run; pass --apply)",
    "agents-md: 11 step(s) planned.",
  ],
}
```

Applied, every file is a real `AGENTS.md`, and the ledger entry kept its
`stock`. The box's manifest is the framework's to write, so the test records
the migration the way `bbx engine migrate` would before the sync runs. The sync
then parks nothing new and does not overwrite the edited guide:

```ts continue
const applied = await runAgentsMd({ boxRoot: root, mode: "apply" });
await fs.appendFile(path.join(root, "_config/migrations.jsonl"), `${JSON.stringify({ name: "agents-md-2026-10", "applied-at": "2026-10-09T00:00:00.000Z" })}\n`);
await syncBoxGuidance(root, { generators: true });
({ code: applied.code, last: applied.lines.at(-1), files: await instructionFiles(root), state: await guideState(root) })
=> {
  code: 0,
  last: "agents-md: applied 11 step(s).",
  files: [
    "AGENTS.md (file)",
    "_config/feedback/AGENTS.md (file)",
    "_content/mapped/AGENTS.md (file)",
    "src/schemas/AGENTS.md (file)",
    "src/tricks/scripts/AGENTS.md (file)",
    "src/views/AGENTS.md (file)",
  ],
  state: { keys: ["src/schemas/AGENTS.md"], stock: [true], parks: ["src/schemas/AGENTS.md"], edited: true },
}
```

The map include stub kept its content, and a second run has nothing to do:

```ts continue
({ stub: await fs.readFile(path.join(root, "_content/mapped/AGENTS.md"), "utf8"), again: (await runAgentsMd({ boxRoot: root, mode: "apply" })).lines })
=> { stub: "@MAP.md\n", again: ["agents-md: already converted."] }
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true });
```

## A conflict writes nothing

A real `AGENTS.md` beside the root `CLAUDE.md` stops the run with exit 1,
before any rename:

```ts
const root = await fixture();
await fs.rm(path.join(root, "AGENTS.md"));
await fs.writeFile(path.join(root, "AGENTS.md"), "# Codex notes\n");
const result = await runAgentsMd({ boxRoot: root, mode: "apply" });
({ code: result.code, lines: result.lines, files: (await instructionFiles(root)).filter((f) => f.includes("CLAUDE.md (file)")).length })
=> {
  code: 1,
  lines: [
    "conflict (both-files): CLAUDE.md and AGENTS.md are both instruction files. Merge them into AGENTS.md by hand and delete CLAUDE.md.",
    "agents-md: 1 conflict(s); nothing written.",
  ],
  files: 6,
}
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true });
```

## Every interruption point is a valid state, and a retry completes it

For each step count, the run stops there. The template sync and a committing
`generateDocs` then run on the half-converted box, as they would after the
framework reopens it. Each state must be valid: no directory with two real
instruction files, no converted directory below an unconverted one, the edited
guide intact with one ledger entry (its `stock` kept) and one park. The
`generateDocs` commit holds only template output and none of the migration's
renames, which stay for the framework's own commit. A retry then finishes the
conversion.

Each row is one stop point: how many `CLAUDE.md` files the stop left, and
every problem found (empty is valid).

```ts
const rows: string[] = [];
for (let stop = 1; stop < 11; stop++) {
  const root = await fixture();
  const head = git(root, "rev-parse HEAD");
  await runAgentsMd({ boxRoot: root, mode: "apply", stopAfter: stop });
  const legacy = (await instructionFiles(root)).filter((f) => f.endsWith("CLAUDE.md (file)")).length;
  await syncBoxGuidance(root, { generators: true });
  await generateDocs(root, { force: true });
  const committed = git(root, `diff --name-only ${head} HEAD`).split("\n").filter((p) => p !== "");
  const state = await guideState(root);
  const problems = [
    ...(await violations(root)),
    ...committed.filter((p) => /(CLAUDE|AGENTS)\.md$/.test(p) || !isTemplateManagedPath(p)).map((p) => `committed ${p}`),
    ...(JSON.stringify(state.stock) === "[true]" && state.parks.length === 1 && state.edited === true ? [] : [`guide state ${JSON.stringify(state)}`]),
  ];
  const retry = await runAgentsMd({ boxRoot: root, mode: "apply" });
  if (retry.code !== 0) problems.push(`retry exit ${String(retry.code)}`);
  const left = (await instructionFiles(root)).filter((f) => f.includes("CLAUDE.md"));
  if (left.length > 0) problems.push(`left ${left.join(", ")}`);
  rows.push(`stop ${String(stop)}: ${String(legacy)} legacy; problems [${problems.join("; ")}]`);
  await fs.rm(root, { recursive: true, force: true });
}
rows
=> [
  "stop 1: 5 legacy; problems []",
  "stop 2: 4 legacy; problems []",
  "stop 3: 4 legacy; problems []",
  "stop 4: 3 legacy; problems []",
  "stop 5: 2 legacy; problems []",
  "stop 6: 2 legacy; problems []",
  "stop 7: 2 legacy; problems []",
  "stop 8: 1 legacy; problems []",
  "stop 9: 1 legacy; problems []",
  "stop 10: 0 legacy; problems []",
]
```

## A current generation marker does not hide the new name

The generation cache keys on input mtimes and the engine version, not on the
migration manifest. The migration removes the marker, so the next
`generateDocs` regenerates the agent guide and course skill with `AGENTS.md`
wording.

```ts
const root = await fixture();
await generateDocs(root);
const guide = () => fs.readFile(path.join(root, ".beebox/agent-guide.md"), "utf8");
const skill = () => fs.readFile(path.join(root, ".claude/skills/build-course/SKILL.md"), "utf8");
const before = { current: await generatedDocsAreCurrent(root), guide: (await guide()).includes("own `CLAUDE.md`"), skill: (await skill()).includes("editable `CLAUDE.md`") };
await runAgentsMd({ boxRoot: root, mode: "apply" });
await fs.appendFile(path.join(root, "_config/migrations.jsonl"), `${JSON.stringify({ name: "agents-md-2026-10", "applied-at": "2026-10-09T00:00:00.000Z" })}\n`);
const stale = await generatedDocsAreCurrent(root);
await generateDocs(root);
({ before, stale, guide: (await guide()).includes("own `AGENTS.md`"), skill: (await skill()).includes("editable `AGENTS.md`"), legacy: (await skill()).includes("CLAUDE.md") })
=> { before: { current: true, guide: true, skill: true }, stale: false, guide: true, skill: true, legacy: false }
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true });
```

```ts teardown
await template.cleanup();
```
