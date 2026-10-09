/**
 * Audio-understanding bakeoff. Workflow and conventions: README.md.
 *
 *   node --import tsx research/audio-understanding-bakeoff/bakeoff.ts <command> [options]
 *
 *   check                                   validate corpus.json and the recordings
 *   run --out <dir> --models a,b [--repeats N] [--tasks g1,g2] [--concurrency N]
 *   judge --out <dir> [--tasks g1,g2 [--redo]] [--concurrency N]
 *   summarize --out <dir>
 */

import { join } from "node:path";
import { parseArgs } from "node:util";
import { checkCommand } from "./check.ts";
import { judgeCommand } from "./judge.ts";
import { loadEnv } from "./lib.ts";
import { runCommand } from "./run.ts";
import { summarizeCommand } from "./summarize.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    models: { type: "string" },
    repeats: { type: "string", default: "2" },
    tasks: { type: "string" },
    concurrency: { type: "string", default: "4" },
    redo: { type: "boolean", default: false },
  },
});
loadEnv();

function requireOut(): string {
  if (!values.out) throw new Error("--out <run directory> is required, e.g. research/audio-understanding-bakeoff/runs/2026-10-09");
  return values.out;
}

const command = positionals[0];
let ok: boolean;
switch (command) {
  case "check":
    ok = checkCommand();
    break;
  case "run":
    if (!values.models) throw new Error("--models is required");
    if (!checkCommand()) throw new Error("fix the corpus before running");
    ok = await runCommand({
      models: values.models.split(","),
      repeats: Number(values.repeats),
      out: join(requireOut(), "raw.json"),
      tasks: values.tasks?.split(","),
      concurrency: Number(values.concurrency),
    });
    break;
  case "judge":
    if (values.redo && !values.tasks) throw new Error("--redo needs --tasks, so a whole run is never re-judged by accident");
    ok = await judgeCommand({ run: requireOut(), concurrency: Number(values.concurrency), tasks: values.tasks?.split(","), redo: values.redo });
    break;
  case "summarize":
    ok = summarizeCommand({ run: requireOut() });
    break;
  default:
    throw new Error(`unknown command ${command ?? "(none)"}; see the header of bakeoff.ts`);
}
if (!ok) process.exitCode = 1;
