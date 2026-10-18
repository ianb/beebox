// # Streaming Command Execution
//
// `executeCommandStreaming()` runs a command and emits structured `OutputLine` messages. This is the testable core of the streaming execute endpoint — the route handler just wires `emit` to SSE format.

import { test } from "tap";
import "agent-doctest/tap";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox, bodyField } from "../../helpers/test-helpers.js";
import { initBox } from "../../../src/core/box/structure/core.js";
import { executeCommandStreaming, type OutputLine } from "../../../src/webapp/routes/commands.js";

// ## Successful command emits output lines and a result
//
// The `ls` command writes output lines via `ctx.writeLine()`, which become `{ type: "output" }` messages. The final message is always `{ type: "result" }`:
void test("The ls command writes output lines via ctx.writeLine(), which become { type:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L18
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);

  // doctest:L21
  await mkdir(join(box.root, "_content/inbox"), { recursive: true });
  await writeFile(
    join(box.root, "_content/inbox/test.task.card"),
    "<task>Test task</task>",
  );

  // doctest:L27
  const messages: OutputLine[] = [];
  const result = await executeCommandStreaming({
    command: "ls",
    args: { paths: ["_content/inbox"] },
    boxRoot: box.root,
    emit: (line) => messages.push(line),
  });

  // doctest:L35
  t.check(result.type, "result");

  // doctest:L38
  t.check(result.success, true);

  // Output lines were emitted before the result:

  // doctest:L45
  const outputLines = messages.filter(m => m.type === "output");
  await t.checkText(outputLines.length > 0, "true");

  // doctest:L49
  t.check(outputLines[0]?.text?.includes("test.task.card"), true);

  // The result includes structured data:

  // doctest:L56
  t.check(bodyField(result.data, "count"), 1);
});

// ## Unknown command returns error result
void test("Unknown command returns error result", async (t) => {
  // doctest:L67
  const messages: OutputLine[] = [];
  const result = await executeCommandStreaming({
    command: "nonexistent-command",
    args: {},
    boxRoot: "/tmp/fake",
    emit: (line) => messages.push(line),
  });

  // doctest:L75
  t.check(result.success, false);

  // doctest:L78
  t.check(result.error?.includes("nonexistent"), true);
});

// ## Command failure emits error in result
//
// When a command returns `{ success: false }`, the result line carries the error:
void test("When a command returns { success:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L87
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);

  // doctest:L90
  const messages: OutputLine[] = [];
  const result = await executeCommandStreaming({
    command: "ls",
    args: { paths: [] },
    boxRoot: box.root,
    emit: (line) => messages.push(line),
  });

  // doctest:L98
  t.check(result.success, false);
});

// ## Multiple output lines from a command
//
// Commands that list multiple items emit one output line per item:
void test("Commands that list multiple items emit one output line per item:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L111
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);

  // doctest:L114
  await mkdir(join(box.root, "_content/inbox"), { recursive: true });
  await writeFile(join(box.root, "_content/inbox/a.task.card"), "<task>A</task>");
  await writeFile(join(box.root, "_content/inbox/b.task.card"), "<task>B</task>");
  await writeFile(join(box.root, "_content/inbox/c.task.card"), "<task>C</task>");

  // doctest:L119
  const messages: OutputLine[] = [];
  await executeCommandStreaming({
    command: "ls",
    args: { paths: ["_content/inbox"] },
    boxRoot: box.root,
    emit: (line) => messages.push(line),
  });

  // doctest:L127
  const outputLines = messages.filter(m => m.type === "output");
  await t.checkText(outputLines.length, "3");

  // doctest:L131
  const resultLines = messages.filter(m => m.type === "result");
  await t.checkText(resultLines.length, "1");

  // doctest:L135
  t.check(bodyField(resultLines[0]?.data, "count"), 3);
});
