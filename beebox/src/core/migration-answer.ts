/** Human recovery answers are the sole question write allowed while fenced. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { acquireBoxMaintenance, boxMaintenanceStatus } from "../lib/box-maintenance.js";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { getBoxTimeISO } from "../lib/time.js";
import { cardFields, parseCardText } from "./card-io.js";
import { QuestionSchema } from "../schemas/question.js";
import { renderFrontmatterBlock, splitCardContent } from "../cards/index.js";
import { readManifest, computePending } from "./migration-run.js";
import { captureMigrationSnapshot } from "./migration-recovery.js";
import type { CommandResult } from "./command-runner.js";

const exec = promisify(execFile);
const schemas = new Map([["question", QuestionSchema]]);

export async function answerFencedMigrationQuestion(opts: {
  boxRoot: string; question: string; answer?: string | undefined; via: "web" | "cli";
}): Promise<CommandResult | null> {
  if (!(await boxMaintenanceStatus(opts.boxRoot))) return null;
  const file = relative(opts.boxRoot, isAbsolute(opts.question) ? opts.question : join(opts.boxRoot, opts.question));
  const name = /^_bookkeeping\/questions\/Migration_([\w-]+)-\d+\.question\.card$/.exec(file)?.[1];
  if (!name) return null;
  const owner = await acquireBoxMaintenance(opts.boxRoot, { reason: `Answer migration ${name}`, recover: true });
  try {
    await owner.beginChanges();
    return await owner.run(async () => {
      const manifest = await readManifest(opts.boxRoot);
      if (manifest === null || !computePending(manifest).some((migration) => migration.name === name)) {
        return { success: false, error: "This migration is already applied; answer after the box reopens so its follow-up can run" };
      }
      const fullPath = join(opts.boxRoot, file);
      // A question-shaped symlink must not become an arbitrary write escape.
      if (await realpath(fullPath) !== join(await realpath(opts.boxRoot), file)) {
        return { success: false, error: "Migration question must be a regular box file" };
      }
      const content = await readFile(fullPath, "utf8");
      const fields = cardFields(parseCardText(content, { source: file, schemas }), QuestionSchema);
      const recoveryRef = /^Recovery: (refs\/bbx\/migrations\/\S+)$/m.exec(fields.prompt)?.[1];
      if (!fields.prompt.includes(`Migration: ${name}\n`) || !recoveryRef?.startsWith(`refs/bbx/migrations/${name}/`)) {
        return { success: false, error: "Not a migration recovery question" };
      }
      await exec("git", ["show-ref", "--verify", "--quiet", recoveryRef], { cwd: opts.boxRoot });
      if (fields.status === "answered") return { success: false, error: "Question is already answered" };
      if (fields.input.type !== "text" || !opts.answer) return { success: false, error: "Migration recovery requires a text answer" };
      fields.status = "answered";
      fields.answer = { text: opts.answer };
      fields["answered-at"] = getBoxTimeISO(opts.boxRoot);
      fields["answered-via"] = opts.via;
      delete fields["dismissed-at"];
      delete fields["expired-at"];
      await writeFileAtomic(fullPath, { content: renderFrontmatterBlock(fields, splitCardContent(content).body) });
      // The box may still fail validation. Record Git recovery without running
      // a generic follow-up job or pretending the failed migration is current.
      const snapshot = await captureMigrationSnapshot(opts.boxRoot, name);
      return { success: true, data: { path: file, recoveryRef: snapshot.ref, pendingMigrationRecovery: true } };
    });
  } finally { await owner.release(); }
}
