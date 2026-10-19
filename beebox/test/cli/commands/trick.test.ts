// # bbx trick
//
// `bbx trick` discovers and runs box-local agent-authored scripts. Tricks live
// at `boxCodePaths(shape).tricksDir` — `boxRoot/src/tricks` (the box's one
// root, shapeVersion 3) — so both the subprocess's cwd and every path in its
// listing/error messages resolve through the box's actual shape.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// Run the prebuilt CLI with the given cwd (requireBoxRoot walks up from there).
interface TrickCliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runTrickCli(cwd: string, args: string[]): Promise<TrickCliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PACKAGE_ROOT, "dist/cli.mjs"), "trick", ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// A trick that proves both where it ran from and what env it saw, without
// needing any of its own npm dependencies.
const PROBE_TRICK = `
export const description = "reports its own cwd and BBX_BOX_ROOT";
console.log("cwd:" + process.cwd());
console.log("boxRoot:" + process.env.BBX_BOX_ROOT);
console.log("trickName:" + process.env.BBX_TRICK_NAME);
`;

async function writeTrick(box: TmpBox, { name, content }: { name: string; content: string }) {
  const dir = box.path(join("src", "tricks", "scripts", name));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.ts"), content);
}

async function writeTrickSecrets(box: TmpBox, { name, declarations }: { name: string; declarations: unknown }) {
  const dir = box.path(join("src", "tricks", "scripts", name));
  await writeFile(join(dir, "secrets.json"), JSON.stringify(declarations));
}

// ## A successful run commits only the paths the trick changed
//
// The runner fingerprints every dirty path before the trick starts and again
// after it exits 0, and commits the paths that are new or whose content changed.
// An edit someone left uncommitted before the run stays uncommitted. Untracked
// directories are listed file by file, so a new file in a new directory is
// committed.
function git(box: TmpBox, args: string[]) {
  return execFileSync("git", args, { cwd: box.root, encoding: "utf8" });
}

// The files the HEAD commit touched, and its subject and Run-By trailer.
function headCommit(box: TmpBox) {
  return {
    subject: git(box, ["log", "-1", "--format=%s"]).trim(),
    runBy: git(box, ["log", "-1", "--format=%(trailers:key=Run-By,valueonly)"]).trim(),
    files: git(box, ["show", "--name-only", "--format=", "HEAD"]).trim().split("\n"),
  };
}

function dirty(box: TmpBox) {
  return git(box, ["status", "--porcelain", "--untracked-files=all"]).trim().split("\n").filter(Boolean);
}

// A trick that appends a line to each box-relative path given as an argument,
// creating parent directories. A literal "fail" argument makes it exit 3.
const WRITE_TRICK = `
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
for (const rel of args.filter((a) => a !== "fail")) {
  const abs = join(process.env.BBX_BOX_ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  appendFileSync(abs, "from trick\\n");
}
process.exit(args.includes("fail") ? 3 : 0);
`;

async function writeBoxFile(box: TmpBox, { rel, content }: { rel: string; content: string }) {
  await mkdir(join(box.root, rel, ".."), { recursive: true });
  await writeFile(box.path(rel), content);
}

// A box with the write trick committed, and one unrelated uncommitted edit.
async function boxWithPendingEdit() {
  const box = await makeTmpBox({ git: true });
  await writeTrick(box, { name: "write", content: WRITE_TRICK });
  await writeBoxFile(box, { rel: "notes/shared.txt", content: "committed\n" });
  git(box, ["add", "-A"]);
  git(box, ["commit", "-q", "-m", "fixture"]);
  await writeBoxFile(box, { rel: "notes/someone-else.txt", content: "unrelated edit\n" });
  return box;
}

// ## Runs from `boxRoot/src/tricks`, with `BBX_BOX_ROOT` set to the box root
void test("Runs from `boxRoot/src/tricks`, with `BBX_BOX_ROOT` set to the box root", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L57
  const box = await makeTmpBox({ git: true });
  await writeTrick(box, { name: "probe", content: PROBE_TRICK });

  // doctest:L60
  const r = await runTrickCli(box.root, ["probe"]);
  const expectedCwd = await realpath(box.path("src/tricks"));
  const expectedRoot = await realpath(box.root);
  t.check(r, { code: 0, stdout: `cwd:${expectedCwd}\nboxRoot:${expectedRoot}\ntrickName:probe\n`, stderr: "" });
});

// ## Secret declarations can be checked without running a trick
//
// The migration and CI can validate the author-provided declarations without
// resolving or printing any secret values.
void test("The migration and CI can validate the author-provided declarations without re...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L84
  const box = await makeTmpBox({ git: true });
  await writeTrick(box, { name: "needs-key", content: PROBE_TRICK });
  await writeTrickSecrets(box, {
    name: "needs-key",
    declarations: [
      { name: "image-generation", reason: "image-generation", env: "IMAGE_API_KEY" },
    ],
  });

  // doctest:L90
  const checked = await runTrickCli(box.root, ["--check-secrets"]);
  t.check({ code: checked.code, stdout: checked.stdout.trim() }, {
    code: 0,
    stdout: "Validated secret declarations for 1 trick(s).",
  });
});

// ## Listing and not-found messages name `src/tricks/scripts/...`
void test("Listing and not-found messages name `src/tricks/scripts/...`", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L102
  const box = await makeTmpBox({ git: true });

  // doctest:L104
  const empty = await runTrickCli(box.root, []);
  t.check(empty, {
    code: 0,
    stdout: `No tricks found.

Create one at src/tricks/scripts/<name>/index.ts
See node_modules/beebox/box-docs/tricks.md for details.
`,
    stderr: "",
  });

  // doctest:L110
  const missing = await runTrickCli(box.root, ["nope"]);
  t.check(missing, {
    code: 1,
    stdout: "",
    stderr: `Trick not found: nope
Expected: src/tricks/scripts/nope/index.ts
`,
  });
});

void test("A successful run commits only the paths the trick changed", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L183
  const box = await boxWithPendingEdit();
  const r = await runTrickCli(box.root, ["write", "out/new/deep/result.txt"]);
  t.check(r.code, 0);

  // doctest:L188
  t.check(headCommit(box), {
    subject: "Auto-commit changes from trick: write",
    runBy: "trick/write",
    files: [
      "out/new/deep/result.txt",
    ],
  });

  // doctest:L191
  t.check(dirty(box), [
    "?? notes/someone-else.txt",
  ]);
});

// ## A trick's edit to an already-dirty file is committed
//
// A path that was dirty before the run and that the trick changes again is in
// both snapshots; its content differs, so it is committed. The commit holds the
// whole file, including the earlier uncommitted edit.
void test("A path that was dirty before the run and that the trick changes again is in b...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L206
  const box = await boxWithPendingEdit();
  await writeFile(box.path("notes/shared.txt"), "committed\nedited before the run\n");
  await runTrickCli(box.root, ["write", "notes/shared.txt"]);
  t.check(headCommit(box).files, [
    "notes/shared.txt",
  ]);

  // doctest:L212
  await t.checkText(await readFile(box.path("notes/shared.txt"), "utf8"), `committed
edited before the run
from trick`);

  // doctest:L217
  t.check(dirty(box), [
    "?? notes/someone-else.txt",
  ]);
});

// ## A file over the auto-stage limit stays uncommitted
//
// The 10 MB guard that protects a blind sweep also applies to the trick's own
// paths: an oversized file is left unstaged with a warning, and the rest of the
// trick's output is committed.
void test("The 10 MB guard that protects a blind sweep also applies to the trick's own p...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L232
  const box = await boxWithPendingEdit();
  await writeTrick(box, { name: "big", content: `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.BBX_BOX_ROOT, "out/big.dat"), Buffer.alloc(11 * 1024 * 1024, 1));
writeFileSync(join(process.env.BBX_BOX_ROOT, "out/small.txt"), "small\\n");
` });
  await mkdir(box.path("out"), { recursive: true });
  git(box, ["add", "-A", "src"]);
  git(box, ["commit", "-q", "-m", "big trick"]);

  const r = await runTrickCli(box.root, ["big"]);
  // doctest:L243
  t.check(headCommit(box).files, [
    "out/small.txt",
  ]);

  // doctest:L247
  t.check(r, {
    code: 0,
    stdout: `Committed 2 path(s) changed by trick "big".
`,
    stderr: `[git] Housekeeping skipped staging 1 file(s) over 10MB (left uncommitted — LFS-track, gitignore, or remove): out/big.dat (11.0MB)
`,
  });

  // doctest:L250
  t.check(dirty(box), [
    "?? notes/someone-else.txt",
    "?? out/big.dat",
  ]);
});

// ## Output that git ignores commits nothing
void test("Output that git ignores commits nothing", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L261
  const box = await boxWithPendingEdit();
  await writeFile(box.path(".gitignore"), (await readFile(box.path(".gitignore"), "utf8")) + "scratch/\n");
  git(box, ["commit", "-q", "-am", "ignore scratch"]);
  const headBefore = git(box, ["rev-parse", "HEAD"]);

  // doctest:L266
  const r = await runTrickCli(box.root, ["write", "scratch/out.txt"]);
  t.check(r.code, 0);

  // doctest:L270
  t.check(git(box, ["rev-parse", "HEAD"]), headBefore);

  // doctest:L273
  t.check(dirty(box), [
    "?? notes/someone-else.txt",
  ]);
});

// ## `--no-commit` and a failed run leave the tree as the trick left it
void test("`--no-commit` and a failed run leave the tree as the trick left it", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L284
  const box = await boxWithPendingEdit();
  const headBefore = git(box, ["rev-parse", "HEAD"]);

  // doctest:L287
  const skipped = await runTrickCli(box.root, ["write", "--no-commit", "out/a.txt"]);
  t.check(skipped.code, 0);

  // doctest:L293
  const failed = await runTrickCli(box.root, ["write", "out/b.txt", "fail"]);
  t.check(failed.code, 3);

  // doctest:L297
  t.check(git(box, ["rev-parse", "HEAD"]), headBefore);

  // doctest:L300
  t.check(dirty(box), [
    "?? notes/someone-else.txt",
    "?? out/a.txt",
    "?? out/b.txt",
  ]);
});
