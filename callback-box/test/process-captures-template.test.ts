/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Guards the `process-captures` procedure template's shell prechecks against
 * the current (frontmatter + `.attach/` scope) capture layout.
 *
 * Regression: the prechecks once assumed the old XML/flat-directory model
 * (session card + child cards as siblings inside a `box/inbox/capture-<id>/`
 * directory). Under the frontmatter model the session card is a flat inbox
 * file and its children live in `{basename}.attach/`, so the old `assemble`
 * precheck ran `ls "$dir"*.capture-session.card` against an attach dir with no
 * session card — under `set -euo pipefail` that failed the precheck with exit
 * 2 and accreted a failed run dir every scheduler tick. These tests assert the
 * prechecks skip (exit $CHECK_SKIP) or run (exit 0) correctly and never fail.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { test } from "tap";
import { loadProcedureDefinition } from "../src/core/procedure/engine-parse.js";
import { CHECK_SKIP_CODE } from "../src/core/procedure/shell.js";

const TEMPLATE = "templates/procedures/process-captures.procedure.card";
const STEP_IDS = [
  "transcribe",
  "describe-images",
  "summarize",
  "assemble",
  "plan-extraction",
  "extract",
  "archive",
] as const;
type StepId = (typeof STEP_IDS)[number];

export class MissingPrecheckShellError extends Error {
  constructor() {
    super("procedure step has no precheck shell");
    this.name = "MissingPrecheckShellError";
  }
}

interface Box {
  root: string;
  put: (relPath: string, content: string) => Promise<void>;
}

async function makeBox(): Promise<Box> {
  const root = await mkdtemp(join(tmpdir(), "process-captures-"));
  await mkdir(join(root, "box/inbox"), { recursive: true });
  const put = async (relPath: string, content: string): Promise<void> => {
    const abs = join(root, relPath);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  };
  return { root, put };
}

/** Run one step's precheck shell in `boxRoot`, exactly as the engine would. */
async function runPrecheck(boxRoot: string, stepId: StepId): Promise<number> {
  const proc = await loadProcedureDefinition(TEMPLATE);
  const step = proc.steps.find((s) => s.id === stepId);
  const shell = step?.precheck?.shells?.[0];
  if (shell === undefined) throw new MissingPrecheckShellError();
  const res = await execa("bash", ["-c", `set -euo pipefail\n${shell}`], {
    cwd: boxRoot,
    env: { ...process.env, CHECK_SKIP: String(CHECK_SKIP_CODE) },
    reject: false,
  });
  return typeof res.exitCode === "number" ? res.exitCode : -1;
}

test("empty inbox: every precheck skips cleanly (never a hard failure)", async (t) => {
  const { root } = await makeBox();
  t.teardown(() => rm(root, { recursive: true, force: true }));
  for (const stepId of STEP_IDS) {
    t.equal(await runPrecheck(root, stepId), CHECK_SKIP_CODE, `${stepId} skips on empty inbox`);
  }
});

test("fresh capture (audio+image status:new): transcribe & describe-images run, rest skip", async (t) => {
  const { root, put } = await makeBox();
  t.teardown(() => rm(root, { recursive: true, force: true }));
  const base = "capture-20260703T1300-New";
  const attach = `box/inbox/${base}.attach`;
  await put(`box/inbox/${base}.capture-session.card`,
    "---\nstatus: new\nsession-id: n\ntime:\n  start: 2026-07-03T13:00:00Z\n---\n");
  await put(`${attach}/audio-001.audio.card`,
    "---\nstatus: new\nfilename:\n  ref: attach/audio-001.webm\n  recorded: 2026-07-03T13:00:00Z\n  source: capture\n---\n");
  await put(`${attach}/photo-001.image.card`,
    "---\nstatus: new\nfilename:\n  ref: attach/photo-001.jpg\n  captured: 2026-07-03T13:00:02Z\n---\n");

  const cases: Array<[StepId, number]> = [
    ["transcribe", 0],
    ["describe-images", 0],
    ["summarize", CHECK_SKIP_CODE],
    ["assemble", CHECK_SKIP_CODE],
    ["plan-extraction", CHECK_SKIP_CODE],
    ["extract", CHECK_SKIP_CODE],
    ["archive", CHECK_SKIP_CODE],
  ];
  for (const [stepId, code] of cases) {
    t.equal(await runPrecheck(root, stepId), code, `${stepId} precheck`);
  }
});

test("session ready for assembly: assemble runs (exit 0), never exit 2", async (t) => {
  // This is the exact shape that made the old XML precheck exit 2: a session
  // card at inbox level with transcribed audio + analyzed image in `.attach/`
  // and an empty (un-assembled) transcript body.
  const { root, put } = await makeBox();
  t.teardown(() => rm(root, { recursive: true, force: true }));
  const base = "capture-20260703T1200-Ready";
  const attach = `box/inbox/${base}.attach`;
  await put(`box/inbox/${base}.capture-session.card`,
    "---\nstatus: transcribed\nsession-id: r\ntime:\n  start: 2026-07-03T12:00:00Z\n---\n");
  await put(`${attach}/audio-001.audio.card`,
    "---\nstatus: transcribed\nfilename:\n  ref: attach/audio-001.webm\n  recorded: 2026-07-03T12:00:00Z\n  source: capture\nsummary: A clip.\ntranscript: Hello.\n---\n");
  await put(`${attach}/photo-001.image.card`,
    "---\nstatus: analyzed\nfilename:\n  ref: attach/photo-001.jpg\n  captured: 2026-07-03T12:00:02Z\ndescription: A whiteboard.\n---\n");

  const assembleCode = await runPrecheck(root, "assemble");
  t.equal(assembleCode, 0, "assemble precheck runs (found a ready session)");
  t.not(assembleCode, 2, "assemble precheck does NOT exit 2 (the accretion bug)");
  const others: StepId[] = ["transcribe", "describe-images", "summarize", "plan-extraction", "extract", "archive"];
  for (const stepId of others) {
    t.equal(await runPrecheck(root, stepId), CHECK_SKIP_CODE, `${stepId} skips`);
  }
});

test("assembled session (non-empty body): plan-extraction runs", async (t) => {
  const { root, put } = await makeBox();
  t.teardown(() => rm(root, { recursive: true, force: true }));
  const base = "capture-20260703T1500-Asm";
  await put(`box/inbox/${base}.capture-session.card`,
    "---\nstatus: transcribed\nsession-id: a\n---\nSpoke about the plan.\n\n{% image ref=\"photo-001.image.card\" /%}\n");
  await put(`box/inbox/${base}.attach/photo-001.image.card`,
    "---\nstatus: analyzed\nfilename:\n  ref: attach/photo-001.jpg\n  captured: 2026-07-03T15:00:02Z\ndescription: A whiteboard.\n---\n");
  t.equal(await runPrecheck(root, "plan-extraction"), 0, "plan-extraction runs on assembled body");
  t.equal(await runPrecheck(root, "assemble"), CHECK_SKIP_CODE, "assemble skips (already assembled)");
});

test("file-only session: assemble skips, plan-extraction runs", async (t) => {
  const { root, put } = await makeBox();
  t.teardown(() => rm(root, { recursive: true, force: true }));
  const base = "capture-20260703T1600-Files";
  const attach = `box/inbox/${base}.attach`;
  await put(`box/inbox/${base}.capture-session.card`,
    "---\nstatus: new\nsession-id: f\nfiles:\n  - attach/file-001-Tax.file.card\n---\n");
  await put(`${attach}/file-001-Tax.file.card`,
    "---\nstatus: new\nfilename:\n  ref: attach/file-001-Tax.pdf\n  original-name: Tax.pdf\n  mime-type: application/pdf\n---\n");
  t.equal(await runPrecheck(root, "assemble"), CHECK_SKIP_CODE, "assemble skips file-only session");
  t.equal(await runPrecheck(root, "plan-extraction"), 0, "plan-extraction runs on file-only session");
});
