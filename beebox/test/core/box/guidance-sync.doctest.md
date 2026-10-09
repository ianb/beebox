# Every guidance surface comes from one registry and one walk

Plan: `docs/implemented-plans/doc-structure-box-guidance.md`, Track 1. `GUIDANCE_SURFACES`
(`src/core/box/guidance-surfaces.ts`) lists every file a box agent reads as
guidance. `syncBoxGuidance` walks it, and both `initBox` and the
`generateDocs` template sync call the walk, so a surface cannot be installed
on one path and missed on the other. Reference: `docs/box-guidance.md`.

These examples call the walk and the generators directly. The full
`generateDocs` would also install a real pre-commit hook that shells out to a
`bbx` binary (see `generate-docs.doctest.md`).

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { syncBoxGuidance } from "../../../src/core/box/guidance-sync/core.js";
import {
  GUIDANCE_SURFACES,
  guidancePathPattern,
  guidanceSurfaceFor,
} from "../../../src/core/box/guidance-surfaces.js";
import { isTemplateManagedPath } from "../../../src/core/install-template-file.js";
import { installValidationHooks } from "../../../src/core/install-validation-hooks.js";
import { generateAgentContextMirrors } from "../../../src/core/agent-context-mirrors.js";
import { ensureInstructionMapInclude } from "../../../src/core/maps/finalize/core.js";
import { compileGuides } from "../../../src/core/docs-gen/compile/core.js";
import { readDocId, withDocId } from "../../../src/core/docs-gen/shared.js";
import { commitTemplateSyncChanges } from "../../../src/core/docs-gen/generate/core.js";
import { execFileSync } from "node:child_process";
import { getStatus } from "../../../src/lib/git/core/operations.js";

const exists = async (root: string, rel: string): Promise<boolean> => {
  try {
    await fs.access(path.join(root, rel));
    return true;
  } catch (_e) {
    return false;
  }
};

/** Every file under `root`, box-relative, skipping git and installed packages. */
async function boxFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)))
    .filter((rel) => !rel.startsWith(".git/") && !rel.startsWith("node_modules/"));
}

/** Each file that carries the generated marker, with the path its marker names. */
async function markedFiles(root: string, files: string[]): Promise<Array<{ rel: string; id: string }>> {
  const out: Array<{ rel: string; id: string }> = [];
  for (const rel of files) {
    const id = readDocId(await fs.readFile(path.join(root, rel), "utf8"));
    if (id !== null) out.push({ rel, id });
  }
  return out;
}

async function plant(root: string, file: { rel: string; content: string }): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, file.rel)), { recursive: true });
  await fs.writeFile(path.join(root, file.rel), file.content);
}

/** The subject and file list of the box's last commit. */
const lastCommit = (root: string): string =>
  execFileSync("git", ["show", "--name-only", "--format=%s", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const linkState = async (root: string, rel: string): Promise<string> =>
  fs.lstat(path.join(root, rel)).then(() => "present", () => "absent");

/** `path|tier|class|git` for each row of the table in `docs/box-guidance.md`. */
async function documentedRows(): Promise<string[]> {
  const doc = await fs.readFile(path.join(import.meta.dirname, "../../../docs/box-guidance.md"), "utf8");
  return doc.split("\n")
    .map((line) => /^\| `([^`]+)` \| ([a-z-]+) \| ([a-z]+) \| .+ \| (yes|no) \|$/.exec(line))
    .filter((m) => m !== null)
    .map((m) => `${m[1]}|${m[2]}|${m[3]}|${m[4]}`);
}

/** A concrete path for a registry row: placeholders become `example`, `**` + `/` becomes nothing. */
const samplePath = (rowPath: string): string =>
  rowPath.replaceAll("**/", "").replaceAll(/<[a-z]+>/g, "example");
```

## After the walk, every row the walk installs is on disk

`makeTmpBox` scaffolds through `initBox`, which runs the walk without its
generators; `bbx init` reaches them through `generateDocs` right after. Rows
installed by another owner (a later `generateDocs` phase, the refresh-maps
procedure, the package build) are not the walk's; the registry names their
owner. Instruction rows name `AGENTS.md`; this box is not converted, so its
guides are the legacy `CLAUDE.md` files, which `guidanceSurfaceFor` maps to the
same rows.

```ts
const box = await makeTmpBox({ git: "none" });
const missing = (files: string[], rows: typeof GUIDANCE_SURFACES): string[] =>
  rows.filter((row) => !files.some((f) => guidancePathPattern(row.path).test(f) || guidanceSurfaceFor(f) === row)).map((row) => row.path);
const fromTemplates = GUIDANCE_SURFACES.filter((row) => row.install.via === "tracker" || row.install.via === "seed");
missing(await boxFiles(box.root), fromTemplates)
=> []

await syncBoxGuidance(box.root, { generators: true });
const files = await boxFiles(box.root);
missing(files, GUIDANCE_SURFACES.filter((row) => row.install.via !== "owner"))
=> []
```

Every file that carries the generated marker names its own path and matches a
registry row, so nothing generated exists outside the registry:

```ts continue
const marked = await markedFiles(box.root, files);
marked.length > 0
=> true

marked.filter((m) => guidanceSurfaceFor(m.rel) === undefined).map((m) => m.rel)
=> []

marked.filter((m) => m.id !== m.rel).map((m) => m.rel)
=> []
```

The marker goes after YAML frontmatter, which Claude Code parses only at the
top of a rule or skill:

```ts continue
const rule = await fs.readFile(path.join(box.root, ".claude/rules/card-memo.md"), "utf8");
rule.split("\n").slice(0, 5).join("\n")
=> ---
paths:
  - "**/*.memo.card"
---
<!-- DOCID:.claude/rules/card-memo.md; GENERATED by beebox, edits are overwritten -->

const skill = await fs.readFile(path.join(box.root, ".claude/skills/views/SKILL.md"), "utf8");
skill.startsWith("---\nname: views\n")
=> true

readDocId(skill)
=> .claude/skills/views/SKILL.md
```

## A box without a tracked guide gains it from the walk

An old box is simulated by removing two guides and their tracker entries. The
walk writes both back through the template tracker, so each is recorded in
`_config/template-versions.json` and takes future stock updates instead of
parking.

```ts continue
const versionsPath = path.join(box.root, "_config/template-versions.json");
for (const rel of ["src/tricks/scripts/CLAUDE.md", "src/views/CLAUDE.md"]) {
  await fs.rm(path.join(box.root, rel));
}
const seeded = JSON.parse(await fs.readFile(versionsPath, "utf8"));
delete seeded["src/tricks/scripts/CLAUDE.md"];
delete seeded["src/views/CLAUDE.md"];
await fs.writeFile(versionsPath, JSON.stringify(seeded, null, 2) + "\n");

await syncBoxGuidance(box.root, { generators: true });

await exists(box.root, "src/tricks/scripts/CLAUDE.md") && await exists(box.root, "src/views/CLAUDE.md")
=> true

const versions = JSON.parse(await fs.readFile(versionsPath, "utf8"));
["src/tricks/scripts/CLAUDE.md", "src/views/CLAUDE.md"].every((k) => typeof versions[k]?.sha256 === "string")
=> true
```

```ts cleanup
await box.cleanup();
```

## The sync commit's managed paths are derived from the registry

A git-tracked `tracked` or `generated` row is a managed path, so the sync
commit sweeps it. An `owned` row, a `package` row, or a gitignored row is not.
The one exception is the root `AGENTS.md`: the `**/AGENTS.md` mirror row also
matches it, because in a box not yet converted it is the generated symlink to
the root `CLAUDE.md`. The sync commit keeps whatever was dirty before it ran, so
this sweeps only the engine's own include edits.

```ts
GUIDANCE_SURFACES
  .filter((row) => isTemplateManagedPath(samplePath(row.path)) !== (row.gitTracked && (row.class === "tracked" || row.class === "generated")))
  .map((row) => row.path)
=> ["AGENTS.md"]

isTemplateManagedPath("src/views/AGENTS.md") && isTemplateManagedPath("nested/dir/AGENTS.md")
=> true

isTemplateManagedPath("CLAUDE.md") || isTemplateManagedPath("_content/MAP.md")
=> false
```

The four tracked guides keep their legacy `CLAUDE.md` paths as managed paths,
so a box not yet converted still commits a guide the sync updates. Other
`CLAUDE.md` files stay the box's own:

```ts
["src/schemas/CLAUDE.md", "src/views/CLAUDE.md", "src/tricks/scripts/CLAUDE.md", "_config/feedback/CLAUDE.md", "_content/notes/CLAUDE.md"]
  .map(isTemplateManagedPath)
=> [true, true, true, true, false]
```

## The reference table matches the registry

`docs/box-guidance.md` restates the registry as a table; this keeps the two
equal, row for row and in order.

```ts
const registryRows = GUIDANCE_SURFACES.map((row) => `${row.path}|${row.tier}|${row.class}|${row.gitTracked ? "yes" : "no"}`);
JSON.stringify(await documentedRows()) === JSON.stringify(registryRows)
=> true
```

## Generators prune marked orphans and engine-owned name families; other unmarked files survive

Plant, beside the managed files: a marked rule from a retired family, a marked
retired skill, a marked file a managed skill no longer ships, a boxholder's
own rule and skill (no marker), and a copy of a generated rule under a new
name (its marker names the original path, so it is not an orphan of its own).

```ts
const box = await makeTmpBox({ git: "none" });
await syncBoxGuidance(box.root, { generators: true });
await plant(box.root, { rel: ".claude/rules/retired-family.md", content: withDocId({ relativePath: ".claude/rules/retired-family.md", content: "old\n" }) });
await plant(box.root, { rel: ".claude/rules/card-retiredtype.md", content: "a card rule from before the marker\n" });
await plant(box.root, { rel: ".claude/skills/retired-skill/SKILL.md", content: withDocId({ relativePath: ".claude/skills/retired-skill/SKILL.md", content: "---\nname: retired-skill\n---\nold\n" }) });
await plant(box.root, { rel: ".claude/skills/views/old-notes.md", content: withDocId({ relativePath: ".claude/skills/views/old-notes.md", content: "old\n" }) });
await plant(box.root, { rel: ".claude/rules/hand-written.md", content: "a boxholder's own rule\n" });
await plant(box.root, { rel: ".claude/skills/my-skill/SKILL.md", content: "---\nname: my-skill\n---\nmine\n" });
await plant(box.root, { rel: ".claude/rules/my-memo.md", content: await box.read(".claude/rules/card-memo.md") });

await syncBoxGuidance(box.root, { generators: true });

const gone = [".claude/rules/retired-family.md", ".claude/rules/card-retiredtype.md", ".claude/skills/retired-skill", ".claude/skills/views/old-notes.md"];
const kept = [".claude/rules/hand-written.md", ".claude/skills/my-skill/SKILL.md", ".claude/rules/my-memo.md", ".claude/rules/card-memo.md", ".claude/skills/views/SKILL.md"];
JSON.stringify({
  gone: (await Promise.all(gone.map((rel) => exists(box.root, rel)))).every((e) => !e),
  kept: (await Promise.all(kept.map((rel) => exists(box.root, rel)))).every(Boolean),
})
=> {"gone":true,"kept":true}
```

The Codex mirror of a retired managed skill is a symlink with no first line to
mark, so a dangling one is the orphan. A link that points anywhere else stays.

```ts continue
await fs.mkdir(path.join(box.root, ".agents/skills"), { recursive: true });
await fs.symlink("../../.claude/skills/retired-skill", path.join(box.root, ".agents/skills/retired-skill"));
await fs.symlink("../../elsewhere", path.join(box.root, ".agents/skills/not-ours"));
await generateAgentContextMirrors(box.root);

JSON.stringify({
  retired: await linkState(box.root, ".agents/skills/retired-skill"),
  notOurs: await linkState(box.root, ".agents/skills/not-ours"),
  views: await linkState(box.root, ".agents/skills/views"),
})
=> {"retired":"absent","notOurs":"present","views":"present"}
```

A `CLAUDE.md` that was removed leaves its `AGENTS.md` mirror dangling; the
mirror step removes the link. A file named `AGENTS.md` that is not a symlink is
not a mirror and stays.

```ts continue
await fs.mkdir(path.join(box.root, "_content/retired"), { recursive: true });
await fs.symlink("CLAUDE.md", path.join(box.root, "_content/retired/AGENTS.md"));
await fs.mkdir(path.join(box.root, "_content/hand"), { recursive: true });
await fs.writeFile(path.join(box.root, "_content/hand/AGENTS.md"), "hand-written\n");
await generateAgentContextMirrors(box.root);

JSON.stringify({
  dangling: await linkState(box.root, "_content/retired/AGENTS.md"),
  hand: await linkState(box.root, "_content/hand/AGENTS.md"),
})
=> {"dangling":"absent","hand":"present"}
```

The Codex render of a rule carries its own marker, not the rule's:

```ts continue
readDocId(await box.read(".agents/skills/beebox-rule-card-memo/SKILL.md"))
=> .agents/skills/beebox-rule-card-memo/SKILL.md
```

```ts cleanup
await box.cleanup();
```

## The sync commit sweeps what the walk restores

A git box whose history lacks a tracked guide and the card rules (committed
without them, the way a box initialized before they existed would be) gets
both from the walk, and the sync commit picks them up without touching
unrelated work.

```ts
const box = await makeTmpBox({ git: true, deps: true });
await fs.rm(path.join(box.root, "src/views/CLAUDE.md"));
execFileSync("git", ["commit", "-q", "-am", "an older box"], { cwd: box.root });
await box.write("notes.md", "work in progress\n");

await syncBoxGuidance(box.root, { generators: true });
await commitTemplateSyncChanges(box.root);

const status = await getStatus(box.root);
JSON.stringify({ modified: status.modified, untracked: status.untracked })
=> {"modified":[],"untracked":["notes.md"]}

JSON.stringify(lastCommit(box.root).split("\n").filter((line) => line.startsWith("Sync") || line === "src/views/CLAUDE.md" || line === ".claude/rules/card-memo.md"))
=> ["Sync templates from upstream",".claude/rules/card-memo.md","src/views/CLAUDE.md"]
```

```ts cleanup
await box.cleanup();
```

## The retired `cb-validate-ignore.md` rule is pruned

The validate-ignore rule's installer removes the spelling from before the CLI
rename, and leaves a boxholder's own rule alone.

```ts
const box = await makeTmpBox({ git: "none" });
await fs.mkdir(path.join(box.root, ".claude/rules"), { recursive: true });
await fs.writeFile(path.join(box.root, ".claude/rules/cb-validate-ignore.md"), "retired\n");
await fs.writeFile(path.join(box.root, ".claude/rules/hand-written.md"), "a boxholder's own rule\n");

const changed = await installValidationHooks(box.root);
changed.includes(".claude/rules/cb-validate-ignore.md")
=> true

JSON.stringify({
  retired: await exists(box.root, ".claude/rules/cb-validate-ignore.md"),
  current: await exists(box.root, ".claude/rules/bbx-validate-ignore.md"),
  handWritten: await exists(box.root, ".claude/rules/hand-written.md"),
})
=> {"retired":false,"current":true,"handWritten":true}
```

## The maps finalizer leaves tracked guides alone

`ensureInstructionMapInclude` plants the map include line in a directory's
`CLAUDE.md`. Where that file is a tracked guide, the include would make it
differ from stock and park every later rewrite, so the finalizer skips the
directory and strips an include an earlier run prepended. The sync strips the
same stray line before the tracker compares.

```ts continue
const stock = await box.read("src/views/CLAUDE.md");
await ensureInstructionMapInclude(box.root, "src/views");
(await box.read("src/views/CLAUDE.md")) === stock
=> true

await box.write("src/views/CLAUDE.md", "@MAP.md\n\n" + stock);
await ensureInstructionMapInclude(box.root, "src/views");
(await box.read("src/views/CLAUDE.md")) === stock
=> true

await box.write("src/views/CLAUDE.md", "@MAP.md\n\n" + stock);
await syncBoxGuidance(box.root, { generators: false });
(await box.read("src/views/CLAUDE.md")) === stock
=> true

await fs.mkdir(path.join(box.root, "_content/mapped"), { recursive: true });
await ensureInstructionMapInclude(box.root, "_content/mapped");
(await box.read("_content/mapped/CLAUDE.md")).trim()
=> @MAP.md
```

## Guide-derived rules prune their marked orphans

`compileGuides` writes `guides-for-<type>.md` for each job type a guide card
names. A marked rule from a job type no guide names any more is removed; an
unmarked file in the family is not the engine's and stays.

```ts continue
await plant(box.root, { rel: ".claude/rules/guides-for-gone-job.md", content: withDocId({ relativePath: ".claude/rules/guides-for-gone-job.md", content: "---\npaths:\n  - \"**/*.gone-job.card\"\n---\nold\n" }) });
await plant(box.root, { rel: ".claude/rules/guides-for-hand.md", content: "a boxholder's own rule\n" });
await compileGuides(box.root);

JSON.stringify({
  gone: await exists(box.root, ".claude/rules/guides-for-gone-job.md"),
  hand: await exists(box.root, ".claude/rules/guides-for-hand.md"),
})
=> {"gone":false,"hand":true}
```

```ts cleanup
await box.cleanup();
```
