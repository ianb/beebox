// # Concurrent Commits to One Box
//
// The test that decides whether the box git lock works. A box's git index is one
// repo-wide mutex, so two processes committing at the same moment used to mean one
// of them died with `fatal: Unable to create '<box>/.git/index.lock': File
// exists`. A single-process test cannot show this is fixed — the thing being
// excluded is another process — so these examples spawn real ones.

import { test } from "tap";
import "agent-doctest/tap";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getStatus } from "../../src/lib/git/core/operations.js";

const PACKAGE_ROOT = join(import.meta.dirname, "../..");
const CHILD_SCRIPT = join(PACKAGE_ROOT, "test/helpers/git-commit-child.ts");

function startCommitter(boxRoot: string, { name, env }: { name: string; env: NodeJS.ProcessEnv }) {
  const child = spawn(process.execPath, ["--import", "tsx", CHILD_SCRIPT, boxRoot, name], {
    cwd: PACKAGE_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  const state = { name, child, out: "", err: "" };
  child.stdout.on("data", (chunk) => { state.out += String(chunk); });
  child.stderr.on("data", (chunk) => { state.err += String(chunk); });
  return state;
}
type Committer = ReturnType<typeof startCommitter>;
interface Outcome { name: string; code: number | null; out: string; last: string | undefined; stderr: string }

// Resolves once the child has written its file and parked on the starting gun.
function awaitReady(state: Committer) {
  return new Promise<void>((resolve, reject) => {
    const check = () => { if (state.out.includes("ready")) resolve(); };
    state.child.stdout.on("data", check);
    check();
    state.child.once("error", reject);
    state.child.once("exit", (code) => {
      reject(new Error(`${state.name} exited before ready (${code}): ${state.err}`));
    });
  });
}

function awaitOutcome(state: Committer) {
  return new Promise<Outcome>((resolve) => {
    state.child.once("exit", (code) => {
      const lines = state.out.trim().split("\n");
      resolve({ name: state.name, code, out: state.out, last: lines[lines.length - 1], stderr: state.err });
    });
  });
}

// Spawn one committer per name, wait until every one is parked, then release
// them all at once so they contend for the index for real.
async function raceCommitters(boxRoot: string, names: string[]) {
  const states = names.map((name) => startCommitter(boxRoot, { name, env: {} }));
  await Promise.all(states.map(awaitReady));
  for (const state of states) state.child.stdin.write("go\n");
  return Promise.all(states.map(awaitOutcome));
}

// One line per commit: subject, the writer that claimed it, and the files it
// actually touched. Commits are delimited by a record-separator byte because
// `--name-only` already puts a blank line between the header and the files, so
// a blank line cannot also delimit commits.
function describeCommit(record: string) {
  const [header = "", ...rest] = record.trim().split("\n");
  const [subject, trailer] = header.split("|");
  const files = rest.filter((line) => line !== "");
  return `${subject} / by=${trailer} / files=${files.join(",")}`;
}

async function describeLog(boxRoot: string, count: number) {
  const format = "--format=%x1e%s|%(trailers:key=Committed-By,valueonly,separator=)";
  const raw = await simpleGit(boxRoot).raw(["log", format, "--name-only", `-${count}`]);
  const records = raw.split("\u001E").filter((record) => record.trim() !== "");
  const described = records.map(describeCommit);
  described.sort();
  return described.join("\n");
}

// ## Every writer lands, and each commit carries only its own work
//
// Five processes commit five different files into one box at the same instant.
void test("Five processes commit five different files into one box at the same instant.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L91
  const box = await makeTmpBox({ git: true });
  const names = ["alpha", "bravo", "charlie", "delta", "echo"];
  const outcomes = await raceCommitters(box.root, names);
  const failures = outcomes.filter((o) => o.code !== 0);

  // doctest:L96
  t.check(failures.map((o) => `${o.name}: ${o.last}`).join("\n") || "all succeeded", "all succeeded");

  // Every one of them produced a commit — nobody was silently absorbed by another
  // writer's commit and reported success:

  // doctest:L104
  await t.checkText(outcomes.filter((o) => o.last?.startsWith("committed") && !o.last.endsWith("null")).length, "5");

  // Attribution is intact. Each commit names exactly the file its own writer wrote,
  // and carries its own trailer — this is the part a per-operation retry could never
  // give, because staging and committing were two separately-raced operations and a
  // neighbour's staged file could ride along:

  // doctest:L114
  await t.checkText(await describeLog(box.root, 5), `commit from alpha / by=alpha / files=alpha.md
commit from bravo / by=bravo / files=bravo.md
commit from charlie / by=charlie / files=charlie.md
commit from delta / by=delta / files=delta.md
commit from echo / by=echo / files=echo.md`);

  // Nothing is left behind: no writer's file stayed uncommitted, and no stale index
  // lock survived the race.

  // doctest:L126
  t.check((await getStatus(box.root)).clean, true);

  // doctest:L131
  t.check(existsSync(join(box.root, ".git", "index.lock")), false);

  // Our own lock releases too — the guard directory is gone, so the next writer
  // acquires immediately rather than waiting out a stale window:

  // doctest:L139
  t.check(existsSync(join(box.root, ".git", "beebox-index.lock.guard")), false);
});

// ## A writer outside our control still produces an honest, bounded failure
//
// The lock serializes writers that take it. A box agent shells out to raw `git`
// and cannot be made to, so the lock's promise there is narrower: our writer waits
// for it, and then reports what is actually true instead of dying instantly.
//
// Hold `.git/index.lock` the way a foreign process would. The wait budget is
// shortened via the test-only `BBX_BOX_GIT_LOCK_WAIT_MS` override so the test does
// not spend a real minute, and what comes back is git's own contention error
// rather than an invented one:
void test("The lock serializes writers that take it.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L159
  const box = await makeTmpBox({ git: true });
  const indexLock = join(box.root, ".git", "index.lock");
  writeFileSync(indexLock, "");
  const state = startCommitter(box.root, { name: "held", env: { BBX_BOX_GIT_LOCK_WAIT_MS: "300" } });
  await awaitReady(state);
  state.child.stdin.write("go\n");
  const outcome = await awaitOutcome(state);
  rmSync(indexLock);

  // doctest:L168
  t.check(outcome.code, 1);

  // The message says what is actually wrong — the index is held — and it arrives
  // bounded, not after a hang:

  // doctest:L176
  await t.checkText(outcome.out.includes("index.lock"), "true");

  // Git's own words reach the caller, so a reader of a failed scheduled task sees a
  // lock race rather than a broken task:

  // doctest:L184
  await t.checkText(outcome.out.includes("Another git process seems to be running"), "true");
});
