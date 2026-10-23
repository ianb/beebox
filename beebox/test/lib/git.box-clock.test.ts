// # Commits carry the box clock on a walk fixture
//
// A journey walk fixture (`fakeNotifications` in `_config/box.json`) can run
// ahead of real time: a stored offset, or `BBX_TIME` during a wait's replay.
// Commits from the engine and from an agent's shell (through the `git` shim
// `buildScriptEnv` puts on PATH) take the box date.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { commit, stageAll } from "../../src/lib/git/core/operations.js";
import { buildScriptEnv } from "../../src/core/script-env/core.js";
import { clearTimeCache, getBoxTime } from "../../src/lib/time.js";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };

function git(box: TmpBox, ...args: string[]): string {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}

async function makeFixture(options: { offsetMs?: number; offsetText?: string; walk: boolean }): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  if (options.walk) await box.write("_config/box.json", JSON.stringify({ fakeNotifications: true }));
  if (options.offsetMs !== undefined) {
    await mkdir(join(box.root, ".beebox"), { recursive: true });
    await writeFile(join(box.root, ".beebox/clock-offset.json"), JSON.stringify({ offsetMs: options.offsetMs }));
  }
  if (options.offsetText !== undefined) {
    await mkdir(join(box.root, ".beebox"), { recursive: true });
    await writeFile(join(box.root, ".beebox/clock-offset.json"), options.offsetText);
  }
  await box.commitAll("fixture");
  clearTimeCache();
  return box;
}

async function engineCommit(box: TmpBox): Promise<string> {
  await box.write("_content/inbox/A.doc.card", "---\ntitle: A\n---\nx\n");
  await stageAll(box.root);
  await commit(box.root, { message: "engine commit" });
  return git(box, "log", "-1", "--format=%aI|%cI");
}

async function shellCommit(box: TmpBox): Promise<string> {
  const env = { ...(await buildScriptEnv(box.root)), ...IDENTITY };
  await box.write("_content/inbox/B.doc.card", "---\ntitle: B\n---\ny\n");
  execFileSync("git", ["add", "-A"], { cwd: box.root, env });
  execFileSync("git", ["commit", "-q", "-m", "shell commit", "--no-verify"], { cwd: box.root, env });
  return git(box, "log", "-1", "--format=%aI|%cI");
}

function dayOf(stamps: string): string {
  return stamps.split("|").map((s) => s.slice(0, 10)).join("|");
}

function expectedDay(options: { ms: number }): string {
  const d = new Date(options.ms).toISOString().slice(0, 10);
  return `${d}|${d}`;
}

// With a stored offset, both paths date the commit a week ahead:
void test("With a stored offset, both paths date the commit a week ahead:", async (t) => {
  const box = await makeFixture({ walk: true, offsetMs: WEEK_MS });
  t.teardown(() => box.cleanup());
  const when = Date.now() + WEEK_MS;
  t.check({ engine: dayOf(await engineCommit(box)), shell: dayOf(await shellCommit(box)) }, {
    engine: expectedDay({ ms: when }),
    shell: expectedDay({ ms: when }),
  });
});

// Under BBX_TIME with no offset file, both paths use BBX_TIME:
void test("Under BBX_TIME with no offset file, both paths use BBX_TIME:", async (t) => {
  const box = await makeFixture({ walk: true });
  t.teardown(() => {
    delete process.env.BBX_TIME;
    clearTimeCache();
    return box.cleanup();
  });
  process.env.BBX_TIME = "2027-03-04T05:06:07Z";
  t.check({ engine: await engineCommit(box), shell: await shellCommit(box) }, {
    engine: "2027-03-04T05:06:07Z|2027-03-04T05:06:07Z",
    shell: "2027-03-04T05:06:07Z|2027-03-04T05:06:07Z",
  });
});

// A date already set in the environment wins over the shim:
void test("A date already set in the environment wins over the shim:", async (t) => {
  const box = await makeFixture({ walk: true, offsetMs: WEEK_MS });
  t.teardown(() => box.cleanup());
  const env = { ...(await buildScriptEnv(box.root)), ...IDENTITY, GIT_AUTHOR_DATE: "1577934245 +0000", GIT_COMMITTER_DATE: "1577934245 +0000" };
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "dated", "--no-verify"], { cwd: box.root, env });
  t.check(git(box, "log", "-1", "--format=%aI"), "2020-01-02T03:04:05Z");
});

// A box that is not a walk fixture keeps real dates and gets no shim:
void test("A box that is not a walk fixture keeps real dates and gets no shim:", async (t) => {
  const box = await makeFixture({ walk: false, offsetMs: WEEK_MS });
  t.teardown(() => box.cleanup());
  const env = await buildScriptEnv(box.root);
  const today = expectedDay({ ms: Date.now() });
  t.check({
    engine: dayOf(await engineCommit(box)),
    shell: dayOf(await shellCommit(box)),
    shimOnPath: (env.PATH ?? "").includes(join(box.root, ".beebox/bin")),
  }, { engine: today, shell: today, shimOnPath: false });
});

// A malformed offset file leaves the box and the shell on real time:
void test("A malformed offset file leaves the box and the shell on real time:", async (t) => {
  const box = await makeFixture({ walk: true, offsetText: '{"offsetMs":604800000,' });
  t.teardown(() => box.cleanup());
  const today = expectedDay({ ms: Date.now() });
  t.check({ boxDay: getBoxTime(box.root).toISOString().slice(0, 10), shell: dayOf(await shellCommit(box)) }, {
    boxDay: today.slice(0, 10),
    shell: today,
  });
});

// An offset in exponent form shifts the box and the shell alike:
void test("An offset in exponent form shifts the box and the shell alike:", async (t) => {
  const box = await makeFixture({ walk: true, offsetText: '{"offsetMs":6.048e8}' });
  t.teardown(() => box.cleanup());
  const when = Date.now() + WEEK_MS;
  t.check({ boxDay: getBoxTime(box.root).toISOString().slice(0, 10), shell: dayOf(await shellCommit(box)) }, {
    boxDay: expectedDay({ ms: when }).slice(0, 10),
    shell: expectedDay({ ms: when }),
  });
});
