// # Every box audit sees the same generated guidance
//
// Issue 2026-09-28-knowledge-audit-later-tests-lose-generated-guidance: the
// CLI generated docs once before its loop, and the runner's post-test
// `git reset --hard` + `git clean -fd` removed the guidance that generation
// leaves untracked. The second audit then ran without it. A box made before
// `agents-md-2026-10` (`legacyInstructions`) shows this: forced generation
// writes its root `CLAUDE.md` as an untracked file. The real runner runs here,
// with a fake Claude agent that records the `CLAUDE.md` it would load.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import type { AgentInvokeOptions, AgentResult } from "../../../../src/core/agent/types.js";
import type { AuditTest } from "../../../../src/dev/lib/test-runner/runner/run-test.js";
import type * as BoxAudits from "../../../../src/dev/lib/box-audits/core.js";
import * as auditPlugins from "../../../../src/dev/lib/box-audits/plugins.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

void test("Each audit regenerates the guidance the previous audit's cleanup removed", async (t) => {
  const projects = await mkdtemp(join(tmpdir(), "bbx-audit-projects-"));
  const priorProjects = process.env["BBX_CLAUDE_PROJECTS_DIR"];
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = projects;
  t.teardown(async () => {
    if (priorProjects === undefined) delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
    else process.env["BBX_CLAUDE_PROJECTS_DIR"] = priorProjects;
    await rm(projects, { recursive: true, force: true });
  });
  const box = await makeTmpBox({ git: true, legacyInstructions: true });
  t.teardown(() => box.cleanup());
  const initialStatus = execSync("git status --porcelain --untracked-files=all", { cwd: box.root, encoding: "utf-8" });

  const seen: Array<{ audit: string; claudeMd: string }> = [];
  const { runBoxAudits } = await t.mockImport<typeof BoxAudits>(
    "../../../../src/dev/lib/box-audits/core.ts",
    {
      "../../../../src/core/agent/invoke/core.ts": {
        createClaudeAgent: () => ({
          name: "knowledge-audit",
          sessionId: null,
          invoke: async (opts: AgentInvokeOptions): Promise<AgentResult> => {
            const sessionId = `fake-${String(seen.length)}`;
            const claudeMd = await readFile(join(opts.boxRoot, "CLAUDE.md"), "utf-8").catch(() => "absent");
            seen.push({ audit: opts.prompt, claudeMd });
            const logPath = getSessionLogPath(opts.cwd ?? opts.boxRoot, sessionId);
            await mkdir(dirname(logPath), { recursive: true });
            await writeFile(logPath, `${JSON.stringify({
              type: "assistant", uuid: `${sessionId}-reply`, timestamp: "2026-10-20T12:00:00Z",
              message: { role: "assistant", content: [{ type: "text", text: "fake reply" }] },
            })}\n`);
            return { success: true, output: "", exitCode: 0, sessionId };
          },
        }),
      },
    },
  );

  const auditTest = (id: string): AuditTest => ({ id, prompt: id, expected_level: "knows_directly", watch_for: "nothing" });
  await runBoxAudits({ tests: [auditTest("first"), auditTest("second")], boxRoot: box.root, engine: "claude" });

  // Both audits load the same generated `CLAUDE.md` (its first line names the
  // box's guidance), and cleanup leaves the tree as clean as it started.
  t.check(seen.map(({ audit, claudeMd }) => ({ audit, firstLine: claudeMd.split("\n")[0] })), [
    { audit: "first", firstLine: "@.beebox/agent-guide.md" },
    { audit: "second", firstLine: "@.beebox/agent-guide.md" },
  ]);
  t.check(seen[1]?.claudeMd, seen[0]?.claudeMd);
  t.check(
    {
      initialStatus,
      generatedAfterRun: await readFile(join(box.root, "CLAUDE.md"), "utf-8").catch(() => "absent"),
      finalStatus: execSync("git status --porcelain --untracked-files=all", { cwd: box.root, encoding: "utf-8" }),
    },
    { initialStatus: "", generatedAfterRun: "absent", finalStatus: "" },
  );
});

// An audit that declares `plugins` sees the plugin's skill; the next audit,
// which declares none, sees neither the skill nor the plugin in `box.json`,
// and the run leaves the tree clean.
void test("A plugin audit's activation does not leak into the next audit", async (t) => {
  const projects = await mkdtemp(join(tmpdir(), "audit-plugin-projects-"));
  const previousProjects = process.env["BBX_CLAUDE_PROJECTS_DIR"];
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = projects;
  t.teardown(async () => {
    if (previousProjects === undefined) delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
    else process.env["BBX_CLAUDE_PROJECTS_DIR"] = previousProjects;
    await rm(projects, { recursive: true, force: true });
  });
  const box = await makeTmpBox({ git: true, deps: true });
  t.teardown(() => box.cleanup());

  const seen: Array<{ audit: string; plugins: unknown; skill: boolean }> = [];
  const { runBoxAudits } = await t.mockImport<typeof BoxAudits>(
    "../../../../src/dev/lib/box-audits/core.ts",
    {
      // Under tap's module mock the box's schema stubs cannot be imported
      // ("mock service instance key not found"), so readiness, tested in
      // plugins.test.ts, is stubbed here. The skill check below still shows
      // that activation reached docs generation.
      "../../../../src/dev/lib/box-audits/plugins.ts": { ...auditPlugins, assertAuditPluginsReady: async () => {} },
      "../../../../src/core/agent/invoke/core.ts": {
        createClaudeAgent: () => ({
          name: "knowledge-audit",
          sessionId: null,
          invoke: async (opts: AgentInvokeOptions): Promise<AgentResult> => {
            const sessionId = `fake-plugin-${String(seen.length)}`;
            const config: unknown = JSON.parse(await readFile(join(opts.boxRoot, "_config/box.json"), "utf-8").catch(() => "{}"));
            const skill = await readFile(join(opts.boxRoot, ".claude/skills/courseware/SKILL.md"), "utf-8").then(() => true, () => false);
            seen.push({ audit: opts.prompt, plugins: typeof config === "object" && config !== null && "plugins" in config ? config.plugins : undefined, skill });
            const logPath = getSessionLogPath(opts.cwd ?? opts.boxRoot, sessionId);
            await mkdir(dirname(logPath), { recursive: true });
            await writeFile(logPath, `${JSON.stringify({
              type: "assistant", uuid: `${sessionId}-reply`, timestamp: "2026-10-22T12:00:00Z",
              message: { role: "assistant", content: [{ type: "text", text: "fake reply" }] },
            })}\n`);
            return { success: true, output: "", exitCode: 0, sessionId };
          },
        }),
      },
    },
  );

  const auditTest = (id: string, plugins?: string[]): AuditTest => ({
    id, prompt: id, expected_level: "knows_directly", watch_for: "nothing", ...(plugins && { plugins }),
  });
  await runBoxAudits({ tests: [auditTest("with", ["courseware"]), auditTest("without")], boxRoot: box.root, engine: "claude" });

  t.check(seen, [
    { audit: "with", plugins: ["courseware"], skill: true },
    { audit: "without", plugins: undefined, skill: false },
  ]);
  t.check(execSync("git status --porcelain --untracked-files=all", { cwd: box.root, encoding: "utf-8" }), "");
});
