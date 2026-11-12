// # Checking all views in a box
//
// `checkViews(boxRoot, { timeoutMs })` renders every view in a box (each in a
// killable `bbx view render-one` child) and reports which fail. It's the whole-box gate a
// migration uses (`bbx view check`) and the broken-view detector. `ok` is true only
// when every view renders.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, mkdtemp, readdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { any, type Expected, str, unordered } from "@ianbicking/tap-check/check";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { checkViews, type SnapshotDirs, type ViewCheckResult } from "../../../../src/cli/commands/view/command.js";
import { runAdvice, type AdviseRunner } from "../../../../src/cli/commands/view/advise.js";
import { ADVICE_MESSAGES } from "../../../../src/core/views/advice/types.js";
import { PACKAGE_ROOT } from "../../../../src/lib/package-root.js";

const requireFromEngine = createRequire(join(PACKAGE_ROOT, "package.json"));

// This test verifies render correctness, not the production timeout threshold.
// Full-suite contention has pushed a valid cold render past 40 seconds, so keep
// enough headroom here while the outer test timeout still catches hangs.
const TEST_VIEW_TIMEOUT_MS = 60000;

// A v2 box carries its own physical React copy. The renderer overrides it
// with the engine's copy so hook-using views share react-dom/server's
// dispatcher. `makeTmpBox({ deps: true, git: true })` therefore simulates the normal
// package layout by placing React beside the symlinked `beebox` package.
async function makeViewBox() {
  const box = await makeTmpBox({ deps: true, git: true });
  const reactNodeModules = dirname(dirname(requireFromEngine.resolve("react/package.json")));
  await symlink(join(reactNodeModules, "react"), join(box.root, "node_modules", "react"), "dir");
  return box;
}

// Views live at `<boxRoot>/src/views`.
async function writeView(box: TmpBox, { rel, content }: { rel: string; content: string }) {
  const full = join(box.root, "src", "views", rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

const DOC_CARD = `---
title: Test
---
Test doc content
`;

const GOOD_VIEW = `export const name = "Good";
export const description = "renders fine";
export const dependencies = [];
export const modes = ["page"];
export default function Good() {
  return <div>ok</div>;
}
`;

// Reads card.attrs (removed from ViewCard) — card.attrs is undefined, so
// card.attrs.title throws at render. This is exactly the breakage the
// view-card-shape migration exists to find and fix.
const BROKEN_VIEW = `export const name = "Broken";
export const description = "reads a removed field";
export const dependencies = ["_content/**/*.doc.card"];
export const modes = ["page"];
export default function Broken({ cards }) {
  return <ul>{cards.map((c) => <li key={c.path}>{c.attrs.title}</li>)}</ul>;
}
`;

// ## A mix of good and broken views fails, and names which
void test("A mix of good and broken views fails, and names which", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeViewBox();
  await writeView(box, { rel: "good.tsx", content: GOOD_VIEW });
  await writeView(box, { rel: "broken.tsx", content: BROKEN_VIEW });
  await box.write("_content/inbox/Test.doc.card", DOC_CARD);

  const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS });
  t.check(result, {
    ok: false,
    views: unordered<Expected<ViewCheckResult>>([
      { slug: "good", ok: true },
      // The stack holds temp-dir paths, so only its head is fixed.
      {
        slug: "broken",
        ok: false,
        error: str`View render failed [no card, first frame]: TypeError: Cannot read properties of undefined (reading 'title')${any(String)}`,
      },
    ]),
  });
});

// ## A box with no broken views passes
void test("A box with no broken views passes", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeViewBox();
  await writeView(box, { rel: "good.tsx", content: GOOD_VIEW });

  const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS });
  t.check(result, { ok: true, views: [{ slug: "good", ok: true }] });
});

// ## A box with no views at all is trivially OK
void test("A box with no views at all is trivially OK", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS });
  t.check(result, {
    ok: true,
    views: [],
  });
});



// ## Advice
//
// A passing view also gets advice: patterns the views doc forbids, from its
// source and from what it rendered. Advice never changes `ok` or the exit
// code (docs/plans/box-view-guidance-and-checks.md, Track 3).

const ADVISED_VIEW = `export const name = "Advised";
export const dependencies = [];
export const modes = ["page"];
export default function Advised() {
  const today = new Date().toISOString().slice(0, 10);
  return <div><p>{today.length}</p><button></button></div>;
}
`;

/** Run `bbx view check` in the box. */
function runCheck(boxRoot: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(join(PACKAGE_ROOT, "bin", "bbx"), ["view", "check", "--timeout", String(TEST_VIEW_TIMEOUT_MS)], { cwd: boxRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => { resolve({ code, stdout, stderr }); });
  });
}

void test("a view with a source and a DOM finding passes with two advice lines", async (t) => {
  const box = await makeViewBox();
  t.teardown(() => box.cleanup());
  await writeView(box, { rel: "advised.tsx", content: ADVISED_VIEW });
  t.check(await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS }), {
    ok: true,
    views: [{
      slug: "advised",
      ok: true,
      advice: [
        { rule: "utc-today", message: ADVICE_MESSAGES["utc-today"], where: ["views/advised.tsx:5"] },
        { rule: "unnamed-control", message: ADVICE_MESSAGES["unnamed-control"], where: ["<button>"] },
      ],
    }],
  });
  t.check(await runCheck(box.root), {
    code: 0,
    stdout: `✓ advised
    advice: ${ADVICE_MESSAGES["utc-today"]} — views/advised.tsx:5
    advice: ${ADVICE_MESSAGES["unnamed-control"]} — <button>
1 view(s), 0 failing, 1 with advice
`,
    stderr: "",
  });
});

// Advice merges across check states, each place once: the `<img>` shows
// only with a card, the `<button>` in both states.
void test("advice from several states merges by rule", async (t) => {
  const box = await makeViewBox();
  t.teardown(() => box.cleanup());
  await box.write("_content/inbox/Test.doc.card", DOC_CARD);
  await writeView(box, { rel: "states.tsx", content: `export const name = "States";
export const dependencies = ["_content/**/*.doc.card"];
export const rendersCardTypes = ["doc"];
export const modes = ["page"];
export default function States({ cards, params }) {
  const card = cards.find((c) => c.path === params.path);
  return <div><button></button>{card === undefined ? null : <img src="/x.png" />}</div>;
}
` });
  t.check(await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS }), {
    ok: true,
    views: [{
      slug: "states",
      ok: true,
      advice: [
        { rule: "unnamed-control", message: ADVICE_MESSAGES["unnamed-control"], where: ["<button>"] },
        { rule: "img-without-alt", message: ADVICE_MESSAGES["img-without-alt"], where: ["<img src=\"/x.png\">"] },
      ],
    }],
  });
});

// The snapshot keeps the view's <style> elements in the head; a rule added
// through the CSSOM is lost, so that wrapped table gets advice that says "if
// this table does not already scroll".
void test("a wrapper styled by a head <style> counts; one styled through the CSSOM does not", async (t) => {
  const box = await makeViewBox();
  t.teardown(() => box.cleanup());
  await writeView(box, { rel: "tables.tsx", content: `import { useEffect } from "react";
export const name = "Tables";
export const dependencies = [];
export const modes = ["page"];
const row = <tr><td>1</td><td>2</td><td>3</td><td>4</td></tr>;
export default function Tables() {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = ".scrolls { overflow-x: auto }";
    document.head.appendChild(style);
    const sheet = document.createElement("style");
    document.head.appendChild(sheet);
    sheet.sheet.insertRule(".cssom { overflow-x: auto }");
  }, []);
  return <div>
    <div className="scrolls"><table className="a"><tbody>{row}</tbody></table></div>
    <div className="cssom"><table className="b"><tbody>{row}</tbody></table></div>
  </div>;
}
` });
  t.check(await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS }), {
    ok: true,
    views: [{
      slug: "tables",
      ok: true,
      advice: [{ rule: "wide-table-without-wrapper", message: ADVICE_MESSAGES["wide-table-without-wrapper"], where: ["<table class=\"b\">"] }],
    }],
  });
});

const INVALID_CARD_VIEW = `export const name = "List";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page"];
export default function List({ cards }) { return <div>n: {cards.length}</div>; }
`;

// Advice runs only after the render child's whole outcome: a view that fails
// on an invalid dependency card never reaches advice, and with
// `--allow-invalid-cards` a hung advise child costs only its own timeout.
void test("advice runs only for a passing view, and a hung one cannot fail it", async (t) => {
  const box = await makeViewBox();
  t.teardown(() => box.cleanup());
  await box.write("_content/inbox/Bad.bogus.card", "---\nstatus: new\n---\nno schema\n");
  await writeView(box, { rel: "list.tsx", content: INVALID_CARD_VIEW });
  const calls: string[] = [];
  const hung: AdviseRunner = ({ slug, boxRoot, env }) => {
    calls.push(slug);
    return runAdvice({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwd: boxRoot, env, timeoutMs: 1_000 });
  };
  t.check(await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS, advise: hung }), {
    ok: false,
    views: [{ slug: "list", ok: false, error: str`1 card(s) selected by dependencies failed to load:${any(String)}` }],
  });
  t.check(calls, []);

  // The hung runner adds its 1s timeout plus process start to a run with an
  // instant runner, and no more.
  const instant: AdviseRunner = () => Promise.resolve({ advice: [], partial: [] });
  const timedCheck = async (advise: AdviseRunner) => {
    const start = Date.now();
    const result = await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS, allowInvalidCards: true, advise });
    return { result, elapsedMs: Date.now() - start };
  };
  const baseline = await timedCheck(instant);
  const allowed = await timedCheck(hung);
  t.check(allowed.result, { ok: true, views: [{ slug: "list", ok: true, partial: ["advice not checked: timed out after 1s"] }] });
  t.check(calls, ["list"]);
  t.check(allowed.elapsedMs - baseline.elapsedMs, any(Number).below(1_000 + 4_000));
});

void test("a crashing advise runner leaves the view passing, with a remark", async (t) => {
  const box = await makeViewBox();
  t.teardown(() => box.cleanup());
  await writeView(box, { rel: "good.tsx", content: GOOD_VIEW });
  const crashing: AdviseRunner = ({ boxRoot, env }) =>
    runAdvice({ command: process.execPath, args: ["-e", "throw new Error('advice broke')"], cwd: boxRoot, env, timeoutMs: 5_000 });
  t.check(await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS, advise: crashing }), {
    ok: true,
    views: [{ slug: "good", ok: true, partial: [str`advice not checked: ${any(String)}`] }],
  });
  const throwing: AdviseRunner = () => Promise.reject(new Error("runner threw"));
  t.check(await checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS, advise: throwing }), {
    ok: true,
    views: [{ slug: "good", ok: true, partial: ["advice not checked: runner threw"] }],
  });
});

// The snapshot directory is advice's, so its failures are remarks too: a
// directory that cannot be made (the view renders with no snapshot and gets
// no advice), one the render child cannot write into, and one that cannot be
// removed. None changes `ok`.
void test("snapshot directory failures leave the view passing, with a remark", async (t) => {
  const box = await makeViewBox();
  t.teardown(() => box.cleanup());
  await writeView(box, { rel: "good.tsx", content: GOOD_VIEW });
  const calls: string[] = [];
  const advise: AdviseRunner = ({ slug }) => {
    calls.push(slug);
    return Promise.resolve({ advice: [], partial: [] });
  };
  const failing = (what: string) => () => Promise.reject(new Error(`${what} failed`));
  const removed: string[] = [];
  const remove = (dir: string) => { removed.push(dir); return Promise.resolve(); };
  const check = (snapshotDirs: SnapshotDirs) => checkViews({ boxRoot: box.root, timeoutMs: TEST_VIEW_TIMEOUT_MS, advise, snapshotDirs });

  t.check(await check({ make: failing("mkdtemp"), remove }), {
    ok: true,
    views: [{ slug: "good", ok: true, partial: ["advice not checked: could not make the snapshot directory: mkdtemp failed"] }],
  });
  t.check([calls, removed], [[], []]);

  const missing = join(box.root, "no-such-dir");
  t.check(await check({ make: () => Promise.resolve(missing), remove }), {
    ok: true,
    views: [{ slug: "good", ok: true, partial: [str`advice not checked: could not write the snapshot: ENOENT: ${any(String)}`] }],
  });
  t.check([calls, removed], [[], [missing]]);

  const made = join(box.root, "snapshots");
  await mkdir(made);
  t.check(await check({ make: () => Promise.resolve(made), remove: failing("rm") }), {
    ok: true,
    views: [{ slug: "good", ok: true, partial: [`snapshot not removed: ${made}: rm failed`] }],
  });
  t.check(calls, ["good"]);
});

/** Resolves once `ready()` is true, checking every 50ms. */
async function until(ready: () => Promise<boolean>): Promise<void> {
  while (!(await ready())) await new Promise((resolve) => { setTimeout(resolve, 50); });
}

/** The pids of `parent`'s children whose command line contains `pattern`. */
function childPids(parent: number, pattern: string): Promise<number[]> {
  return new Promise((resolve) => {
    const ps = spawn("pgrep", ["-P", String(parent), "-f", pattern]);
    let out = "";
    ps.stdout.on("data", (d) => { out += String(d); });
    ps.on("close", () => { resolve(out.split("\n").filter((line) => line !== "").map(Number)); });
  });
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_e) {
    return false;
  }
}

// SIGTERM (or SIGINT) to `bbx view check` stops the render child and removes
// the snapshot directory before the sweep exits 128 + the signal number.
void test("a terminated sweep stops its child and removes the snapshot directory", async (t) => {
  const box = await makeViewBox();
  const tmp = await mkdtemp(join(tmpdir(), "bbx-view-check-signal-"));
  t.teardown(async () => {
    await rm(tmp, { recursive: true, force: true });
    await box.cleanup();
  });
  await writeView(box, { rel: "spin.tsx", content: `export const name = "Spin";
export const dependencies = [];
export const modes = ["page"];
export default function Spin() { for (;;) {} }
` });
  const sweep = spawn(join(PACKAGE_ROOT, "bin", "bbx"), ["view", "check", "--timeout", String(TEST_VIEW_TIMEOUT_MS)], {
    cwd: box.root,
    env: { ...process.env, TMPDIR: tmp },
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    sweep.on("close", (code, signal) => { resolve({ code, signal }); });
  });
  const pid = sweep.pid;
  if (pid === undefined) throw new Error("the sweep did not start");
  let renderChild: number | undefined;
  await until(async () => {
    [renderChild] = await childPids(pid, "render-one");
    return renderChild !== undefined && (await readdir(tmp)).some((name) => name.startsWith("bbx-view-check-"));
  });
  sweep.kill("SIGTERM");
  t.check(await exited, { code: 143, signal: null });
  const left = (await readdir(tmp)).filter((name) => name.startsWith("bbx-view-check-"));
  t.check([left, renderChild !== undefined && isRunning(renderChild)], [[], false]);
});
