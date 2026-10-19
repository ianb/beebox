// # Migration questions do not block a current box
//
// Exercise the actual Commander command in an isolated child process. The box,
// Git history, manifest, question, and generated-doc refresh are real; no repair
// agent or installer runs, and push subscriptions are isolated from the user.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../../src/core/migrations.js";
import { createTextQuestionTemplate } from "../../../src/schemas/question.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

const require = createRequire(join(PACKAGE_ROOT, "package.json"));
const commandUrl = pathToFileURL(join(PACKAGE_ROOT, "src/cli/commands/migrate.ts")).href;
const questionPath = "_bookkeeping/questions/Migration_partial.question.card";

async function fixture() {
  const box = await makeTmpBox({ git: true });
  await box.write(".gitignore", ".beebox/\n_content/docs/generated/\n");
  await box.write("AGENTS.md", "# Box\n");
  await box.write(MANIFEST_PATH, MIGRATIONS.map(m => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00Z" })).join("\n") + "\n");
  await box.write(questionPath, createTextQuestionTemplate({ memo: "Migration follow-up", prompt: "Which recovered value should be kept?", askedAt: "2026-09-01T00:00:00Z" }));
  await box.commitAll("seed current box with migration question");
  return box;
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function reportStatus(stdout: string): string {
  const report: { status: string } = JSON.parse(stdout.trim());
  return report.status;
}

function cli(box: TmpBox, args: string[]): Promise<CliResult> {
  const script = `import { migrateCommand } from ${JSON.stringify(commandUrl)}; await migrateCommand.parseAsync(${JSON.stringify(args)}, { from: "user" });`;
  const env: NodeJS.ProcessEnv = { ...process.env, BBX_PUSH_STORE_DIR: box.path(".beebox/test-push"), BBX_HOOK_BIN: join(PACKAGE_ROOT, "bin/bbx") };
  delete env.BBX_BOX_WORK;
  delete env.BBX_MAINTENANCE_PERMITS;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", require.resolve("tsx"), "--input-type=module", "--eval", script], {
      cwd: box.root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
  });
}

// ## Both output modes succeed while preserving human follow-up
void test("Both output modes succeed while preserving human follow-up", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L67
  const box = await fixture();
  const json = await cli(box, ["--sweep", "--json"]);
  const report: { status: string; questions: string[] } = JSON.parse(json.stdout.trim().split("\n").at(-1) ?? "");
  t.check({ code: json.code, status: report.status, questions: report.questions }, {
    code: 0,
    status: "attention",
    questions: [
      "_bookkeeping/questions/Migration_partial.question.card",
    ],
  });

  // doctest:L73
  const text = await cli(box, ["--sweep"]);
  t.check({ code: text.code, warning: text.stderr.includes("Migration questions need attention:") && text.stderr.includes(questionPath) }, {
    code: 0,
    warning: true,
  });
});

// ## An unmet migration prerequisite remains a failing exit
//
// A missing manifest requires a human baseline decision; it cannot be treated as
// an applied migration with a question.
void test("A missing manifest requires a human baseline decision; it cannot be treated a...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L88
  const box = await makeTmpBox({ git: true });
  await rm(box.path(MANIFEST_PATH));
  const result = await cli(box, ["--sweep", "--json"]);
  t.check({ code: result.code, status: reportStatus(result.stdout) }, {
    code: 1,
    status: "no-manifest",
  });
});
