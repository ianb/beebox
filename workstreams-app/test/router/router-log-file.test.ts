// The durable router log: the pure rotation boundary, the append/rollover
// behaviour, and the two properties that keep an observability feature from
// becoming an outage — a write failure must not throw, and no sink at all must
// be a silent no-op rather than an error.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { log } from "../../src/router/router-config.js";
import {
  ROUTER_LOG_MAX_BYTES,
  routerLogPath,
  shouldRotate,
  startRouterLogFile,
  stopRouterLogFile,
  writeRouterLogLine,
} from "../../src/router/router-log-file.js";

/** The poll below gave up. Named so a failure reads as "the sink never wrote"
 *  rather than as an assertion about content. */
class LogNeverSettledError extends Error {
  constructor(readonly file: string, readonly lines: number) {
    super("the durable log never reached the expected line count");
    this.name = "LogNeverSettledError";
  }
}

async function tmpLogDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "router-log-"));
}

/**
 * Read the log back once it holds `lines` worth of content.
 *
 * The sink writes through a stream, so a fixed number of ticks is a timing
 * assumption that holds on an idle machine and fails inside a full suite run —
 * which is the machine state this whole workstream is about. Poll for the
 * expected line count instead, bounded so a genuine failure still fails.
 */
async function readWhenSettled(file: string, lines: number): Promise<string[]> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    const settled = text === "" ? [] : text.trimEnd().split("\n");
    if (settled.length >= lines) return settled;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new LogNeverSettledError(file, lines);
}

test("the rotation boundary rolls over only when the cap would be exceeded", () => {
  assert.equal(shouldRotate({ bytes: 0, incoming: 100, max: 100 }), false, "an empty file never rotates");
  assert.equal(shouldRotate({ bytes: 50, incoming: 50, max: 100 }), false, "landing exactly on the cap fits");
  assert.equal(shouldRotate({ bytes: 51, incoming: 50, max: 100 }), true);
  // A single line bigger than the whole cap still gets written, after a
  // rollover: dropping it would lose the outsized failure dump that is most
  // worth keeping.
  assert.equal(shouldRotate({ bytes: 1, incoming: 10_000, max: 100 }), true);
  assert.equal(shouldRotate({ bytes: 0, incoming: 10_000, max: 100 }), false);
});

test("the default cap is large enough to be a log and small enough to be bounded", () => {
  assert.equal(ROUTER_LOG_MAX_BYTES, 16 * 1024 * 1024);
});

test("writing without a sink installed is a no-op, not an error", () => {
  stopRouterLogFile();
  assert.equal(routerLogPath(), null);
  // This is the state every unit test and every pre-boot log call is in. It
  // must not throw and must not create a file in the developer's real state dir.
  assert.doesNotThrow(() => writeRouterLogLine("[router] before boot"));
});

test("log() tees the console line into the durable file", async (t) => {
  const dir = await tmpLogDir();
  t.after(async () => {
    stopRouterLogFile();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await startRouterLogFile(dir);
  assert.equal(routerLogPath(), path.join(dir, "router.log"));

  log("[main] startup failed in waitForHttp: vite/main did not respond");

  const [written] = await readWhenSettled(path.join(dir, "router.log"), 1);
  // The exact grep the originating issue reports as returning 0 today.
  assert.match(written ?? "", /^\[router \d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[main\] startup failed in waitForHttp/u);
});

test("an existing log is appended to, not truncated, across restarts", async (t) => {
  const dir = await tmpLogDir();
  t.after(async () => {
    stopRouterLogFile();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, "router.log");
  await startRouterLogFile(dir);
  writeRouterLogLine("first boot");
  await readWhenSettled(file, 1);
  stopRouterLogFile();

  await startRouterLogFile(dir);
  writeRouterLogLine("second boot");

  assert.deepEqual(await readWhenSettled(file, 2), ["first boot", "second boot"]);
});

test("crossing the cap rolls the log over exactly once", async (t) => {
  const dir = await tmpLogDir();
  t.after(async () => {
    stopRouterLogFile();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, "router.log");
  // Seed a file already at the cap, so one more line must roll it over. This is
  // why the boundary is a pure function: the real 16MB is never written here.
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, "x".repeat(ROUTER_LOG_MAX_BYTES));
  await startRouterLogFile(dir);

  writeRouterLogLine("the line that rolled it");

  assert.deepEqual(await readWhenSettled(file, 1), ["the line that rolled it"]);
  const rolled = await fs.readFile(`${file}.1`, "utf8");
  assert.equal(rolled.length, ROUTER_LOG_MAX_BYTES, "the previous contents moved aside intact");

  // The fresh file starts its byte count at zero, so the next ordinary line
  // appends rather than rolling again.
  writeRouterLogLine("and the next one");
  assert.deepEqual(await readWhenSettled(file, 2), ["the line that rolled it", "and the next one"]);
});

test("an unusable log directory warns once and leaves the console working", async (t) => {
  const dir = await tmpLogDir();
  // A FILE where the log directory should be: mkdir fails with ENOTDIR.
  const blocked = path.join(dir, "blocked");
  await fs.writeFile(blocked, "not a directory");
  const warnings: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]): void => {
    warnings.push(args.map(String).join(" "));
  };
  t.after(async () => {
    console.error = realError;
    stopRouterLogFile();
    await fs.rm(dir, { recursive: true, force: true });
  });

  await startRouterLogFile(blocked);
  assert.equal(routerLogPath(), null, "no sink is installed when the directory cannot be used");
  assert.equal(warnings.length, 1, "exactly one warning");
  assert.match(warnings[0] ?? "", /durable log unavailable, continuing on console only/u);

  // Silence after the first warning: a broken disk must not produce a torrent.
  assert.doesNotThrow(() => writeRouterLogLine("still fine"));
  assert.equal(warnings.length, 1);
});
