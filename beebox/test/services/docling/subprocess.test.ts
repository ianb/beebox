// # Docling driver: request, locks, and how a run ended
//
// `services/docling/subprocess.ts` builds the driver's request and argv and
// names how a run ended; `convert.py` takes the conversion locks. Memory
// measurements and the reasons for each choice are D18 in
// `docs/plans/scanner-ingest-docling-decisions.md`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { anything, containing, others } from "@ianbicking/tap-check/check";
import { execa } from "execa";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { doclingRequest } from "../../../src/services/docling/core.js";
import {
  classifyDoclingExit,
  conversionBudgetSeconds,
  DOCLING_DRIVER_PATH,
  doclingArgs,
  doclingFailureMessage,
  doclingLockPaths,
  driverReason,
  parseOomKills,
  type DoclingExitFacts,
} from "../../../src/services/docling/subprocess.js";
import { DOCLING_VERSION } from "../../../src/services/docling/version.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

// ## Lock paths
//
// The box lock lives under `HOME`, which is per box on a hosted host. The host
// lock lives in the shared uv cache when one is configured; without one the box
// lock is the only lock. The two never name the same file.
void test("The box lock lives under HOME; the host lock in the shared uv cache when set", (t) => {
  t.check(doclingLockPaths({ UV_CACHE_DIR: "/var/cache/beebox/uv" }, "/var/lib/beebox/a"), [
    "/var/lib/beebox/a/.cache/bbx-docling.lock",
    "/var/cache/beebox/uv/bbx-docling.lock",
  ]);
  t.check(doclingLockPaths({}, "/Users/me"), ["/Users/me/.cache/bbx-docling.lock"]);
  t.check(doclingLockPaths({ UV_CACHE_DIR: "" }, "/Users/me"), ["/Users/me/.cache/bbx-docling.lock"]);
  t.check(doclingLockPaths({ UV_CACHE_DIR: "/Users/me/.cache" }, "/Users/me"), ["/Users/me/.cache/bbx-docling.lock"]);
  t.end();
});

// ## The request and argv
//
// Languages travel only with OCR on, where they mean something. The argv runs
// the driver with an isolated interpreter at the pinned version, with the OCR
// engine in uv's throwaway environment.
void test("The request carries OCR intent, locks, and the parent PID; the argv runs the driver", (t) => {
  const context = { pages: 12, env: { UV_CACHE_DIR: "/cache/uv" }, homeDir: "/var/lib/beebox/box", parentPid: 4242 };
  const request = doclingRequest("/scan/source.pdf", { workDir: "/work", ocr: "replace", languages: ["en", "de"], ...context });
  t.check(request, {
    source: "/scan/source.pdf",
    outputDir: "/work",
    ocr: "replace",
    languages: ["en", "de"],
    // 5 minutes plus 30 s for each of 12 OCR pages.
    documentTimeoutSeconds: 660,
    lockPaths: ["/var/lib/beebox/box/.cache/bbx-docling.lock", "/cache/uv/bbx-docling.lock"],
    lockWaitSeconds: 5400,
    parentPid: 4242,
  });
  t.check(doclingRequest("/scan/source.pdf", { workDir: "/work", ocr: "off", languages: ["en"], ...context }).languages, null);

  const argv = doclingArgs(request);
  t.check(argv.slice(0, -1), [
    "--from", `docling==${DOCLING_VERSION}`,
    "--with", "onnxruntime",
    "--with", "rapidocr",
    "python", "-I", DOCLING_DRIVER_PATH,
  ]);
  t.check(JSON.parse(argv.at(-1) ?? "null"), request);
  t.end();
});

// ## Conversion budget
//
// Docling's budget is 5 minutes plus a per-page allowance, more with OCR,
// capped at 90 minutes; an unknown page count gets the cap. The two prod
// documents a flat 10 minutes stopped (333 and 84 pages, no OCR) now get 60
// and 19 minutes.
void test("The conversion budget scales with pages and OCR, up to 90 minutes", (t) => {
  const cases: Array<[number | null, "off" | "regions"]> = [[1, "off"], [84, "off"], [333, "off"], [16, "regions"], [400, "regions"], [null, "off"]];
  t.check(cases.map(([pages, ocr]) => [pages, ocr, conversionBudgetSeconds(pages, ocr) / 60]), [
    [1, "off", 5 + 1 / 6],
    [84, "off", 19],
    [333, "off", 60.5],
    [16, "regions", 13],
    [400, "regions", 90],
    [null, "off", 90],
  ]);
  t.end();
});

// ## The driver ships with the package
void test("convert.py is a package file, so a published install can run it", async (t) => {
  const pkg: unknown = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, "package.json"), "utf-8"));
  t.check(path.relative(PACKAGE_ROOT, DOCLING_DRIVER_PATH), "src/services/docling/convert.py");
  t.check(pkg, { files: containing(["src/services/docling/convert.py"]), [others]: anything() });
  t.end();
});

// ## How a run ended
//
// SIGKILL (or `uv`'s 137 for a SIGKILLed child) is an out-of-memory kill only
// when this cgroup's `oom_kill` counter rose; without that evidence it is a
// kill of unknown cause. Our own timeout wins over everything, because we sent
// that kill ourselves.
void test("A run's end is classified by our timeout, the signal, and OOM evidence", (t) => {
  const facts = (over: Partial<DoclingExitFacts>): DoclingExitFacts => ({
    exitCode: 0, signal: undefined, timedOut: null, oomKillsBefore: 3, oomKillsAfter: 3, ...over,
  });
  const cases: Array<[string, DoclingExitFacts]> = [
    ["clean exit", facts({})],
    ["our budget fired while converting", facts({ exitCode: undefined, signal: "SIGTERM", timedOut: "converting" })],
    ["our budget fired while waiting", facts({ exitCode: undefined, signal: "SIGTERM", timedOut: "waiting" })],
    ["lock wait ran out", facts({ exitCode: 75 })],
    ["uv reports a SIGKILLed child, counter rose", facts({ exitCode: 137, oomKillsAfter: 4 })],
    ["SIGKILL, counter rose", facts({ exitCode: undefined, signal: "SIGKILL", oomKillsAfter: 4 })],
    ["SIGKILL, counter unchanged", facts({ exitCode: 137 })],
    ["SIGKILL, no counter (macOS)", facts({ exitCode: 137, oomKillsBefore: null, oomKillsAfter: null })],
    ["driver failure", facts({ exitCode: 1 })],
  ];
  t.check(cases.map(([name, input]) => [name, classifyDoclingExit(input)]), [
    ["clean exit", { kind: "ok" }],
    ["our budget fired while converting", { kind: "timeout", phase: "converting" }],
    ["our budget fired while waiting", { kind: "timeout", phase: "waiting" }],
    ["lock wait ran out", { kind: "busy" }],
    ["uv reports a SIGKILLed child, counter rose", { kind: "oom" }],
    ["SIGKILL, counter rose", { kind: "oom" }],
    ["SIGKILL, counter unchanged", { kind: "killed" }],
    ["SIGKILL, no counter (macOS)", { kind: "killed" }],
    ["driver failure", { kind: "failed", exitCode: 1 }],
  ]);
  t.end();
});

// ## What the card says
//
// Busy and memory failures tell the agent not to retry in parallel; a driver
// failure carries the driver's own reason, not the model-loading noise around it.
void test("Failure messages name the cause and what not to do", (t) => {
  const budgets = { waitMinutes: 25, convertMinutes: 10 };
  t.check(doclingFailureMessage({ outcome: { kind: "busy" }, budgets, detail: "" }), "Another Docling conversion on this box or host ran for over 90 minutes; this PDF was not converted. Retry later, one at a time.");
  t.check(doclingFailureMessage({ outcome: { kind: "oom" }, budgets, detail: "" }), "Docling was killed during an out-of-memory event in this box. Do not retry in parallel; retry once when nothing else is converting, or use a smaller PDF.");
  t.check(doclingFailureMessage({ outcome: { kind: "timeout", phase: "converting" }, budgets, detail: "" }), "Docling did not finish within 10 minutes and was stopped");
  t.check(doclingFailureMessage({ outcome: { kind: "timeout", phase: "waiting" }, budgets, detail: "" }), "Docling did not start converting within 25 minutes and was stopped");
  t.check(doclingFailureMessage({ outcome: { kind: "failed", exitCode: 1 }, budgets, detail: "conversion ended with status failure: bad xref" }), "Docling exited 1: conversion ended with status failure: bad xref");

  const tail = "bbx-docling: waiting for another Docling conversion to finish\nbbx-docling: lock acquired\nwarning: something\nbbx-docling: error: conversion ended with status failure: bad xref\n";
  t.check(driverReason(tail), "conversion ended with status failure: bad xref");
  // A waiting line is progress, not the reason a later step failed.
  t.check(driverReason("bbx-docling: waiting for another Docling conversion to finish\nbbx-docling: lock acquired\nTraceback ..."), null);
  t.end();
});

// ## Reading the cgroup's OOM counter
void test("oom_kill is read from a cgroup memory.events file", (t) => {
  t.check(parseOomKills("low 0\nhigh 12\nmax 491\noom 1\noom_kill 2\noom_group_kill 0\n"), 2);
  t.check(parseOomKills("low 0\n"), null);
  t.end();
});

// ## The driver's locks, run for real
//
// The locks are taken before Docling is imported, so any `python3` exercises
// them. A second driver waits while another process holds the lock and gives
// up with exit 75 when its wait runs out; once the holder is gone it proceeds.
// A driver whose parent is gone stops within a few seconds. Skipped, loudly,
// without a `python3`.
/** Resolves once the holder has printed `held`, which it does after taking the lock. */
async function heldBy(holder: ReturnType<typeof execa>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    holder.stdout?.once("data", () => resolve());
    holder.once("error", reject);
  });
}

const python = await execa("python3", ["--version"], { reject: false }).catch(() => null);
const pythonSkip = python?.exitCode === 0 ? null : "python3 is not available";
if (pythonSkip !== null) console.warn(`[skipped] docling driver locks: ${pythonSkip}`);

void test("A held lock makes the driver wait, then give up with exit 75; a free one lets it through", { skip: pythonSkip ?? false }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docling-lock-"));
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, "host", "bbx-docling.lock");
  await fs.mkdir(path.dirname(lockPath));
  const request = (over: Record<string, unknown>) => JSON.stringify({
    source: path.join(dir, "missing.pdf"), outputDir: dir, ocr: "off", languages: null, documentTimeoutSeconds: 10,
    lockPaths: [path.join(dir, "box.lock"), lockPath], lockWaitSeconds: 1, parentPid: 0, ...over,
  });

  const holder = execa("python3", ["-I", "-c", "import fcntl,sys,time\nf=open(sys.argv[1],'a')\nfcntl.flock(f, fcntl.LOCK_EX)\nprint('held', flush=True)\ntime.sleep(30)", lockPath]);
  await heldBy(holder);
  const blocked = await execa("python3", ["-I", DOCLING_DRIVER_PATH, request({})], { reject: false });
  holder.kill();
  await holder.catch(() => null);
  const free = await execa("python3", ["-I", DOCLING_DRIVER_PATH, request({})], { reject: false });

  t.check(blocked.exitCode, 75);
  t.check(driverReason(blocked.stderr), `another Docling conversion held ${lockPath} for over 1 seconds`);
  // Through the locks; it then fails importing Docling, which this python3 lacks.
  t.check(free.stderr.split("\n")[0], "bbx-docling: lock acquired");
});

void test("A driver whose parent is gone stops with exit 70", { skip: pythonSkip ?? false }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docling-orphan-"));
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, "bbx-docling.lock");
  const gone = await execa("python3", ["-I", "-c", "import os; print(os.getpid())"]);
  const deadPid = Number(gone.stdout.trim());
  const holder = execa("python3", ["-I", "-c", "import fcntl,sys,time\nf=open(sys.argv[1],'a')\nfcntl.flock(f, fcntl.LOCK_EX)\nprint('held', flush=True)\ntime.sleep(30)", lockPath]);
  await heldBy(holder);
  // It would wait 60 s for the lock; the parent check ends it first. Its
  // stderr reader is gone, as it is when the parent dies: the stop message
  // then cannot be written, and the driver must still stop.
  const orphanRun = execa("python3", ["-I", DOCLING_DRIVER_PATH, JSON.stringify({
    source: "x.pdf", outputDir: dir, ocr: "off", languages: null, documentTimeoutSeconds: 10,
    lockPaths: [lockPath], lockWaitSeconds: 60, parentPid: deadPid,
  })], { reject: false, timeout: 20_000, stdout: "ignore" });
  orphanRun.stderr?.destroy();
  const orphan = await orphanRun;
  holder.kill();
  await holder.catch(() => null);
  t.check(orphan.exitCode, 70);
});
