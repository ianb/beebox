# Migration: box-packageify (legacy → v2 package layout)

`scripts/migrate/box-packageify.ts` converts a legacy (shapeVersion 1) box
in place into the v2 package layout (`docs/implemented-plans/boxes-as-packages-v2.md`,
Track H): code dirs move to `src/`, everything else moves to `content/`,
and the whole conversion lands as ONE commit — the one migration where
"halfway" is unsafe, not just incomplete. `runBoxPackageify(boxRoot)` is
the entry point this doctest drives directly (same function `cb migrate`
and the smoke-test script call). `relocateClaudeProjectDir`'s own behavior
(the `~/.claude/projects` continuity piece) is covered separately in
`migrate-box-packageify-memory.doctest.md`.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { simpleGit } from "simple-git";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { runBoxPackageify, throwInjectedTestFailure } from "../../../scripts/migrate/box-packageify.js";
import { getBoxShape } from "../../../src/lib/box-shape.js";
import { getHead, getStatus } from "../../../src/lib/git.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { encodeProjectDir } from "../../../src/cli/lib/session.js";

// `claudeProjectsRoot()` (src/cli/lib/session.ts) honors this override —
// (via `runInit` → `symlinkClaudeMemory`) the migration's own `cb init`
// tail reads it, so this doctest never touches the real ~/.claude/projects.
process.env.CB_CLAUDE_PROJECTS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cb-claude-projects-"));

// The migration's `cb init` tail regenerates `.git/hooks/pre-commit`, and
// its own final commit (and generateDocs' internal template-sync commit)
// then runs that hook for real. `resolveCbBin` (install-validation-hooks.ts)
// would otherwise stamp the MAIN checkout's `cb` — this worktree's v2
// package-layout support doesn't exist there yet mid-plan, which makes the
// hook misbehave against a v2 box for reasons that have nothing to do with
// this migration. `CB_HOOK_BIN` pins it to the checkout actually running
// this doctest instead.
process.env.CB_HOOK_BIN = path.join(PACKAGE_ROOT, "bin/cb");

async function exists(p) {
  try { await fs.access(p); return true; }
  catch (_e) { return false; }
}

// A synthetic legacy box: a few cards, a view, a schema (with its own stub
// package.json, matching real boxes), a trick (with its own nested
// package.json — this one is KEPT, unlike the schema stub), connector
// config, and a `.claude/` dir with a memory stub — mirrors what real boxes
// (e.g. ~/src/boxes/test1) actually carry.
async function makeLegacyBox() {
  const box = await makeTmpBox({ git: true });
  await box.write(".cb-box", JSON.stringify({ version: "1.0.0", created: "2026-01-01T00:00:00.000Z" }));
  await box.write("CLAUDE.md", "# Test Box\n\nBoxholder-specific notes.\n");
  await box.write("briefing.briefing.card", "---\nstatus: active\n---\nBriefing body.\n");
  await box.write("briefing.md", "Briefing prose.\n");
  await box.write("box/inbox/Note.memo.card", "---\nstatus: new\ncreated: 2026-01-01T00:00:00.000Z\n---\nA memo.\n");
  await box.write("store/archive/Old.memo.card", "---\nstatus: processed\ncreated: 2026-01-01T00:00:00.000Z\n---\nOld memo.\n");
  await box.write("config/main.personality.card", "---\nname: Box\n---\nPersonality.\n");
  await box.write("config/connectors/rss.json", JSON.stringify({ feeds: [] }, null, 2) + "\n");
  await box.write("config/schemas/package.json", JSON.stringify({ name: "box-schemas", private: true }) + "\n");
  await box.write("config/schemas/widget.ts", "export const widget = 1;\n");
  await box.write("views/Widget.tsx", "export const meta = {};\n");
  await box.write("tricks/package.json", JSON.stringify({ name: "box-tricks", private: true, dependencies: {} }) + "\n");
  await box.write("tricks/do-thing.ts", "export default function doThing() {}\n");
  await box.write("people/Priya.person.card", "---\nname: Priya\n---\nNotes.\n");
  await box.write(".claude/settings.json", JSON.stringify({ hooks: {} }, null, 2) + "\n");
  await box.write(".claude/memory/note.md", "Remembered fact.\n");
  await box.write(".gitignore", "tmp/\n.callback-box/\n");
  box.commitAll("seed legacy box fixture");
  return box;
}
```

## Converting a legacy box moves code to `src/`, everything else to `content/`, in one commit

```ts
const box = await makeLegacyBox();
const preSha = await getHead(box.root);

// Real pre-existing Claude Code session history at the box's old cwd key —
// checked below to prove a successful migration never loses it, whichever
// way `relocateClaudeProjectDir` resolves it (see
// migrate-box-packageify-memory.doctest.md for that decision in isolation).
const oldProjectKeyDir = path.join(process.env.CB_CLAUDE_PROJECTS_DIR, encodeProjectDir(box.root));
await fs.mkdir(oldProjectKeyDir, { recursive: true });
await fs.writeFile(path.join(oldProjectKeyDir, "session-1.jsonl"), "{}\n");

const result = await runBoxPackageify(box.root);
result.status
=> applied
```

Session history is never silently lost — it's either moved to the new key, or (the common case: `cb init`'s own tail already created something at the new key first) left in place at the old key untouched:

```ts continue
const contentProjectKeyDir = path.join(process.env.CB_CLAUDE_PROJECTS_DIR, encodeProjectDir(box.path("content")));
const sessionAtOldKey = await exists(path.join(oldProjectKeyDir, "session-1.jsonl"));
const sessionAtNewKey = await exists(path.join(contentProjectKeyDir, "session-1.jsonl"));
sessionAtOldKey || sessionAtNewKey
=> true
```

```ts continue
const shape = await getBoxShape(box.path("content"));
shape.shapeVersion
=> 2
```

```ts continue
const checks = {
  contentMarker: await exists(box.path("content/.cb-box")),
  contentClaudeMd: await exists(box.path("content/CLAUDE.md")),
  contentBriefing: await exists(box.path("content/briefing.briefing.card")),
  contentCard: await exists(box.path("content/box/inbox/Note.memo.card")),
  contentStore: await exists(box.path("content/store/archive/Old.memo.card")),
  contentConfig: await exists(box.path("content/config/main.personality.card")),
  contentConnector: await exists(box.path("content/config/connectors/rss.json")),
  contentPeople: await exists(box.path("content/people/Priya.person.card")),
  contentGitignore: await exists(box.path("content/.gitignore")),
  srcSchema: await exists(box.path("src/schemas/widget.ts")),
  srcView: await exists(box.path("src/views/Widget.tsx")),
  srcTrick: await exists(box.path("src/tricks/do-thing.ts")),
  srcTrickPackageJson: await exists(box.path("src/tricks/package.json")),
  schemaStubDroppedFromContent: !(await exists(box.path("content/config/schemas/package.json"))),
  schemaStubDroppedFromSrc: !(await exists(box.path("src/schemas/package.json"))),
  claudeStaysAtPackageRoot: await exists(box.path(".claude/settings.json")),
  rootPackageJson: await exists(box.path("package.json")),
  rootTsconfig: await exists(box.path("tsconfig.json")),
};
const failedChecks = Object.keys(checks).filter(function (k) { return !checks[k]; });
failedChecks.length
=> 0
```

Git history follows the moved card across the rename:

```ts continue
const followLogOutput = await simpleGit(box.root).raw(["log", "--follow", "--oneline", "--", "content/box/inbox/Note.memo.card"]);
const followedCommitCount = followLogOutput.split("\n").filter(Boolean).length;
followedCommitCount >= 2
=> true
```

The regenerated pre-commit hook `cd`s into `content/` (the v2 layout's git-root/box-root split — see `install-validation-hooks.ts`):

```ts continue
const preCommitHook = await fs.readFile(box.path(".git/hooks/pre-commit"), "utf-8");
preCommitHook.includes('cd "content"')
=> true
```

```ts cleanup
await box.cleanup();
```

## A legacy box whose own data dir is already named `content/` converts cleanly

The generic top-level mover computes `<box>/content/<entry>` for every
entry it relocates — for an entry literally named `content`, that's
`<box>/content/content`, i.e. renaming the directory onto a path nested
inside itself, which fails outright. `moveEverythingElseToContent` special-
cases this by shuffling the legacy `content/` dir through a temp name
first, so its cards end up at `content/content/` (one level deeper, same
as any other legacy dir) instead of breaking the whole conversion.

```ts
const box = await makeTmpBox({ git: true });
await box.write(".cb-box", JSON.stringify({ version: "1.0.0", created: "2026-01-01T00:00:00.000Z" }));
await box.write("CLAUDE.md", "# Test Box\n\nBoxholder-specific notes.\n");
await box.write("content/Note.memo.card", "---\nstatus: new\ncreated: 2026-01-01T00:00:00.000Z\n---\nA memo.\n");
await box.write("content/nested/Other.memo.card", "---\nstatus: new\ncreated: 2026-01-01T00:00:00.000Z\n---\nAnother memo.\n");
box.commitAll("seed legacy box with its own top-level content/ dir");

const result = await runBoxPackageify(box.root);
result.status
=> applied
```

The legacy `content/`'s own cards now live under `content/content/`, and the top-level `content/` is the new v2 root (holding the relocated `.cb-box`, `CLAUDE.md`, etc.), exactly as for any other legacy top-level dir:

```ts continue
const checks = {
  cardNestedOneLevelDeeper: await exists(box.path("content/content/Note.memo.card")),
  nestedSubdirPreserved: await exists(box.path("content/content/nested/Other.memo.card")),
  v2MarkerAtNewRoot: await exists(box.path("content/.cb-box")),
  v2ClaudeMdAtNewRoot: await exists(box.path("content/CLAUDE.md")),
  oldFlatCardGone: !(await exists(box.path("content/Note.memo.card"))),
};
Object.keys(checks).filter(function (k) { return !checks[k]; }).length
=> 0
```

History follows the card across both the outer `content/` shuffle and the move into `content/content/`:

```ts continue
const followLog = await simpleGit(box.root).raw(["log", "--follow", "--oneline", "--", "content/content/Note.memo.card"]);
followLog.split("\n").filter(Boolean).length >= 2
=> true
```

```ts cleanup
await box.cleanup();
```

## Running it again on an already-converted box is a no-op

```ts
const box = await makeLegacyBox();
await runBoxPackageify(box.root);
const second = await runBoxPackageify(box.root);
second.status
=> already-migrated
```

```ts cleanup
await box.cleanup();
```

## A mid-transform failure restores the box to its pre-migration state, byte for byte

Everything through `scaffoldPackageRoot` (code/content moves, the marker
stamp, the package.json/tsconfig/CLAUDE.md/.gitignore scaffold) succeeds
first — the injected failure fires right after that, before `cb init`'s
tail — a genuine mid-transform failure, not a precondition check,
exercising the same `revertToSnapshot` path a real `pnpm`/`cb init` crash
would hit. `injectFailureAfterScaffold` is a test-only seam (mirrors `cb
upgrade`'s `CommandRunner` injection point) — see its doc comment in
`box-packageify.ts` for why this doctest doesn't use a
filesystem-permission trick (chmod-ing a directory mid-run turned out to
interact badly with the test runner's own instrumentation).

`relocateClaudeProjectDir` (the `~/.claude/projects` session-continuity
step, covered on its own in `migrate-box-packageify-memory.doctest.md`)
runs AFTER the final commit, not here — a failure this early in the
transform must never touch it, since that untracked filesystem state can't
be undone by `revertToSnapshot` the way the box's own git-tracked content
can.

```ts
const box = await makeLegacyBox();
const preSha = await getHead(box.root);
// `.git/...` internals (e.g. `ORIG_HEAD`, written by `git reset --hard`
// itself) are bookkeeping, not box content — excluded from the "byte
// identical" comparison below, same as `node_modules/` (see next).
const trackedList = (await box.list()).split("\n").filter(function (p) { return !p.startsWith(".git"); });

// Real pre-existing Claude Code session history at the box's old cwd key —
// proves below that a failure this early never touches it (relocation
// only runs after a successful commit).
const oldProjectKeyDir = path.join(process.env.CB_CLAUDE_PROJECTS_DIR, encodeProjectDir(box.root));
await fs.mkdir(oldProjectKeyDir, { recursive: true });
await fs.writeFile(path.join(oldProjectKeyDir, "session-1.jsonl"), "{}\n");

const failAfterScaffold = { injectFailureAfterScaffold: throwInjectedTestFailure };
let threw = false;
try {
  await runBoxPackageify(box.root, failAfterScaffold);
} catch (_e) {
  threw = true;
}
const injectedFailureCaught = threw;
injectedFailureCaught
=> true
```

Session history at the old key is completely untouched — no relocation was even attempted:

```ts continue
const contentProjectKeyDir = path.join(process.env.CB_CLAUDE_PROJECTS_DIR, encodeProjectDir(box.path("content")));
const sessionUntouched = await exists(path.join(oldProjectKeyDir, "session-1.jsonl"));
const noContentKeyCreated = !(await exists(contentProjectKeyDir));
sessionUntouched && noContentKeyCreated
=> true
```

The box is back to its exact pre-migration shape — same HEAD, same tracked-file list, nothing left half-moved. The one documented exception (same as `cb upgrade`'s revert path): `node_modules/` is gitignored, so `git clean -fd` correctly spares it, leaving `scaffoldPackageRoot`'s symlink behind as inert orphan debris — harmless (a later legacy-shaped `cb init`/`cb serve` on this box never looks at it), but not literally byte-identical on disk, which is why the working-tree cleanliness check (`getStatus`, which only reports tracked/untracked-and-unignored paths) is the real guarantee here, not a raw directory dump:

```ts continue
const postSha = await getHead(box.root);
const postTrackedList = (await box.list()).split("\n").filter(function (p) { return !p.startsWith(".git") && p !== "node_modules" && !p.startsWith("node_modules/"); });
const postStatus = await getStatus(box.root);
const revertOk = {
  sameHead: postSha === preSha,
  sameTrackedFiles: postTrackedList.join(",") === trackedList.join(","),
  workingTreeClean: postStatus.clean,
  contentGone: !(await exists(box.path("content"))),
  srcGone: !(await exists(box.path("src"))),
};
Object.keys(revertOk).filter(function (k) { return !revertOk[k]; }).length
=> 0
```

```ts cleanup
await box.cleanup();
```

## Preflight refuses a box with pre-existing validation errors — before touching anything

The conversion's final commit runs the box's own pre-commit validate hook, so
broken cards would otherwise fail the migration at the very last step (after
all the work, forcing a revert). The preflight runs the same validation up
front: the box is refused in seconds, completely untouched, with the file
list in the error. Policy: fix the cards; the hook is never bypassed.

```ts
const badBox = await makeLegacyBox();
await badBox.write("config/schedules/broken.scheduled-script.card", "---\ncron: 0 6 * * *\n---\n");
badBox.commitAll("add a broken schedule card (missing runs:)");
const headBefore = await getHead(badBox.root);

let preflightErr = null;
try {
  await runBoxPackageify(badBox.root);
} catch (e) {
  preflightErr = e;
}
const preflightErrName = preflightErr === null ? "(no error)" : preflightErr.name;
preflightErrName
=> PreexistingValidationError

preflightErr.message.includes("broken.scheduled-script.card")
=> true

(await getHead(badBox.root)) === headBefore
=> true

(await getStatus(badBox.root)).clean
=> true

JSON.parse(await fs.readFile(path.join(badBox.root, ".cb-box"), "utf-8")).shapeVersion ?? 1
=> 1
```
