// # finish-verify: arguments, interruption, and concurrent runs
//
// A full `bin/finish-verify` run merges main and runs every check the sheet
// names, which takes ten minutes or more. Three finishes in October 2026 started
// that run by asking for `--help`. So the command parses its arguments strictly
// and runs nothing unless they are all valid.

import * as tapModule from "tap";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(process.cwd(), "..");
const verify = path.join(repo, "bin/finish-verify.ts");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "finish-verify-"));
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });

const USAGE = `usage: bin/finish-verify [--sheet <file>] [--only tests|typecheck|lint|smoke|site|apple|theme]

Runs the checks bin/finish-preflight's sheet names and prints VERDICT: green|red.
Without --sheet it runs bin/finish-preflight --json first, which merges main.

  --sheet <file>  read the decision sheet from a file instead
  --only <kind>   run only that kind of check
  -h, --help      print this and exit

Exit: 0 green, 1 red, 2 bad arguments, 128+n when killed by signal n.`;

/** A sheet that names one check, run as a shell script in the fixture repo. */
const sheetFile = (script: string, kind?: string): string => {
  const file = path.join(root, "sheet.json");
  const command = { kind: kind ?? "typecheck", command: "fixture check", cwd: ".", argv: ["sh", "-c", script] };
  fs.writeFileSync(file, JSON.stringify({ repoRoot: root, verification: [command] }));
  return file;
};
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), verify, ...args], {
    cwd: root,
    encoding: "utf8",
  });
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
};

tapModule.default.teardown(async () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (error) {
    console.error("teardown failed:", error);
    process.exitCode = 1;
  }
});

// ## Arguments
//
// `--help` prints the usage and exits 0. The fixture is not a worktree branch, so
// if the command ran preflight it would exit 1 instead.
void test("--help prints the usage and exits 0.", async (t) => {
  const help = cli("--help");
  t.check(help.status, 0);
  t.checkText(help.stdout, USAGE);
});

// An unknown flag and an unknown `--only` kind are usage errors: exit 2, the
// reason, and the usage, with nothing run.
void test("An unknown flag and an unknown --only kind are usage errors:", async (t) => {
  const unknown = cli("--sheeet", "x.json");
  const badKind = cli("--only", "test");
  t.check([unknown.status, badKind.status, unknown.stdout, badKind.stdout], [
    2,
    2,
    "",
    "",
  ]);

  t.checkText(unknown.stderr, `finish-verify: bad arguments: Unknown option '--sheeet'\n${USAGE}`);
  t.checkText(badKind.stderr, `finish-verify: bad arguments: --only takes tests, typecheck, lint, smoke, site, apple, theme; got 'test'\n${USAGE}`);
});

// ## Interruption stops the checks' whole process tree
//
// An agent harness stops a command by signalling its pid alone. Each check runs
// in its own process group, and finish-verify passes the signal to that group.
// Before this, an interrupted run left its test runner going and holding a test
// slot. Here the check starts a background `sleep`, the way pnpm starts tap; the
// `sleep` must die with finish-verify.
void test("An agent harness stops a command by signalling its pid alone.", async (t) => {
  const pidFile = path.join(root, "grandchild.pid");
  const child = spawn(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), verify, "--sheet", sheetFile(`sleep 60 & echo $! > ${pidFile}; wait`)],
    { cwd: root, stdio: "ignore" },
  );
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const grandchild = await eventually(
    () => fs.existsSync(pidFile) && Number(fs.readFileSync(pidFile, "utf8")) > 0 && Number(fs.readFileSync(pidFile, "utf8")),
    { label: "the check started its background sleep", timeoutMs: 20_000 },
  );
  child.kill("SIGTERM");
  const code = await exited;
  await eventually(() => !alive(grandchild), { label: "the background sleep exited", timeoutMs: 5_000 });

  // Exit 143 is 128 + SIGTERM's 15, the shell convention for death by signal.

  t.check(code, 143);
});

// Without `--sheet`, finish-verify first runs preflight, which merges main and
// can take a while. A signal then must stop preflight's tree too. Preflight runs
// the fixture's `bin/private-issues` early, so here that script starts a
// background `sleep` and waits, which holds preflight in place.
void test("Without --sheet, finish-verify first runs preflight, which merges main and ca...", async (t) => {
  const branchRepo = fs.mkdtempSync(path.join(os.tmpdir(), "finish-verify-preflight-"));
  const inRepo = (...args: string[]) => execFileSync("git", args, { cwd: branchRepo });
  inRepo("init", "-q", "-b", "worktree-demo");
  inRepo("-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "start");
  const preflightPid = path.join(branchRepo, "sleep.pid");
  fs.mkdirSync(path.join(branchRepo, "bin"));
  fs.writeFileSync(path.join(branchRepo, "bin/private-issues"), `#!/bin/sh\nsleep 60 & echo $! > ${preflightPid}; wait\n`, { mode: 0o755 });
  const waiting = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), verify], { cwd: branchRepo, stdio: "ignore" });
  const waitingExit = new Promise<number | null>((resolve) => waiting.on("exit", (code) => resolve(code)));
  const sleeper = await eventually(
    () => fs.existsSync(preflightPid) && Number(fs.readFileSync(preflightPid, "utf8")) > 0 && Number(fs.readFileSync(preflightPid, "utf8")),
    { label: "preflight started its private-issues check", timeoutMs: 20_000 },
  );
  waiting.kill("SIGTERM");
  const waitingCode = await waitingExit;
  await eventually(() => !alive(sleeper), { label: "preflight's sleep exited", timeoutMs: 5_000 });
  fs.rmSync(branchRepo, { recursive: true, force: true });
  t.check(waitingCode, 143);
});

// ## A concurrent run is named
//
// Every worktree shares one dev router, so another worktree's finish-verify slows
// this run's smoke walk. Each run registers its pid under the git common dir.
// A run that finds another live registration prints a note, so a slow smoke can
// be read as load. This test registers its own live pid as the other run.
void test("Every worktree shares one dev router, so another worktree's finish-verify slo...", async (t) => {
  const runs = path.join(root, ".git", "finish-verify-runs");
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, `${process.pid}.json`), JSON.stringify("other-worktree"));
  const concurrent = cli("--sheet", sheetFile("true"));
  t.check(concurrent.status, 0);
  t.checkText(concurrent.stdout, `note: finish-verify also running in other-worktree (pid ${process.pid}) — the shared dev router is loaded; a slow smoke may be load
run  fixture check → «*»/0-typecheck.log
ok   fixture check («*»s)
VERDICT: green`);

  // A finished run removes its own registration, so only the planted one remains.

  t.check(fs.readdirSync(runs), [`${process.pid}.json`]);
});

// ## A failure in a file identical to main says so
//
// A site doc that links to a card page broke on main when the card type moved
// into a plugin. The next workstream's finish then failed its site build on
// that doc, which it had never touched, and nothing in the report said so. Now
// a red check that names a file with no difference from main gets a note.
//
// Here `site/docs/a.md` is committed on main unchanged, `site/docs/b.md` is a
// branch edit, and `site/docs/c.md` is new and untracked. The check fails naming
// all three; only `a.md` gets the note.
void test("A site doc that links to a card page broke on main when the card type moved i...", async (t) => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.mkdirSync(path.join(root, "site/docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/docs/a.md"), "[x](reference/cards/gone.md)\n");
  fs.writeFileSync(path.join(root, "site/docs/b.md"), "first\n");
  git("add", "site");
  git("commit", "-qm", "docs");
  git("checkout", "-qb", "worktree-demo");
  fs.writeFileSync(path.join(root, "site/docs/b.md"), "edited\n");
  // An untracked new file has no diff against main either, but it is not on main.
  fs.writeFileSync(path.join(root, "site/docs/c.md"), "new\n");
  const red = cli(
    "--sheet",
    sheetFile(`echo 'site/docs/a.md links to "reference/cards/gone.md"'; echo "${root}/site/docs/b.md: also"; echo 'site/docs/c.md: too'; exit 1`),
  );
  t.check(red.stdout.split("\n").filter((line) => line.startsWith("     ")).map((line) => line.trim()), [
    "unchanged from main: site/docs/a.md — main may fail the same way, or this branch removed what it references",
  ]);
  t.check(red.status, 1);
});

// ## A red smoke walk shows each step's time
//
// The smoke walk has one 120-second budget. In October 2026 it ran out three
// times: twice after a cold start, once while another worktree's finish-verify
// used the shared dev router. The report gave only the total, so a reader could
// not tell load from a broken step. A red smoke now shows the walk's step lines,
// each with the step's own time and its usual time.
void test("The smoke walk has one 120-second budget.", async (t) => {
  const smoke = cli(
    "--sheet",
    sheetFile("echo 'ok   the app loads (9.0s; usual 2.0s)'; echo 'FAIL a card opens (40.0s; usual 8.0s; walk 120.0s)'; exit 1", "smoke"),
  );
  t.check(smoke.stdout.split("\n").filter((line) => line.startsWith("     ")).map((line) => line.trim()), [
    "ok   the app loads (9.0s; usual 2.0s)",
    "FAIL a card opens (40.0s; usual 8.0s; walk 120.0s)",
  ]);
  t.check(smoke.status, 1);
});
