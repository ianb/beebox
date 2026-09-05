# `bbx validate --pre-commit`: the whole commit-time suite in one process

`runPreCommitChecks` is what the per-box pre-commit hook invokes. It replaced
three separate `bbx` calls, each of which paid the full CLI startup floor for a
fraction of a second of work — see `docs/plans/commit-performance.md`.

Blocking findings (staged card/markdown validation, the unlisted-binary guard)
go to stdout and set the exit code; the box-wide link scan is warn-only on
stderr and never does.

```ts setup
import { execSync } from "node:child_process";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { runPreCommitChecks } from "../../../src/cli/commands/validate-pre-commit.js";

const stage = (box) => { execSync("git add -A", { cwd: box.root }); };
```

## A staged card that fails validation blocks

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/notes/Plan.memo.card", "---\nstatus: not-a-real-status\n---\nBody text\n");
stage(box);

const outcome = await runPreCommitChecks(box.root, { colors: false });
[outcome.errorCount > 0, outcome.report.includes("Plan.memo.card")]
=> [
  true,
  true
]
```

A clean staged commit passes, and says nothing at all — the hook runs on every
single commit, so "No staged cards or markdown to validate" would be noise on
every one of them:

```ts continue
await box.write("_content/notes/Plan.memo.card", "---\nstatus: new\ncreated: 2026-08-19T10:00:00Z\n---\nBody text\n");
stage(box);

const clean = await runPreCommitChecks(box.root, { colors: false });
[clean.errorCount, clean.report, clean.linkWarnings]
=> [
  0,
  "",
  null
]
```

Schemas stranded in the legacy `_config/schemas/` location block here too — the
same gate every other validate scope applies (`checkLegacySchemaPath` in
`validate.ts`), since the hook is the surface most likely to catch a misplaced
schema before anything else loads the box:

```ts continue
await box.write("_config/schemas/memo.ts", "export {};\n");
const legacy = await runPreCommitChecks(box.root, { colors: false });
[legacy.errorCount, legacy.report.includes("legacy location")]
=> [
  1,
  true
]
```

```ts cleanup
await box.cleanup();
```

## The box-wide link scan runs only on a staged delete or rename

Only a delete or rename can make a link in an *unstaged referrer* newly dangle;
an added or modified file can break only its own links, which the staged pass
already checks. So a dangling link that already exists in the box is not
re-warned on every unrelated commit.

Here `notes.md` links to `target.md`, and both are committed and clean:

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/docs/target.md", "# Target\n");
await box.write("_content/docs/notes.md", "See [target](/_content/docs/target.md).\n");
stage(box);
box.commitAll("seed");

await box.write("_content/notes/Plan.memo.card", "---\nstatus: new\ncreated: 2026-08-19T10:00:00Z\n---\nAn unrelated add.\n");
stage(box);
const added = await runPreCommitChecks(box.root, { colors: false });
[added.errorCount, added.linkWarnings]
=> [
  0,
  null
]
```

Deleting the link target stages a `D`, so the scan runs and reports the now-dangling
link in `notes.md` — which is not staged, and which `--staged` could therefore
never see. It is a warning: the commit is not blocked.

```ts continue
box.commitAll("unrelated");
execSync("git rm -q _content/docs/target.md", { cwd: box.root });

const deleted = await runPreCommitChecks(box.root, { colors: false });
[
  deleted.errorCount,
  deleted.linkWarnings !== null && deleted.linkWarnings.includes("_content/docs/notes.md"),
  deleted.linkWarnings !== null && deleted.linkWarnings.includes("not blocking the commit"),
]
=> [
  0,
  true,
  true
]
```

```ts cleanup
await box.cleanup();
```

## The closed-vocabulary root check (Track C) blocks the commit

`checkBoxRoot` is wired into `--pre-commit` as a blocking error — the check
that would have caught the test1 stray-config incident at commit time, not
just as a `bbx status` warning:

```ts
const strayBox = await makeTmpBox({ git: true });
await strayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\ncreated: 2026-08-19T10:00:00Z\n---\n");
stage(strayBox);

const strayOutcome = await runPreCommitChecks(strayBox.root, { colors: false });
[strayOutcome.errorCount > 0, strayOutcome.report.includes("Box root: recipes"), strayOutcome.report.includes("closed vocabulary")]
=> [
  true,
  true,
  true
]
```

```ts cleanup
await strayBox.cleanup();
```

A box with no root strays stays quiet on this check — a clean commit still
passes with an empty report:

```ts
const cleanRootBox = await makeTmpBox({ git: true });
await cleanRootBox.write("_content/notes/Plan.memo.card", "---\nstatus: new\ncreated: 2026-08-19T10:00:00Z\n---\nBody text\n");
stage(cleanRootBox);

const cleanRootOutcome = await runPreCommitChecks(cleanRootBox.root, { colors: false });
[cleanRootOutcome.errorCount, cleanRootOutcome.report]
=> [
  0,
  ""
]
```

```ts cleanup
await cleanRootBox.cleanup();
```

## A staged oversized binary in an attach scope blocks

The unlisted-binary guard reads the index (`core/annex/staged-unlisted.ts`), so
it fires at exactly the commit that would put the bytes into history:

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/notes/Trip.attach/export.parquet", "x".repeat(1024 * 1024 + 1));

const unstaged = await runPreCommitChecks(box.root, { colors: false });
unstaged.errorCount
=> 0
```

```ts continue
stage(box);
const staged = await runPreCommitChecks(box.root, { colors: false });
[staged.errorCount, staged.report.includes("export.parquet")]
=> [
  1,
  true
]
```

```ts cleanup
await box.cleanup();
```
