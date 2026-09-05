/**
 * Tests for `bin/schedules lint` and for the alert a tick raises about a
 * schedule it cannot run (scheduled-workstreams.md, Track E).
 *
 * Note on tier: bin/CLAUDE.md prefers doctests for new `bin/` tooling; the
 * plan's rollout names `bin/schedules.test.ts` explicitly and root `pnpm test`
 * runs exactly `bin/*.test.ts`. This file is that file's Track E half, split
 * off because it shells out to real shellcheck and eslint and is therefore the
 * slow part of the suite.
 *
 *   node --import tsx --test bin/schedules-lint.test.ts
 *
 * Real linters on real fixture directories: what is being tested is whether a
 * broken schedule is caught, and a stubbed shellcheck would test nothing.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";

import { lintSchedules, shebangKind, shebangProblem, type LintFinding } from "./lib/schedules-lint.js";
import { INVALID_SCHEDULE_ALERT_TITLE, tick } from "./lib/schedules-tick.js";
import { readAlerts, writeAlert } from "./lib/schedules-store.js";
import type { DesktopNotification, RunnerDeps } from "./lib/schedules-alerts.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

const CLEAN_YAML = 'description: "A test schedule"\ncadence: 1d\n';
const CLEAN_RUN = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${SCHEDULE_DRY_RUN:-0}" = "1" ]; then
  echo "would look for work"
  exit 0
fi
echo "no work"
`;
const CLEAN_PROMPT = "Report what you found with `bin/schedules alert --title … --message …`.\n";

interface Files {
  [name: string]: string;
}

/** One `schedules/<name>/` fixture. Files whose name is `run` or `check` get
 *  the executable bit; `--` after a name suppresses it. */
async function makeSchedule(name: string, files: Files): Promise<string> {
  const schedulesRoot = await tempDir("lint-schedules");
  const dir = path.join(schedulesRoot, name);
  await fs.mkdir(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    const executable = file.endsWith("--");
    const realName = executable ? file.slice(0, -2) : file;
    await fs.writeFile(path.join(dir, realName), body, "utf8");
    if ((realName === "run" || realName === "check") && !executable) await fs.chmod(path.join(dir, realName), 0o755);
  }
  return schedulesRoot;
}

async function lint(schedulesRoot: string): Promise<LintFinding[]> {
  return lintSchedules({ schedulesRoot, repoRoot: REPO_ROOT });
}

function rendered(findings: LintFinding[]): string {
  return findings.map((finding) => `${finding.file}: ${finding.message}`).join("\n");
}

// ─── The checks ───────────────────────────────────────────────────────────

test("a clean schedule produces no findings", async () => {
  const root = await makeSchedule("clean", {
    "schedule.yaml": CLEAN_YAML,
    run: CLEAN_RUN,
    check: "#!/bin/sh\nexit 0\n",
    "prompt.md": CLEAN_PROMPT,
  });
  assert.deepEqual(await lint(root), []);
});

test("shebangKind reads env and its options", () => {
  assert.equal(shebangKind("#!/bin/bash\n"), "shell");
  assert.equal(shebangKind("#!/usr/bin/env bash\n"), "shell");
  assert.equal(shebangKind("#!/usr/bin/env -S node --import tsx\n"), "node");
  assert.equal(shebangKind("#!/usr/bin/env python3\n"), "other");
  assert.equal(shebangKind("echo hi\n"), "none");
});

test("an env shebang that passes arguments without -S", () => {
  assert.equal(shebangProblem("#!/usr/bin/env -S node --import tsx\n"), null);
  assert.equal(shebangProblem("#!/usr/bin/env bash\n"), null);
  assert.equal(shebangProblem("#!/bin/bash -e\n"), null);
  assert.match(shebangProblem("#!/usr/bin/env node --import tsx\n") ?? "", /needs -S/);
});

test("the loader's own problems are findings: unparseable yaml, a missing field, no run, no prompt", async () => {
  const broken = await makeSchedule("broken", { "schedule.yaml": "description: [unclosed\n" });
  assert.equal(rendered(await lint(broken)).includes("schedule.yaml: unparseable YAML"), true, rendered(await lint(broken)));

  const noCadence = await makeSchedule("nocadence", { "schedule.yaml": 'description: "x"\n', run: CLEAN_RUN });
  assert.equal(
    (await lint(noCadence)).some((finding) => finding.file === "schedule.yaml" && finding.message.startsWith("cadence:")),
    true,
  );

  const noRun = await makeSchedule("norun", { "schedule.yaml": CLEAN_YAML });
  assert.deepEqual(await lint(noRun), [{ schedule: "norun", file: "run", message: "missing or not executable" }]);

  const unexecutable = await makeSchedule("unexecutable", { "schedule.yaml": CLEAN_YAML, "run--": CLEAN_RUN });
  assert.deepEqual(await lint(unexecutable), [
    { schedule: "unexecutable", file: "run", message: "missing or not executable" },
  ]);

  const noPrompt = await makeSchedule("noprompt", {
    "schedule.yaml": `${CLEAN_YAML}workstream:\n  agent: claude\n  model: opus\n  worktree: true\n  session: fresh\n  permissionMode: bypassPermissions\n`,
    run: CLEAN_RUN,
  });
  assert.deepEqual(await lint(noPrompt), [
    { schedule: "noprompt", file: "prompt.md", message: "required when the schedule has a workstream" },
  ]);
});

test("a script with no shebang, and a check that is not executable", async () => {
  const root = await makeSchedule("shebangless", {
    "schedule.yaml": CLEAN_YAML,
    run: 'echo "$SCHEDULE_DRY_RUN"\n',
    "check--": "#!/bin/sh\nexit 0\n",
  });
  const findings = await lint(root);
  assert.equal(findings.some((finding) => finding.file === "run" && finding.message.startsWith("needs a shebang")), true, rendered(findings));
  assert.equal(findings.some((finding) => finding.file === "check" && finding.message === "is not executable"), true, rendered(findings));
});

test("a run that never mentions SCHEDULE_DRY_RUN, satisfied by the file that does the work", async () => {
  const bare = await makeSchedule("nodryrun", {
    "schedule.yaml": CLEAN_YAML,
    run: '#!/usr/bin/env bash\nset -euo pipefail\necho "always runs"\n',
  });
  assert.deepEqual(await lint(bare), [
    {
      schedule: "nodryrun",
      file: "run",
      message: "never mentions SCHEDULE_DRY_RUN — a run script must honor the dry-run contract",
    },
  ]);

  // A two-line shim is not a violation: the contract is honored in run.ts.
  const shim = await makeSchedule("shim", {
    "schedule.yaml": CLEAN_YAML,
    run: '#!/usr/bin/env bash\nexec node --import tsx "$(dirname "$0")/run.ts" "$@"\n',
    "run.ts": 'export const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";\n',
  });
  assert.deepEqual(await lint(shim), []);
});

test("a prompt.md that never names the reporting command", async () => {
  const root = await makeSchedule("silentprompt", {
    "schedule.yaml": CLEAN_YAML,
    run: CLEAN_RUN,
    "prompt.md": "Have a look at the logs and fix whatever is wrong.\n",
  });
  assert.deepEqual(await lint(root), [
    {
      schedule: "silentprompt",
      file: "prompt.md",
      message: "never mentions `bin/schedules alert` — a session with no report is a bailed run",
    },
  ]);
});

test("shellcheck findings are reported against the shell script", async () => {
  const root = await makeSchedule("shellbug", {
    "schedule.yaml": CLEAN_YAML,
    run: '#!/usr/bin/env bash\ncd "$SCHEDULE_DIR"\necho "${SCHEDULE_DRY_RUN:-0}"\n',
  });
  const findings = await lint(root);
  assert.equal(findings.length, 1, rendered(findings));
  assert.equal(findings[0]?.file, "run");
  assert.match(findings[0]?.message ?? "", /line 2: SC2164/);
});

test("eslint findings are reported against the TypeScript script", async () => {
  const root = await makeSchedule("tsbug", {
    "schedule.yaml": CLEAN_YAML,
    run: '#!/usr/bin/env -S node --import tsx\nconst dry: any = process.env["SCHEDULE_DRY_RUN"];\nprocess.stdout.write(`${String(dry)}\\n`);\n',
  });
  const findings = await lint(root);
  assert.equal(findings.length, 1, rendered(findings));
  assert.equal(findings[0]?.file, "run");
  assert.match(findings[0]?.message ?? "", /@typescript-eslint\/no-explicit-any/);
});

test("a helper script beside run is linted too, and does not satisfy the dry-run contract", async () => {
  const root = await makeSchedule("helpers", {
    "schedule.yaml": CLEAN_YAML,
    run: '#!/usr/bin/env bash\nset -euo pipefail\n"$(dirname "$0")/helper.sh"\n',
    "helper.sh": '#!/usr/bin/env bash\ncd "$SCHEDULE_DIR"\necho "${SCHEDULE_DRY_RUN:-0}"\n',
  });
  const findings = await lint(root);
  assert.equal(
    findings.some((finding) => finding.file === "helper.sh" && finding.message.includes("SC2164")),
    true,
    rendered(findings),
  );
  // The helper mentions SCHEDULE_DRY_RUN; `run` still has to honor it itself.
  assert.equal(
    findings.some((finding) => finding.file === "run" && finding.message.startsWith("never mentions SCHEDULE_DRY_RUN")),
    true,
    rendered(findings),
  );
});

test("a TypeScript script that lives under the repo's own schedules/ is linted by path", async () => {
  // The by-path branch is the one real schedules use, and it is the branch that
  // depends on the root eslint.config.ts scoping `schedules/**/*.ts`.
  const repoSchedules = path.join(REPO_ROOT, "schedules");
  const name = `lint-fixture-${String(process.pid)}`;
  const dir = path.join(repoSchedules, name);
  await fs.mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  await fs.writeFile(path.join(dir, "schedule.yaml"), CLEAN_YAML, "utf8");
  await fs.writeFile(path.join(dir, "run"), '#!/usr/bin/env bash\nexec node --import tsx "$(dirname "$0")/run.ts" "$@"\n', "utf8");
  await fs.chmod(path.join(dir, "run"), 0o755);
  await fs.writeFile(path.join(dir, "run.ts"), 'const dry: any = process.env["SCHEDULE_DRY_RUN"];\nprocess.stdout.write(String(dry));\n', "utf8");

  const findings = (await lint(repoSchedules)).filter((finding) => finding.schedule === name);
  assert.deepEqual(
    findings.map((finding) => finding.file),
    ["run.ts"],
    rendered(findings),
  );
  assert.match(findings[0]?.message ?? "", /@typescript-eslint\/no-explicit-any/);
});

// ─── The CLI ──────────────────────────────────────────────────────────────

const CLI = path.resolve(import.meta.dirname, "schedules.ts");

async function runLint(input: { schedulesRoot: string; args: string[] }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await execa("node", ["--import", "tsx", CLI, "lint", ...input.args], {
    reject: false,
    cwd: REPO_ROOT,
    env: { ...process.env, BBX_SCHEDULES_DIR: input.schedulesRoot },
  });
  return { exitCode: result.exitCode ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test("lint is silent and exits 0 on a clean tree, and prints one line per finding otherwise", async () => {
  const clean = await makeSchedule("clean", {
    "schedule.yaml": CLEAN_YAML,
    run: CLEAN_RUN,
    "prompt.md": CLEAN_PROMPT,
  });
  const ok = await runLint({ schedulesRoot: clean, args: [] });
  assert.equal(ok.exitCode, 0, ok.stderr);
  assert.equal(ok.stdout, "");

  const broken = await makeSchedule("broken", { "schedule.yaml": CLEAN_YAML });
  const bad = await runLint({ schedulesRoot: broken, args: [] });
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.stdout, "schedules/broken/run: missing or not executable");
});

test("lint --json prints one findings array", async () => {
  const broken = await makeSchedule("jsonjob", {
    "schedule.yaml": CLEAN_YAML,
    run: "#!/usr/bin/env bash\necho hi\n",
  });
  const result = await runLint({ schedulesRoot: broken, args: ["--json"] });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    findings: [
      {
        schedule: "jsonjob",
        file: "run",
        message: "never mentions SCHEDULE_DRY_RUN — a run script must honor the dry-run contract",
      },
    ],
  });
});

// ─── The tick's alert ─────────────────────────────────────────────────────

interface Fake {
  deps: RunnerDeps;
  notifications: DesktopNotification[];
}

async function makeDeps(schedulesRoot: string): Promise<Fake> {
  const storeRoot = path.join(await tempDir("lint-store"), "store");
  const notifications: DesktopNotification[] = [];
  return {
    notifications,
    deps: {
      storeRoot,
      schedulesRoot,
      repoRoot: schedulesRoot,
      mainRoot: schedulesRoot,
      now: () => new Date("2026-08-24T12:00:00Z"),
      pid: process.pid,
      isProcessAlive: () => true,
      bootTimeMs: () => null,
      notify: async (notification) => { notifications.push(notification); await Promise.resolve(); },
    },
  };
}

test("a tick alerts important about an invalid schedule once, and again after it is acknowledged", async () => {
  const root = await makeSchedule("brokenjob", { "schedule.yaml": CLEAN_YAML });
  const fake = await makeDeps(root);

  const first = await tick(fake.deps);
  assert.equal(first.invalid.length, 1);
  const afterFirst = await readAlerts(fake.deps.storeRoot, "brokenjob");
  assert.equal(afterFirst.length, 1);
  const [alert] = afterFirst;
  assert.equal(alert?.title, INVALID_SCHEDULE_ALERT_TITLE);
  assert.equal(alert?.priority, "important");
  assert.equal(alert?.workstream, "brokenjob");
  assert.equal(alert?.runId, null);
  assert.match(alert?.details ?? "", /`run`: missing or not executable/);

  // The latch: the schedule is still broken on the next tick, and a broken
  // schedule stays broken — one record, not one every fifteen minutes.
  await tick(fake.deps);
  await tick(fake.deps);
  assert.equal((await readAlerts(fake.deps.storeRoot, "brokenjob")).length, 1);
  assert.equal(fake.notifications.length, 1);

  // Acknowledging re-arms it: the boxholder has seen this one, and a break
  // that is still not fixed is worth saying again.
  assert.ok(alert !== undefined);
  await writeAlert(fake.deps.storeRoot, { ...alert, state: "acknowledged", acknowledgedAt: "2026-08-24T13:00:00Z" });
  await tick(fake.deps);
  const afterAck = await readAlerts(fake.deps.storeRoot, "brokenjob");
  assert.equal(afterAck.filter((each) => each.state === "open").length, 1);
  assert.equal(afterAck.length, 2);
});
