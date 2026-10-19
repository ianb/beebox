// # The exhibits CLI (bin/exhibits)
//
// `bin/exhibits` is the agent-facing surface of the exhibit medium
// (`docs/implemented-plans/workstream-exhibits.md` Track D): it creates an exhibit directory
// in the store, writes a manifest the app's Zod schemas accept, and prints one
// line — the URL — on stdout so it is pasteable into chat.
//
// These tests point `BBX_EXHIBITS_ROOT` and `BBX_STATE_DIR` at a temp
// root and drive the CLI from a temp git checkout, so nothing touches the real
// store or the developer's worktrees.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
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
function execError(e: unknown): { code?: number; stdout?: string; stderr?: string } {
  return typeof e === "object" && e !== null ? e : {};
}

async function run(args: string[], cwd?: string) {
  try {
    const r = await execFileAsync(cli, args, { cwd: cwd ?? mono, env });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const err = execError(e);
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

// `add` creates the directory, maps one Markdown input to `doc.md`, copies the
// figures, and writes a manifest with labels in argument order. Stdout is exactly
// the URL — one line, nothing else; the
// `[exhibits]` progress lines go to stderr.
void test("add creates the directory, maps one Markdown input to doc.md, copies the figu...", async (t) => {
  const added = await run([
    "add",
    "--workstream", "demo",
    "--title", "Dashboard Density Options",
    "--prose", "Two densities, **comfortable** and compact.",
    shot,
    shot2,
    join(root, "notes.md"),
  ]);
  const manifest = JSON.parse(await readFile(join(dir, "exhibit.json"), "utf8"));
  t.check(
    {
      code: added.code,
      stdoutLines: added.stdout.trimEnd().split("\n").length,
      stdout: added.stdout.trim(),
      progressOnStderr: added.stderr.includes("[exhibits]"),
      title: manifest.title,
      prose: manifest.prose,
      hasAsk: "ask" in manifest,
      figures: manifest.figures,
      createdLooksIso: /^\d{4}-\d{2}-\d{2}T/u.test(manifest.created),
      copied: (await readFile(join(dir, "comfortable.png"), "utf8")) === "png-bytes",
      copiedDocument: (await readFile(join(dir, "doc.md"), "utf8")) === "not a figure\n",
      originalNameAbsent: await lstat(join(dir, "notes.md")).then(() => false, () => true),
      progressNamesDocument: added.stderr.includes("document: true"),
    },
    {
    code: 0,
    stdoutLines: 1,
    stdout: "http://127.0.0.1:3230/demo/dashboard-density-options/?token=TOKEN-0123456789abcdef",
    progressOnStderr: true,
    title: "Dashboard Density Options",
    prose: "Two densities, **comfortable** and compact.",
    hasAsk: false,
    figures: [
      {
        label: "A1",
        file: "comfortable.png",
      },
      {
        label: "A2",
        file: "compact.png",
      },
    ],
    createdLooksIso: true,
    copied: true,
    copiedDocument: true,
    originalNameAbsent: true,
    progressNamesDocument: true,
  },
  );
});

// The manifest must satisfy the app's own schema, not just look right — the CLI
// and the renderer share one contract (`workstreams-app/src/shared/exhibits.ts`).
void test("The manifest must satisfy the app's own schema, not just look right — the CLI...", async (t) => {
  const { exhibitManifestSchema } = await import(
    resolve(repoRoot, "workstreams-app/src/shared/exhibits.ts")
  );
  const written = JSON.parse(await readFile(join(dir, "exhibit.json"), "utf8"));
  t.check({ valid: exhibitManifestSchema.safeParse(written).success }, {
    valid: true,
  });
});

// Refusals, all fail-closed: an existing slug is never overwritten (the message
// suggests the `-2` retry), `--ask` and `--option` are refused because exhibits
// carry no ask, `apps` and traversal-shaped names are refused as workstreams, and a
// title whose slug is `coding-feedback` (the CODING_FEEDBACK notes directory) is
// refused.
void test("Refusals, all fail-closed:", async (t) => {
  const collision = await run([
    "add", "--workstream", "demo", "--title", "Dashboard Density Options",
    "--prose", "again",
  ]);
  const askRefused = await run([
    "add", "--workstream", "demo", "--title", "Undecided", "--ask", "decide", "--prose", "pick",
  ]);
  const optionRefused = await run([
    "add", "--workstream", "demo", "--title", "Undecided", "--option", "A",
  ]);
  const reserved = await run([
    "add", "--workstream", "apps", "--title", "Sneaky", "--prose", "p",
  ]);
  const feedbackSlug = await run([
    "add", "--workstream", "demo", "--title", "Coding Feedback", "--prose", "p",
  ]);
  const traversal = await run([
    "add", "--workstream", "../escape", "--title", "Sneaky", "--prose", "p",
  ]);
  const multipleDocs = await run([
    "add", "--workstream", "demo", "--title", "Multiple Docs",
    "--prose", "read these", join(root, "notes.md"), join(root, "appendix.markdown"),
  ]);
  const unknown = await run(["frobnicate"]);
  t.check(
    {
      collision: collision.code !== 0 && collision.stderr.includes("dashboard-density-options-2"),
      collisionKeptOriginal: JSON.parse(await readFile(join(dir, "exhibit.json"), "utf8")).prose === "Two densities, **comfortable** and compact.",
      askRefused: askRefused.code !== 0
        && askRefused.stderr.includes("add: exhibits no longer carry an ask; say what you want in chat (see workstreams-app/docs/exhibits.md)"),
      askRefusedCreatedNothing: await lstat(join(store, "demo/undecided")).then(() => false, () => true),
      optionRefused: optionRefused.code !== 0 && optionRefused.stderr.includes("no longer carry an ask"),
      reserved: reserved.code !== 0 && reserved.stderr.includes("reserved"),
      feedbackSlug: feedbackSlug.code !== 0 && feedbackSlug.stderr.includes("reserved")
        && await lstat(join(store, "demo/coding-feedback")).then(() => false, () => true),
      traversal: traversal.code !== 0 && traversal.stderr.includes("invalid workstream name"),
      multipleDocs: multipleDocs.code !== 0 && multipleDocs.stderr.includes("only one Markdown document"),
      multipleDocsCreatedNothing: await lstat(join(store, "demo/multiple-docs")).then(() => false, () => true),
      unknownCommand: unknown.code === 1 && unknown.stderr.includes("unknown command"),
    },
    {
    collision: true,
    collisionKeptOriginal: true,
    askRefused: true,
    askRefusedCreatedNothing: true,
    optionRefused: true,
    reserved: true,
    feedbackSlug: true,
    traversal: true,
    multipleDocs: true,
    multipleDocsCreatedNothing: true,
    unknownCommand: true,
  },
  );
});

// The workstream defaults from the cwd's checkout: a worktree on branch
// `worktree-demo` writes to the `demo` store, and the mount (`<checkout>/exhibits`
// → the store dir) is ensured on the way. The main checkout is `main`.
void test("The workstream defaults from the cwd's checkout:", async (t) => {
  const derived = await run(
    ["add", "--title", "Derived", "--prose", "just showing you"],
    worktree,
  );
  const fromMain = await run(["add", "--title", "From Main", "--prose", "fyi"], mono);
  t.check(
    {
      derivedUrl: derived.stdout.trim().endsWith("/demo/derived/?token=TOKEN-0123456789abcdef"),
      derivedInStore: (await lstat(join(store, "demo/derived/exhibit.json"))).isFile(),
      mounted: (await lstat(join(worktree, "exhibits"))).isSymbolicLink(),
      mainUrl: fromMain.stdout.trim().endsWith("/main/from-main/?token=TOKEN-0123456789abcdef"),
      mainInStore: (await lstat(join(store, "main/from-main/exhibit.json"))).isFile(),
    },
    {
    derivedUrl: true,
    derivedInStore: true,
    mounted: true,
    mainUrl: true,
    mainInStore: true,
  },
  );
});

// `url` reprints a stable URL for an existing exhibit and refuses one that isn't
// there. `list --json` reports every exhibit as `{ workstream, name, title,
// created, permanent }`.
void test("url reprints a stable URL for an existing exhibit and refuses one that isn't...", async (t) => {
  const url = await run(["url", "demo/derived"]);
  const missing = await run(["url", "demo/nope"]);
  const listed0 = await run(["list", "--json", "--workstream", "demo"]);
  const rows0 = JSON.parse(listed0.stdout);
  const table = await run(["list", "--workstream", "demo"]);
  t.check(
    {
      url: url.stdout.trim() === "http://127.0.0.1:3230/demo/derived/?token=TOKEN-0123456789abcdef",
      urlLines: url.stdout.trimEnd().split("\n").length,
      missingRefused: missing.code !== 0 && missing.stderr.includes("no exhibit at"),
      code: listed0.code,
      names: rows0.map((r: { name: string }) => r.name),
      keys: Object.keys(rows0[0]).toSorted(),
      titles: rows0.map((r: { title: string }) => r.title),
      tableHasHeader: table.stdout.includes("WORKSTREAM") && table.stdout.includes("CREATED"),
    },
    {
    url: true,
    urlLines: 1,
    missingRefused: true,
    code: 0,
    names: [
      "dashboard-density-options",
      "derived",
    ],
    keys: [
      "created",
      "name",
      "permanent",
      "title",
      "workstream",
    ],
    titles: [
      "Dashboard Density Options",
      "Derived",
    ],
    tableHasHeader: true,
  },
  );
});

// `--permanent` is the other tier: a tracked skeleton at `dev/apps/<slug>/` in the
// current checkout, which carries no prose unless asked. Its
// URL is the `/apps/<slug>/` one it gets once the branch merges, and the stderr
// says so. Committed apps show up in `list` marked permanent, with their runtime
// data read from the store's reserved `apps/` namespace.
void test("--permanent is the other tier:", async (t) => {
  const permanent = await run(["add", "--permanent", "--title", "Threshold Tuner"], worktree);
  const appDir = join(worktree, "dev/apps/threshold-tuner");
  const appManifest = JSON.parse(await readFile(join(appDir, "exhibit.json"), "utf8"));
  const listed = JSON.parse((await run(["list", "--json"], mono)).stdout);
  // list reads committed apps from the MAIN checkout, so copy it there as a merge would.
  await mkdir(join(mono, "dev/apps"), { recursive: true });
  await execFileAsync("cp", ["-R", appDir, join(mono, "dev/apps/threshold-tuner")]);
  const listedAfterMerge = JSON.parse((await run(["list", "--json"], mono)).stdout);
  t.check(
    {
      url: permanent.stdout.trim() === "http://127.0.0.1:3230/apps/threshold-tuner/?token=TOKEN-0123456789abcdef",
      shipsByMerge: permanent.stderr.includes("merges to main"),
      manifestKeys: Object.keys(appManifest).toSorted(),
      manifestTitle: appManifest.title,
      starterPage: (await readFile(join(appDir, "index.html"), "utf8")).includes("committed app"),
      storeAppsDir: await lstat(join(store, "apps")).then(() => true, () => false),
      beforeMerge: listed.some((r: { name: string }) => r.name === "threshold-tuner"),
      afterMerge: {
        ...listedAfterMerge.find((r: { name: string }) => r.name === "threshold-tuner"),
        created: "<created>",
      },
    },
    {
    url: true,
    shipsByMerge: true,
    manifestKeys: [
      "created",
      "title",
    ],
    manifestTitle: "Threshold Tuner",
    starterPage: true,
    storeAppsDir: false,
    beforeMerge: false,
    afterMerge: {
      workstream: "apps",
      name: "threshold-tuner",
      title: "Threshold Tuner",
      created: "<created>",
      permanent: true,
    },
  },
  );
});

// `--caption` is repeatable: the n-th caption goes on the n-th figure file, in
// argument order. Fewer captions than figures leaves the rest uncaptioned. More
// captions than figures is refused with the counts, and the refusal happens
// before the exhibit directory is created, so the slug stays free.
void test("--caption is repeatable:", async (t) => {
  const captioned = await run([
    "add", "--workstream", "demo", "--title", "Captioned",
    "--caption", "Comfortable spacing on the card list",
    "--caption", "Compact spacing, two lines tighter",
    shot, shot2,
  ]);
  const capManifest = JSON.parse(await readFile(join(store, "demo/captioned/exhibit.json"), "utf8"));
  await run([
    "add", "--workstream", "demo", "--title", "Partly Captioned", "--caption", "Only the first", shot, shot2,
  ]);
  const partialManifest = JSON.parse(await readFile(join(store, "demo/partly-captioned/exhibit.json"), "utf8"));
  const tooMany = await run([
    "add", "--workstream", "demo", "--title", "Too Many Captions",
    "--caption", "one", "--caption", "two", "--caption", "three", shot, shot2, join(root, "notes.md"),
  ]);
  t.check(
    {
      code: captioned.code,
      figures: capManifest.figures,
      partial: partialManifest.figures,
      tooManyRefused: tooMany.code !== 0
        && tooMany.stderr.includes("add: 3 captions for 2 figures — one caption per figure, in file order"),
      tooManyLeftNothing: await lstat(join(store, "demo/too-many-captions")).then(() => false, () => true),
    },
    {
    code: 0,
    figures: [
      {
        label: "A1",
        file: "comfortable.png",
        caption: "Comfortable spacing on the card list",
      },
      {
        label: "A2",
        file: "compact.png",
        caption: "Compact spacing, two lines tighter",
      },
    ],
    partial: [
      {
        label: "A1",
        file: "comfortable.png",
        caption: "Only the first",
      },
      {
        label: "A2",
        file: "compact.png",
      },
    ],
    tooManyRefused: true,
    tooManyLeftNothing: true,
  },
  );
});

// Copied files are renamed to something the app can route to. The server validates
// every path segment, so a screenshot straight off a Mac desktop
// (`Screen Shot 2026-08-15.png`) would otherwise be a figure whose URL 404s.
void test("Copied files are renamed to something the app can route to.", async (t) => {
  const shot3 = join(root, "Screen Shot 2026-08-15.png");
  await writeFile(shot3, "png-bytes");
  const shaped = await run([
    "add", "--workstream", "demo", "--title", "Named Files",
    "--prose", "just showing you", shot3,
  ]);
  const shapedDir = join(store, "demo/named-files");
  const shapedManifest = JSON.parse(await readFile(join(shapedDir, "exhibit.json"), "utf8"));
  const { exhibitSegmentSchema } = await import(
    resolve(repoRoot, "workstreams-app/src/shared/exhibits.ts")
  );
  t.check(
    {
      code: shaped.code,
      figures: shapedManifest.figures,
      onDisk: (await readFile(join(shapedDir, "screen-shot-2026-08-15.png"), "utf8")) === "png-bytes",
      routable: exhibitSegmentSchema.safeParse(shapedManifest.figures[0].file).success,
      saidSo: shaped.stderr.includes("copied Screen Shot 2026-08-15.png as screen-shot-2026-08-15.png"),
    },
    {
    code: 0,
    figures: [
      {
        label: "A1",
        file: "screen-shot-2026-08-15.png",
      },
    ],
    onDisk: true,
    routable: true,
    saidSo: true,
  },
  );
});

// A manifest that does not parse is not skipped: its row stays in the list with
// `title: null`, `created: null`, and a `problem`, and `list` exits 1 after
// printing everything, so an incomplete inventory is never taken for a complete
// one.
void test("A manifest that does not parse is not skipped:", async (t) => {
  await writeFile(join(store, "demo/named-files/exhibit.json"), '{"title":"Named Fi');
  const broken = await run(["list", "--json", "--workstream", "demo"]);
  const brokenRows = JSON.parse(broken.stdout);
  const brokenRow = brokenRows.find((r: { name: string }) => r.name === "named-files");
  const brokenTable = await run(["list", "--workstream", "demo"]);
  t.check(
    {
      code: broken.code,
      stillListsOthers: brokenRows.length > 1,
      row: brokenRow,
      tableCode: brokenTable.code,
      tableProblem: brokenTable.stdout.includes("PROBLEM: exhibit.json does not parse"),
    },
    {
    code: 1,
    stillListsOthers: true,
    row: {
      workstream: "demo",
      name: "named-files",
      title: null,
      created: null,
      permanent: false,
      problem: "exhibit.json does not parse",
    },
    tableCode: 1,
    tableProblem: true,
  },
  );
});

// A directory with no `exhibit.json`, or a manifest that is valid JSON but lacks a
// string `title` or `created`, is also a problem row (the app rejects both), and
// `list` exits 1.
void test("A directory with no exhibit.json, or a manifest that is valid JSON but lacks...", async (t) => {
  await writeFile(join(store, "demo/named-files/exhibit.json"), '{"title":"T"}');
  await mkdir(join(store, "demo/no-manifest"), { recursive: true });
  const incomplete = await run(["list", "--json", "--workstream", "demo"]);
  const incompleteRows = JSON.parse(incomplete.stdout);
  const pick = (n: string) => {
    const r = incompleteRows.find((x: { name: string }) => x.name === n);
    return { title: r.title, created: r.created, problem: r.problem };
  };
  t.check(
    {
      code: incomplete.code,
      lacking: pick("named-files"),
      missing: pick("no-manifest"),
    },
    {
    code: 1,
    lacking: {
      title: "T",
      created: null,
      problem: "exhibit.json lacks a title or created string",
    },
    missing: {
      title: null,
      created: null,
      problem: "exhibit.json is missing",
    },
  },
  );
});

// Two inputs that sanitize to the same name are refused before the exhibit
// directory is created, so the slug stays free.
void test("Two inputs that sanitize to the same name are refused before the exhibit dire...", async (t) => {
  await mkdir(join(root, "a"), { recursive: true });
  await writeFile(join(root, "a/Shot One.png"), "a");
  await writeFile(join(root, "shot-one.png"), "b");
  const clash = await run([
    "add", "--workstream", "demo", "--title", "Clashing Names",
    join(root, "a/Shot One.png"), join(root, "shot-one.png"),
  ]);
  t.check(
    {
      refused: clash.code !== 0 && clash.stderr.includes("becomes 'shot-one.png', which is already in this exhibit"),
      leftNothing: await lstat(join(store, "demo/clashing-names")).then(() => false, () => true),
    },
    {
    refused: true,
    leftNothing: true,
  },
  );
});

// The URL always carries a token. The supervisor mints one and reuses whatever it
// finds, so the CLI mints it too when the app has never run — a URL without
// `?token=` is a URL that 401s, which reads as a broken exhibit.
void test("The URL always carries a token.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const tokenFile = join(state, "exhibits-token");
  await rm(tokenFile);
  const minted = await run(["url", "demo/derived"]);
  const first = (await readFile(tokenFile, "utf8")).trim();
  const again = await run(["url", "demo/derived"]);
  const mode = (await lstat(tokenFile)).mode & 0o777;
  t.check(
    {
      carriesToken: minted.stdout.trim() === `http://127.0.0.1:3230/demo/derived/?token=${first}`,
      longEnough: first.length >= 16,
      urlSafe: /^[A-Za-z0-9_-]+$/u.test(first),
      mode: mode.toString(8),
      reused: again.stdout.trim() === minted.stdout.trim(),
    },
    {
    carriesToken: true,
    longEnough: true,
    urlSafe: true,
    mode: "600",
    reused: true,
  },
  );
});
