import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

type FixtureMode = "clean" | "issue" | "append" | "failed-clean" | "stale";

async function makeFixture(mode: FixtureMode) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), `manual-tests-agent-${mode}-`));
  const fixtureBin = path.join(fixture, "bin");
  const fakeBin = path.join(fixture, "home", ".local", "bin");
  await Promise.all([
    fs.mkdir(fixtureBin, { recursive: true }),
    fs.mkdir(fakeBin, { recursive: true }),
    fs.mkdir(path.join(fixture, "issues", "bugs"), { recursive: true }),
  ]);

  const script = path.join(fixtureBin, "manual-tests-scheduled.sh");
  await fs.copyFile(path.join(import.meta.dirname, "manual-tests-scheduled.sh"), script);
  const commands: Record<string, string> = {
    node: "#!/bin/sh\necho 'synthetic reporter test'\n",
    pnpm: mode === "clean"
      ? "#!/bin/sh\necho 'synthetic TAP success'\n"
      : "#!/bin/sh\necho 'synthetic TAP failure' >&2\nexit 7\n",
    git: [
      "#!/bin/sh",
      "if [ \"$1 $2\" = 'rev-parse --short' ]; then echo abc123; exit 0; fi",
      "if [ \"$1 $2\" = 'branch --show-current' ]; then echo main; exit 0; fi",
      "if [ \"$1 $2\" = 'status --porcelain' ]; then echo '?? issues/bugs/2026-01-01-synthetic.md'; exit 0; fi",
      "exit 2",
    ].join("\n"),
    osascript: "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/notification-args\"\n",
    claude: mode === "clean" || mode === "failed-clean"
      ? "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/claude-args\"\ncat > \"$HOME/triage-prompt\"\necho 'TRIAGE: clean.'\n"
      : mode === "stale"
        ? "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/claude-args\"\ncat > \"$HOME/triage-prompt\"\necho 'TRIAGE: issues/bugs/2026-01-01-synthetic.md'\n"
        : [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > \"$HOME/claude-args\"",
        "cat > \"$HOME/triage-prompt\"",
        mode === "append"
          ? "echo 'Agent diagnosis.' >> issues/bugs/2026-01-01-synthetic.md"
          : "printf '%s\\n' '---' 'title: Synthetic scheduled failure' '---' 'Agent diagnosis.' > issues/bugs/2026-01-01-synthetic.md",
        "echo 'TRIAGE: issues/bugs/2026-01-01-synthetic.md'",
      ].join("\n"),
  };
  if (mode === "append" || mode === "stale") {
    await fs.writeFile(
      path.join(fixture, "issues", "bugs", "2026-01-01-synthetic.md"),
      "---\ntitle: Existing failure\n---\nExisting diagnosis.\n",
    );
  }
  await Promise.all(Object.entries(commands).map(async ([name, content]) => {
    const command = path.join(fakeBin, name);
    await fs.writeFile(command, content);
    await fs.chmod(command, 0o755);
  }));
  await fs.chmod(script, 0o755);
  return { fixture, script };
}

test("scheduled runner delegates clean and failing results to a constrained issue agent", async (t) => {
  for (const mode of ["clean", "issue", "append", "failed-clean", "stale"] as const) {
    const { fixture, script } = await makeFixture(mode);
    t.after(() => fs.rm(fixture, { recursive: true, force: true }));
    const home = path.join(fixture, "home");
    const result = await execa(script, {
      cwd: fixture,
      env: {
        HOME: home,
        MANUAL_TESTS_OSASCRIPT: path.join(home, ".local", "bin", "osascript"),
      },
      reject: false,
    });
    const expectedExit = mode === "clean" ? 0 : mode === "issue" || mode === "append" ? 7 : 1;
    assert.equal(result.exitCode, expectedExit);

    const claudeArgs = await fs.readFile(path.join(home, "claude-args"), "utf8");
    assert.match(claudeArgs, /--permission-mode\ndontAsk/);
    assert.match(claudeArgs, /--setting-sources\nuser/);
    assert.match(claudeArgs, /Read\(callback-box\/\*\*\)/);
    assert.match(claudeArgs, /Edit\(issues\/bugs\/\*\*\)/);
    assert.match(claudeArgs, /Read\(private-issues\/\*\*\)/);
    assert.doesNotMatch(claudeArgs, /^Bash$/m);
    const prompt = await fs.readFile(path.join(home, "triage-prompt"), "utf8");
    assert.match(prompt, /Diagnosis and open-issue creation\/update are the terminal\s+actions/);

    const logDir = path.join(fixture, "logs", "manual-tests");
    const latest = await fs.readFile(path.join(logDir, "latest.log"), "utf8");
    assert.match(latest, mode === "clean" ? /synthetic TAP success/ : /synthetic TAP failure/);
    const issuePath = path.join(fixture, "issues", "bugs", "2026-01-01-synthetic.md");
    if (mode === "clean") {
      await assert.rejects(fs.access(issuePath));
      await assert.rejects(fs.access(path.join(home, "notification-args")));
    } else if (mode === "issue" || mode === "append") {
      assert.match(await fs.readFile(issuePath, "utf8"), /Agent diagnosis/);
      assert.match(await fs.readFile(path.join(home, "notification-args"), "utf8"), /agent triage completed/);
    } else {
      const notification = await fs.readFile(path.join(home, "notification-args"), "utf8");
      assert.match(notification, mode === "failed-clean" ? /created no issue/ : /triage failed/);
    }
  }
});
