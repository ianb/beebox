// # Streaming Command Execution
//
// `executeCommandStreaming()` runs a command and emits structured `OutputLine` messages. This is the testable core of the streaming execute endpoint — the route handler just wires `emit` to SSE format.

import { test } from "tap";
import "agent-doctest/tap";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/test-helpers.js";
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

  const lsResult = {
    type: "result" as const,
    success: true,
    data: { count: 1, lines: ["_content/inbox/test.task.card"] },
  };
  t.check(result, lsResult);

  // Output lines were emitted before the result, which is the last message:
  t.check(messages, [{ type: "output", text: "_content/inbox/test.task.card" }, lsResult]);
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

  t.check(result, { type: "result", success: false, data: undefined, error: "Unknown command: nonexistent-command" });
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

  t.check(result, {
    type: "result",
    success: false,
    data: undefined,
    error: "At least one path or glob pattern is required",
  });
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

  t.check(messages, [
    { type: "output", text: "_content/inbox/a.task.card" },
    { type: "output", text: "_content/inbox/b.task.card" },
    { type: "output", text: "_content/inbox/c.task.card" },
    {
      type: "result",
      success: true,
      data: {
        count: 3,
        lines: ["_content/inbox/a.task.card", "_content/inbox/b.task.card", "_content/inbox/c.task.card"],
      },
    },
  ]);
});
