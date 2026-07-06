# Streaming Command Execution

`executeCommandStreaming()` runs a command and emits structured `OutputLine` messages. This is the testable core of the streaming execute endpoint — the route handler just wires `emit` to SSE format.

```ts setup
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { executeCommandStreaming } from "../../src/webapp/routes/commands.js";
```

## Successful command emits output lines and a result

The `ls` command writes output lines via `ctx.writeLine()`, which become `{ type: "output" }` messages. The final message is always `{ type: "result" }`:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);

await mkdir(join(box.root, "box/inbox"), { recursive: true });
await writeFile(
  join(box.root, "box/inbox/test.task.card"),
  "<task>Test task</task>",
);

const messages = [];
const result = await executeCommandStreaming({
  command: "ls",
  args: { paths: ["box/inbox"] },
  boxRoot: box.root,
  emit: (line) => messages.push(line),
});

result.type
=> result

result.success
=> true
```

Output lines were emitted before the result:

```ts continue
const outputLines = messages.filter(m => m.type === "output");
outputLines.length > 0
=> true

outputLines[0].text.includes("test.task.card")
=> true
```

The result includes structured data:

```ts continue
result.data.count
=> 1
```

```ts cleanup
await box.cleanup();
```

## Unknown command returns error result

```ts
const messages = [];
const result = await executeCommandStreaming({
  command: "nonexistent-command",
  args: {},
  boxRoot: "/tmp/fake",
  emit: (line) => messages.push(line),
});

result.type
=> result

result.success
=> false

result.error.includes("nonexistent")
=> true
```

## Command failure emits error in result

When a command returns `{ success: false }`, the result line carries the error:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);

const messages = [];
const result = await executeCommandStreaming({
  command: "ls",
  args: { paths: [] },
  boxRoot: box.root,
  emit: (line) => messages.push(line),
});

result.type
=> result

result.success
=> false
```

```ts cleanup
await box.cleanup();
```

## Multiple output lines from a command

Commands that list multiple items emit one output line per item:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);

await mkdir(join(box.root, "box/inbox"), { recursive: true });
await writeFile(join(box.root, "box/inbox/a.task.card"), "<task>A</task>");
await writeFile(join(box.root, "box/inbox/b.task.card"), "<task>B</task>");
await writeFile(join(box.root, "box/inbox/c.task.card"), "<task>C</task>");

const messages = [];
await executeCommandStreaming({
  command: "ls",
  args: { paths: ["box/inbox"] },
  boxRoot: box.root,
  emit: (line) => messages.push(line),
});

const outputLines = messages.filter(m => m.type === "output");
outputLines.length
=> 3

const resultLines = messages.filter(m => m.type === "result");
resultLines.length
=> 1

resultLines[0].success
=> true

resultLines[0].data.count
=> 3
```

```ts cleanup
await box.cleanup();
```
