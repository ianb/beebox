# The exhibits CLI (bin/exhibits)

`bin/exhibits` is the agent-facing surface of the exhibit medium
(`docs/plans/workstream-exhibits.md` Track D): it creates an exhibit directory
in the store, writes a manifest the app's Zod schemas accept, and prints one
line — the URL — on stdout so it is pasteable into chat.

These tests point `BBX_EXHIBITS_ROOT` and `BBX_STATE_DIR` at a temp
root and drive the CLI from a temp git checkout, so nothing touches the real
store or the developer's worktrees.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const cli = join(repoRoot, "bin/exhibits");

const root = await mkdtemp(join(tmpdir(), "exhibits-cli-doctest-"));
const store = join(root, "workstream-exhibits");
const state = join(root, "state");
const mono = join(root, "beebox");
const worktrees = join(root, "beebox-worktrees");
const worktree = join(worktrees, "demo");

await mkdir(join(mono, "beebox"), { recursive: true });
await mkdir(worktrees, { recursive: true });
await mkdir(state, { recursive: true });
// The token the supervisor persists; present here so URLs carry ?token=.
await writeFile(join(state, "exhibits-token"), "TOKEN-0123456789abcdef\n");

async function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}
await git(mono, "init", "-b", "main");
await git(mono, "config", "user.email", "test@example.com");
await git(mono, "config", "user.name", "Exhibits CLI Test");
await writeFile(join(mono, "README.md"), "fixture\n");
await git(mono, "add", "README.md");
await git(mono, "commit", "-m", "fixture");
await git(mono, "worktree", "add", "-b", "worktree-demo", worktree, "main");

const env = { ...process.env, BBX_EXHIBITS_ROOT: store, BBX_STATE_DIR: state };

// Returns stdout/stderr/code separately: the one-line-stdout contract is what
// makes `bin/exhibits add` usable inside another command.
async function run(args: string[], cwd = mono) {
  try {
    const r = await execFileAsync(cli, args, { cwd, env });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

// Shared across blocks (each ```ts block has its own scope; setup does not).
const dir = join(store, "demo/dashboard-density-options");
const shot = join(root, "comfortable.png");
const shot2 = join(root, "compact.png");
await writeFile(shot, "png-bytes");
await writeFile(shot2, "png-bytes");
await writeFile(join(root, "notes.md"), "not a figure\n");
await writeFile(join(root, "appendix.markdown"), "second document\n");
```

`add` creates the directory, maps one Markdown input to `doc.md`, copies the
figures, and writes a manifest with labels in argument order. Stdout is exactly
the URL — one line, nothing else; the
`[exhibits]` progress lines go to stderr.

```ts
const added = await run([
  "add",
  "--workstream", "demo",
  "--title", "Dashboard Density Options",
  "--ask", "decide",
  "--prose", "Pick a density; I apply it everywhere and delete the other.",
  "--option", "Comfortable (A1)",
  "--option", "Compact (A2)",
  shot,
  shot2,
  join(root, "notes.md"),
]);
const manifest = JSON.parse(await readFile(join(dir, "exhibit.json"), "utf8"));
JSON.stringify({
  code: added.code,
  stdoutLines: added.stdout.trimEnd().split("\n").length,
  stdout: added.stdout.trim(),
  progressOnStderr: added.stderr.includes("[exhibits]"),
  title: manifest.title,
  ask: manifest.ask,
  figures: manifest.figures,
  createdLooksIso: /^\d{4}-\d{2}-\d{2}T/u.test(manifest.created),
  copied: (await readFile(join(dir, "comfortable.png"), "utf8")) === "png-bytes",
  copiedDocument: (await readFile(join(dir, "doc.md"), "utf8")) === "not a figure\n",
  originalNameAbsent: await lstat(join(dir, "notes.md")).then(() => false, () => true),
  progressNamesDocument: added.stderr.includes("document: true"),
})
=> {"code":0,"stdoutLines":1,"stdout":"http://127.0.0.1:3230/demo/dashboard-density-options/?token=TOKEN-0123456789abcdef","progressOnStderr":true,"title":"Dashboard Density Options","ask":{"type":"decide","prose":"Pick a density; I apply it everywhere and delete the other.","options":["Comfortable (A1)","Compact (A2)"]},"figures":[{"label":"A1","file":"comfortable.png"},{"label":"A2","file":"compact.png"}],"createdLooksIso":true,"copied":true,"copiedDocument":true,"originalNameAbsent":true,"progressNamesDocument":true}
```

The manifest must satisfy the app's own schema, not just look right — the CLI
and the renderer share one contract (`workstreams-app/src/shared/exhibits.ts`).

```ts
const { exhibitManifestSchema } = await import(
  resolve(repoRoot, "workstreams-app/src/shared/exhibits.ts")
);
const written = JSON.parse(await readFile(join(dir, "exhibit.json"), "utf8"));
JSON.stringify({ valid: exhibitManifestSchema.safeParse(written).success })
=> {"valid":true}
```

Refusals, all fail-closed: an existing slug is never overwritten (the message
suggests the `-2` retry), `decide` without at least two options is not a
decision, and `apps` and traversal-shaped names are refused as workstreams.

```ts
const collision = await run([
  "add", "--workstream", "demo", "--title", "Dashboard Density Options",
  "--ask", "fyi", "--prose", "again",
]);
const noOptions = await run([
  "add", "--workstream", "demo", "--title", "Undecided", "--ask", "decide", "--prose", "pick",
]);
const reserved = await run([
  "add", "--workstream", "apps", "--title", "Sneaky", "--ask", "fyi", "--prose", "p",
]);
const traversal = await run([
  "add", "--workstream", "../escape", "--title", "Sneaky", "--ask", "fyi", "--prose", "p",
]);
const multipleDocs = await run([
  "add", "--workstream", "demo", "--title", "Multiple Docs",
  "--ask", "fyi", "--prose", "read these", join(root, "notes.md"), join(root, "appendix.markdown"),
]);
const unknown = await run(["frobnicate"]);
JSON.stringify({
  collision: collision.code !== 0 && collision.stderr.includes("dashboard-density-options-2"),
  collisionKeptOriginal: JSON.parse(await readFile(join(dir, "exhibit.json"), "utf8")).ask.type === "decide",
  noOptions: noOptions.code !== 0 && noOptions.stderr.includes("at least two --option"),
  reserved: reserved.code !== 0 && reserved.stderr.includes("reserved"),
  traversal: traversal.code !== 0 && traversal.stderr.includes("invalid workstream name"),
  multipleDocs: multipleDocs.code !== 0 && multipleDocs.stderr.includes("only one Markdown document"),
  multipleDocsCreatedNothing: await lstat(join(store, "demo/multiple-docs")).then(() => false, () => true),
  unknownCommand: unknown.code === 1 && unknown.stderr.includes("unknown command"),
})
=> {"collision":true,"collisionKeptOriginal":true,"noOptions":true,"reserved":true,"traversal":true,"multipleDocs":true,"multipleDocsCreatedNothing":true,"unknownCommand":true}
```

The workstream defaults from the cwd's checkout: a worktree on branch
`worktree-demo` writes to the `demo` store, and the mount (`<checkout>/exhibits`
→ the store dir) is ensured on the way. The main checkout is `main`.

```ts
const derived = await run(
  ["add", "--title", "Derived", "--ask", "fyi", "--prose", "just showing you"],
  worktree,
);
const fromMain = await run(["add", "--title", "From Main", "--ask", "fyi", "--prose", "fyi"], mono);
JSON.stringify({
  derivedUrl: derived.stdout.trim().endsWith("/demo/derived/?token=TOKEN-0123456789abcdef"),
  derivedInStore: (await lstat(join(store, "demo/derived/exhibit.json"))).isFile(),
  mounted: (await lstat(join(worktree, "exhibits"))).isSymbolicLink(),
  mainUrl: fromMain.stdout.trim().endsWith("/main/from-main/?token=TOKEN-0123456789abcdef"),
  mainInStore: (await lstat(join(store, "main/from-main/exhibit.json"))).isFile(),
})
=> {"derivedUrl":true,"derivedInStore":true,"mounted":true,"mainUrl":true,"mainInStore":true}
```

`url` reprints a stable URL for an existing exhibit and refuses one that isn't
there. `list --json` reports every exhibit; `answered` flips once the renderer
has written `data/disposition.json`, which is how a later agent session finds
the answers waiting for it.

```ts
const url = await run(["url", "demo/derived"]);
const missing = await run(["url", "demo/nope"]);
const before = JSON.parse((await run(["list", "--json", "--workstream", "demo"])).stdout);
await mkdir(join(dir, "data"), { recursive: true });
await writeFile(
  join(dir, "data/disposition.json"),
  JSON.stringify({ askType: "decide", choice: "Compact (A2)", decidedAt: "2026-08-15T12:00:00Z" }),
);
const after = JSON.parse((await run(["list", "--json", "--workstream", "demo"])).stdout);
const table = await run(["list", "--workstream", "demo"]);
JSON.stringify({
  url: url.stdout.trim() === "http://127.0.0.1:3230/demo/derived/?token=TOKEN-0123456789abcdef",
  urlLines: url.stdout.trimEnd().split("\n").length,
  missingRefused: missing.code !== 0 && missing.stderr.includes("no exhibit at"),
  names: before.map((r: { name: string }) => r.name),
  answeredBefore: before.map((r: { answered: boolean }) => r.answered),
  answeredAfter: after.map((r: { answered: boolean }) => r.answered),
  decidedAt: after.find((r: { name: string }) => r.name === "dashboard-density-options").decidedAt,
  tableHasHeader: table.stdout.includes("WORKSTREAM") && table.stdout.includes("answered"),
})
=> {"url":true,"urlLines":1,"missingRefused":true,"names":["dashboard-density-options","derived"],"answeredBefore":[false,false],"answeredAfter":[true,false],"decidedAt":"2026-08-15T12:00:00Z","tableHasHeader":true}
```

`--permanent` is the other tier: a tracked skeleton at `dev/apps/<slug>/` in the
current checkout, whose ask is optional (a durable tool is not a question). Its
URL is the `/apps/<slug>/` one it gets once the branch merges, and the stderr
says so. Committed apps show up in `list` marked permanent, with their runtime
data read from the store's reserved `apps/` namespace.

```ts
const permanent = await run(["add", "--permanent", "--title", "Threshold Tuner"], worktree);
const appDir = join(worktree, "dev/apps/threshold-tuner");
const appManifest = JSON.parse(await readFile(join(appDir, "exhibit.json"), "utf8"));
const listed = JSON.parse((await run(["list", "--json"], mono)).stdout);
// list reads committed apps from the MAIN checkout, so copy it there as a merge would.
await mkdir(join(mono, "dev/apps"), { recursive: true });
await execFileAsync("cp", ["-R", appDir, join(mono, "dev/apps/threshold-tuner")]);
const listedAfterMerge = JSON.parse((await run(["list", "--json"], mono)).stdout);
JSON.stringify({
  url: permanent.stdout.trim() === "http://127.0.0.1:3230/apps/threshold-tuner/?token=TOKEN-0123456789abcdef",
  shipsByMerge: permanent.stderr.includes("merges to main"),
  manifestKeys: Object.keys(appManifest).toSorted(),
  manifestTitle: appManifest.title,
  starterPage: (await readFile(join(appDir, "index.html"), "utf8")).includes("committed app"),
  storeAppsDir: await lstat(join(store, "apps")).then(() => true, () => false),
  beforeMerge: listed.some((r: { name: string }) => r.name === "threshold-tuner"),
  afterMerge: listedAfterMerge.find((r: { name: string }) => r.name === "threshold-tuner"),
})
=> {"url":true,"shipsByMerge":true,"manifestKeys":["created","title"],"manifestTitle":"Threshold Tuner","starterPage":true,"storeAppsDir":false,"beforeMerge":false,"afterMerge":{"workstream":"apps","name":"threshold-tuner","title":"Threshold Tuner","ask":"","answered":false,"permanent":true}}
```

Copied files are renamed to something the app can route to. The server validates
every path segment, so a screenshot straight off a Mac desktop
(`Screen Shot 2026-08-15.png`) would otherwise be a figure whose URL 404s.

```ts
const shot3 = join(root, "Screen Shot 2026-08-15.png");
await writeFile(shot3, "png-bytes");
const shaped = await run([
  "add", "--workstream", "demo", "--title", "Named Files",
  "--ask", "fyi", "--prose", "just showing you", shot3,
]);
const shapedDir = join(store, "demo/named-files");
const shapedManifest = JSON.parse(await readFile(join(shapedDir, "exhibit.json"), "utf8"));
const { exhibitSegmentSchema } = await import(
  resolve(repoRoot, "workstreams-app/src/shared/exhibits.ts")
);
JSON.stringify({
  code: shaped.code,
  figures: shapedManifest.figures,
  onDisk: (await readFile(join(shapedDir, "screen-shot-2026-08-15.png"), "utf8")) === "png-bytes",
  routable: exhibitSegmentSchema.safeParse(shapedManifest.figures[0].file).success,
  saidSo: shaped.stderr.includes("copied Screen Shot 2026-08-15.png as screen-shot-2026-08-15.png"),
})
=> {"code":0,"figures":[{"label":"A1","file":"screen-shot-2026-08-15.png"}],"onDisk":true,"routable":true,"saidSo":true}
```

`answered` means the disposition parses AND is one — the rule the app applies
(`workstreams-app/src/server/exhibits/disposition.ts`). A truncated answer is a
live ask with a stated problem, not a silently closed one.

```ts
await mkdir(join(store, "demo/named-files/data"), { recursive: true });
await writeFile(join(store, "demo/named-files/data/disposition.json"), '{"askType":"fyi","dec');
const rows = JSON.parse((await run(["list", "--json", "--workstream", "demo"])).stdout);
const row = rows.find((r: { name: string }) => r.name === "named-files");
const table = await run(["list", "--workstream", "demo"]);
JSON.stringify({
  answered: row.answered,
  problem: row.problem,
  hasDecidedAt: "decidedAt" in row,
  table: table.stdout.includes("waiting (unreadable answer)"),
})
=> {"answered":false,"problem":"disposition.json is not a readable answer","hasDecidedAt":false,"table":true}
```

The URL always carries a token. The supervisor mints one and reuses whatever it
finds, so the CLI mints it too when the app has never run — a URL without
`?token=` is a URL that 401s, which reads as a broken exhibit.

```ts
const tokenFile = join(state, "exhibits-token");
await rm(tokenFile);
const minted = await run(["url", "demo/derived"]);
const first = (await readFile(tokenFile, "utf8")).trim();
const again = await run(["url", "demo/derived"]);
const mode = (await lstat(tokenFile)).mode & 0o777;
JSON.stringify({
  carriesToken: minted.stdout.trim() === `http://127.0.0.1:3230/demo/derived/?token=${first}`,
  longEnough: first.length >= 16,
  urlSafe: /^[A-Za-z0-9_-]+$/u.test(first),
  mode: mode.toString(8),
  reused: again.stdout.trim() === minted.stdout.trim(),
})
=> {"carriesToken":true,"longEnough":true,"urlSafe":true,"mode":"600","reused":true}
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
