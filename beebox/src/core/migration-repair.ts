/** Bounded data repair; questions and Git receipts retain unfinished decisions. */
import { MIGRATION_REPAIR_DIRECTIVE } from "./migration-repair-policy.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { captureMigrationSnapshot, changedMigrationPaths } from "./migration-recovery.js";
import { createAgent } from "./agent/index.js";
import { cardFields, parseCardText } from "./card-io.js";
import { QuestionSchema, createTextQuestionTemplate } from "../schemas/question.js";
import { errnoCode } from "../lib/error-guards.js";
import { getBoxTimeISO } from "../lib/time.js";
import { withBoxGitLock } from "../lib/git-lock.js";

export { MIGRATION_REPAIR_DIRECTIVE } from "./migration-repair-policy.js";

class MigrationRepairUnavailableError extends Error {
  constructor(reason: string) { super(`Migration repair could not start: ${reason}`); this.name = "MigrationRepairUnavailableError"; }
}
const exec = promisify(execFile);
const directory = "_bookkeeping/questions";
const schemas = new Map([["question", QuestionSchema]]);
const outcome = z.object({ status: z.enum(["repaired", "needs-human", "failed"]), reason: z.string() });


async function question(boxRoot: string, file: string) {
  try {
    const content = await readFile(join(boxRoot, file), "utf8");
    return { content, fields: cardFields(parseCardText(content, { source: file, schemas }), QuestionSchema) };
  } catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
}

export async function migrationQuestions(boxRoot: string): Promise<string[]> {
  const names = await readdir(join(boxRoot, directory)).catch((error: unknown) => {
    if (errnoCode(error) === "ENOENT") return []; throw error;
  });
  const pending: string[] = [];
  for (const name of names.filter((entry) => entry.startsWith("Migration_") && entry.endsWith(".question.card"))) {
    const file = `${directory}/${name}`;
    if ((await question(boxRoot, file))?.fields.status !== "answered") pending.push(file);
  }
  return pending;
}

export function finishMigrationRepair(boxRoot: string, name: string): Promise<void> {
  return withBoxGitLock(boxRoot, async () => {
    await exec("git", ["update-ref", "-d", `refs/bbx/migrations/${name}/repair-started`], { cwd: boxRoot });
  });
}

/** One attempt's verdict, from the runner that can prove it, never from agent prose. */
interface AttemptOutcome { code: number; reason: string; sessionId?: string | undefined; failure?: string | undefined }

interface BoundedAttempt {
  boxRoot: string; name: string; recoveryRef: string; failure: string; code: number;
  signal?: AbortSignal | undefined;
  /** The directive of the question written when the attempt fails. */
  directive: string;
  /** Runs once under the receipt; `answer` is the boxholder's latest answered question, if any. */
  attempt: (answer: string) => Promise<AttemptOutcome>;
}

/**
 * At most one unfinished attempt per migration, ever, without a human answer.
 * An unanswered question returns at once; a receipt left by an attempt that
 * never finished writes the next question instead of running again; a failed
 * attempt writes the next question. Only a finished attempt clears the receipt.
 */
export async function runBoundedAttempt(opts: BoundedAttempt): Promise<{ code: number; question?: string | undefined; sessionId?: string | undefined }> {
  let attempt = 0;
  let answer = "";
  let file: string;
  for (;;) {
    file = `${directory}/Migration_${opts.name}-${String(attempt)}.question.card`;
    const existing = await question(opts.boxRoot, file);
    if (!existing) break;
    if (existing.fields.status !== "answered") return { code: opts.code, question: file };
    answer = `Previous answered question (${file}):\n${existing.content}`;
    attempt += 1;
  }
  const receipt = `refs/bbx/migrations/${opts.name}/repair-started`;
  const refs = await exec("git", ["for-each-ref", "--format=%(refname)", receipt], { cwd: opts.boxRoot });
  let reason = "The previous attempt did not reach a verified committed result. Inspect its Git recovery and partial output before authorizing another attempt.";
  let { failure } = opts;
  let sessionId: string | undefined;
  let code = opts.code;
  if (!refs.stdout.trim()) {
    await withBoxGitLock(opts.boxRoot, async () => {
      await exec("git", ["update-ref", receipt, opts.recoveryRef], { cwd: opts.boxRoot });
    });
    opts.signal?.throwIfAborted();
    const attempted = await opts.attempt(answer);
    opts.signal?.throwIfAborted();
    sessionId = attempted.sessionId;
    code = attempted.code;
    if (code === 0) return { code, sessionId };
    reason = attempted.reason;
    failure = attempted.failure ?? failure;
  }
  const content = createTextQuestionTemplate({
    memo: `Migration ${opts.name} needs attention`, askedAt: getBoxTimeISO(opts.boxRoot),
    prompt: `${reason}\nMigration: ${opts.name}\nRecovery: ${opts.recoveryRef}\n${failure}`,
    directive: opts.directive,
  });
  cardFields(parseCardText(content, { source: file, schemas }), QuestionSchema);
  await mkdir(join(opts.boxRoot, directory), { recursive: true });
  await writeFile(join(opts.boxRoot, file), content, { flag: "wx" });
  return { code, question: file, sessionId };
}

/** Retry is supplied by the deterministic runner, never inferred from agent prose. */
export function repairMigration(opts: {
  boxRoot: string; name: string; recoveryRef: string; failure: string; code: number;
  signal?: AbortSignal | undefined;
  retry: () => Promise<number>; agent?: ReturnType<typeof createAgent> | undefined;
}): ReturnType<typeof runBoundedAttempt> {
  return runBoundedAttempt({
    ...opts,
    directive: `Inspect the migration manifest. If ${opts.name} is recorded, repair the affected cards against the current schema using this answer; never replay its old script. Otherwise this answer authorizes one bounded migration repair attempt. ${MIGRATION_REPAIR_DIRECTIVE}`,
    attempt: async (answer) => {
      const beforeAgent = await captureMigrationSnapshot(opts.boxRoot, opts.name);
      const agent = opts.agent ?? createAgent({ name: "migration-repair", onOutput: (text) => process.stderr.write(text) });
      const result = await agent.invokeStructured(outcome, {
        signal: opts.signal,
        boxRoot: opts.boxRoot, maxTurns: 12, systemPrompt: MIGRATION_REPAIR_DIRECTIVE,
        prompt: `Migration: ${opts.name}\nRecovery: ${opts.recoveryRef}\nFailure:\n${opts.failure}\n${answer}`,
      });
      opts.signal?.throwIfAborted();
      if (!result.success && result.invocationFailure && (await changedMigrationPaths(opts.boxRoot, beforeAgent)).length === 0) {
        await finishMigrationRepair(opts.boxRoot, opts.name);
        throw new MigrationRepairUnavailableError(result.error);
      }
      const code = await opts.retry();
      return { code, sessionId: result.sessionId, reason: result.success ? result.data.reason : result.error };
    },
  });
}

/** A procedure migration run by the unattended sweep: one run per human answer. */
export function runProcedureMigration(opts: {
  boxRoot: string; name: string; recoveryRef: string; signal?: AbortSignal | undefined;
  run: () => Promise<number>; output: () => string;
}): ReturnType<typeof runBoundedAttempt> {
  return runBoundedAttempt({
    boxRoot: opts.boxRoot, name: opts.name, recoveryRef: opts.recoveryRef, signal: opts.signal, code: 1, failure: "",
    directive: `Migration ${opts.name} is a procedure that an agent applies. Its last run failed; the output is in this question. Fix what blocked it, then answer: the answer authorizes the next scheduled pass to run the procedure once more.`,
    attempt: async () => ({ code: await opts.run(), reason: "The procedure exited nonzero; its output follows.", failure: opts.output() }),
  });
}
