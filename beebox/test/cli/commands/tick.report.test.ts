// # `bbx tick --json`: one record per script
//
// A tick reports each script as ran, skipped (with the reason), or error (with
// the message), so a caller does not infer outcomes from side effects such as
// the notification log. `--json` prints that result as one JSON object and
// leaves the exit status at 0.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { runTick, tickCommand } from "../../../src/cli/commands/tick.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";

const card = (body: string) => `---\n${body}\n---\n`;

void test("Each script is ran, skipped with a reason, or error with a message", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/schedules/a-ok.scheduled-script.card", card('cron: "* * * * *"\nruns: "true"'));
  await box.write("_config/schedules/b-fails.scheduled-script.card", card('cron: "* * * * *"\nruns: "echo boom >&2; exit 3"'));
  await box.write("_config/schedules/c-later.scheduled-script.card", card('at: 2999-01-01T00:00\nruns: "true"'));
  await box.write("_config/schedules/d-off.scheduled-script.card", card('cron: "* * * * *"\nenabled: false\nruns: "true"'));
  box.commitAll("schedules");

  const result = await runTick(box.root, { quiet: true });
  t.check(result.scripts, [
    { name: "a-ok", status: "ran", command: any(String), durationMs: any(Number).int() },
    { name: "b-fails", status: "error", command: any(String), durationMs: any(Number).int(), error: any(String) },
    { name: "c-later", status: "skipped", reason: "not due" },
    { name: "d-off", status: "skipped", reason: "disabled (enabled: false)" },
  ]);

  t.check([result.ranCount, result.skipCount, result.errorCount], [1, 2, 1]);
});

void test("--json prints the result as one object", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_config/schedules/b-fails.scheduled-script.card", card('cron: "* * * * *"\nruns: "exit 3"'));
  box.commitAll("schedules");

  const printed: string[] = [];
  const log = console.log;
  console.log = (line: string) => void printed.push(line);
  try {
    await tickCommand.parseAsync(["--json", "--box", box.root], { from: "user" });
  } finally {
    console.log = log;
  }
  t.check(printed.map((line): unknown => JSON.parse(line)), [
    {
      dryRun: false,
      ranCount: 0,
      skipCount: 0,
      errorCount: 1,
      inconclusiveCount: 0,
      scripts: [{ name: "b-fails", status: "error", command: any(String), durationMs: any(Number).int(), error: any(String) }],
    },
  ]);
});
