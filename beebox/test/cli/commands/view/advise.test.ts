// # `runAdvice`: the advise child under its own timeout
//
// `bbx view check` runs advice in a child after a view has passed. Whatever
// that child does (hangs, crashes, prints junk), `runAdvice` resolves with
// advice and remarks, within its timeout. These tests run real processes and
// time them (docs/implemented-plans/box-view-guidance-and-checks.md, Track 3,
// "Advisory-only guarantee").

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, containing, eventually } from "@ianbicking/tap-check/check";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runAdvice } from "../../../../src/cli/commands/view/advise.js";
import { ADVICE_PREFIX } from "../../../../src/cli/commands/view/check-states.js";

const PKG = process.cwd();
const TIMEOUT_MS = 500;
/** Room for process start and teardown on a loaded machine. */
const MARGIN_MS = 4_000;

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const start = Date.now();
  const value = await work();
  return { value, elapsedMs: Date.now() - start };
}

/** `runAdvice` on `node -e <script>`. */
function runNode(script: string) {
  return timed(() => runAdvice({ command: process.execPath, args: ["-e", script], cwd: PKG, env: process.env, timeoutMs: TIMEOUT_MS }));
}

void test("a hung advise child is killed at the timeout and becomes a remark", async (t) => {
  t.check(await runNode("setInterval(() => {}, 1000)"), {
    value: { advice: [], partial: ["advice not checked: timed out after 0.5s"] },
    elapsedMs: any(Number).between(TIMEOUT_MS, TIMEOUT_MS + MARGIN_MS),
  });
});

void test("a crashing advise child gives its first stderr line", async (t) => {
  t.check(await runNode("console.error('Cannot parse views/v.tsx\\n  at x'); process.exit(3)"), {
    value: { advice: [], partial: ["advice not checked: Cannot parse views/v.tsx"] },
    elapsedMs: any(Number).below(MARGIN_MS),
  });
  t.check((await runNode("process.exit(2)")).value, { advice: [], partial: ["advice not checked: exited with code 2"] });
});

// A line with the advice prefix that is not advice is reported, and the
// readable advice is kept.
void test("unreadable advice lines become one remark", async (t) => {
  const good = JSON.stringify({ rule: "utc-today", message: "m", where: ["views/v.tsx:1"] });
  const lines = [`${ADVICE_PREFIX}${good}`, `${ADVICE_PREFIX}{not json`, `${ADVICE_PREFIX}{"rule":"made-up","message":"m","where":[]}`, "a view's own log line"];
  t.check((await runNode(`console.log(${JSON.stringify(lines.join("\n"))})`)).value, {
    advice: [{ rule: "utc-today", message: "m", where: ["views/v.tsx:1"] }],
    partial: ["advice not checked: unreadable output"],
  });
});

// The source parser is a Go process on a pipe; killing the advise child
// closes the pipe, and the Go process exits with it.
void test("killing the advise child takes the parser process with it", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "advise-kill-"));
  t.teardown(() => rm(dir, { recursive: true, force: true }));
  const pidsFile = join(dir, "pids.txt");
  const script = join(dir, "hold-parser.ts");
  await writeFile(script, `import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createParser } from ${JSON.stringify(join(PKG, "src/lib/typescript/syntax.ts"))};
const parser = createParser();
parser.parse({ fileName: "v.tsx", sourceText: "<p />" });
const children = execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="]).toString().split("\\n")
  .map((line) => line.trim().split(/\\s+/)).filter(([, ppid, comm]) => ppid === String(process.pid) && comm !== "ps");
writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify(children.map(([pid, , comm]) => ({ pid: Number(pid), name: comm.split("/").at(-1) }))));
setInterval(() => {}, 1000);
`);
  const outcome = await runAdvice({ command: process.execPath, args: ["--import", "tsx", script], cwd: PKG, env: process.env, timeoutMs: 3_000 });
  t.check(outcome, { advice: [], partial: ["advice not checked: timed out after 3s"] });
  const children: unknown = JSON.parse(await readFile(pidsFile, "utf-8"));
  const parsed = z.array(z.object({ pid: z.number(), name: z.string() })).parse(children);
  // The parser's process is the TypeScript 7 binary, `tsc` (tsx's esbuild is another child).
  t.check(parsed, containing([{ pid: any(Number).int().positive(), name: "tsc" }]));
  const pids = parsed.map((c) => c.pid);
  const alive = (pid: number) => {
    try {
      execFileSync("kill", ["-0", String(pid)], { stdio: "ignore" });
      return true;
    } catch (_e) {
      return false;
    }
  };
  t.check(await eventually(() => pids.every((pid) => !alive(pid)), { label: "the parser process exited" }), true);
});

// An abort (Ctrl-C on `bbx view check`) raises "error" before the child has
// exited. `runAdvice` resolves only after the child is gone, so the caller can
// remove the snapshot directory without a live child still reading it.
void test("an aborted advise child has exited when runAdvice resolves", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bbx-advise-abort-"));
  t.teardown(() => rm(dir, { recursive: true, force: true }));
  const pidFile = join(dir, "pid");
  const controller = new AbortController();
  const outcome = runAdvice({
    command: process.execPath,
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`],
    cwd: PKG, env: process.env, timeoutMs: 30_000, signal: controller.signal,
  });
  const pid = await eventually(async () => Number(await readFile(pidFile, "utf8")), { label: "the child wrote its pid" });
  controller.abort();
  const resolved = await outcome;
  const alive = (() => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      // ESRCH: no such process. Anything else is a real failure.
      if (e instanceof Error && "code" in e && e.code === "ESRCH") return false;
      throw e;
    }
  })();
  t.check({ resolved, alive }, { resolved: { advice: [], partial: ["advice not checked: The operation was aborted"] }, alive: false });
});
