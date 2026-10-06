/** Resolve template updates parked by the installer. */
import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { readTemplateUpdate, resolveTemplateUpdate } from "../../core/template-update.js";

export const templateCommand = new Command("template")
  .description("Inspect and resolve parked template updates");

async function unifiedDiff({ before, after, leftLabel, rightLabel }: { before: string; after: string; leftLabel: string; rightLabel: string }): Promise<string> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-template-diff-"));
  const left = path.join(temp, "before");
  const right = path.join(temp, "after");
  try {
    await Promise.all([fs.writeFile(left, before), fs.writeFile(right, after)]);
    try {
      await promisify(execFile)("git", ["diff", "--no-index", "--", left, right]);
      return "(identical)";
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && error.code === 1 && "stdout" in error && typeof error.stdout === "string") {
        return error.stdout.replaceAll(left, leftLabel).replaceAll(right, rightLabel).trimEnd();
      }
      throw error;
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

templateCommand.command("diff")
  .description("Show the local, parked, and last-stock versions")
  .argument("<path>", "box-relative path reported by bbx status")
  .action(async (relPath: string) => {
    const update = await readTemplateUpdate(await requireBoxRoot(), relPath);
    console.log(`Last stock hash: ${update.stockHash ?? "untracked"}`);
    if (update.stock === null) {
      console.log("Exact last stock unavailable: this version predates snapshot tracking.");
      console.log(`Local vs parked upstream:\n${await unifiedDiff({ before: update.local, after: update.parked, leftLabel: "local", rightLabel: "parked upstream" })}`);
    } else {
      console.log(`Last stock vs local:\n${await unifiedDiff({ before: update.stock, after: update.local, leftLabel: "last stock", rightLabel: "local" })}`);
      console.log(`Last stock vs parked upstream:\n${await unifiedDiff({ before: update.stock, after: update.parked, leftLabel: "last stock", rightLabel: "parked upstream" })}`);
    }
  });

templateCommand.command("accept")
  .description("Replace the local file with the parked version and record it")
  .argument("<path>")
  .action(async (relPath: string) => {
    await resolveTemplateUpdate({ boxRoot: await requireBoxRoot(), relPath, accept: true });
    console.log(`Accepted ${relPath}`);
  });

templateCommand.command("resolve")
  .description("Record the parked version after reviewing or merging the local file")
  .argument("<path>")
  .action(async (relPath: string) => {
    await resolveTemplateUpdate({ boxRoot: await requireBoxRoot(), relPath, accept: false });
    console.log(`Resolved ${relPath}`);
  });
