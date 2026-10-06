# Triage CLI

The registered Commander tree exposes each small operation with help, JSON,
and caller-owned output files. Invoking a child runs that child only; it does
not also start automatic triage.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createTriageCommand, triageCommand } from "../../../src/cli/commands/triage/command.js";
import { buildProgram } from "../../../src/cli/entry/program.js";
import { triageCommand as engineTriageCommand } from "../../../src/core/commands/triage.js";
import { output, withInheritedJson } from "../../../src/cli/commands/triage/io.js";

async function captureJsonOutput(value: unknown, file: string): Promise<{ saved: unknown; printed: unknown }> {
  const chunks: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try { await output(value, { out: file, json: true, summary: "Evidence ready." }); }
  finally { process.stdout.write = original; }
  return { saved: JSON.parse(await fs.readFile(file, "utf8")), printed: JSON.parse(chunks.join("")) };
}

async function quietly<T>(action: () => Promise<T>): Promise<T> {
  const original = console.log;
  console.log = () => {};
  try { return await action(); }
  finally { console.log = original; }
}

async function dispatchProbe(): Promise<{ parentCalls: number; childCalls: number; json: boolean; out: string }> {
  const root = buildProgram();
  const parser = root.commands.find((command) => command.name() === "triage")!;
  const child = parser.commands.find((command) => command.name() === "judge")!;
  let parentCalls = 0;
  let childCalls = 0;
  let options: { json?: boolean; out?: string } = {};
  parser.action(() => { parentCalls += 1; });
  child.action((parsed: { json?: boolean; out?: string }) => { childCalls += 1; options = parsed; });
  await root.parseAsync(["triage", "judge", "--evidence", "evidence.json", "--instructions", "instructions.json", "--out", "decision.json", "--json"], { from: "user" });
  return { parentCalls, childCalls, json: withInheritedJson(child, options).json === true, out: options.out ?? "" };
}

async function rejectedApply(args: string[]): Promise<{ actions: number; error: string }> {
  const parser = createTriageCommand().exitOverride().configureOutput({ writeErr: () => {} });
  let actions = 0;
  const apply = parser.commands.find((command) => command.name() === "apply")!.exitOverride();
  apply.action(() => { actions += 1; });
  const error = await parser.parseAsync(args, { from: "user" }).then(() => "", (reason: Error) => reason.message);
  return { actions, error };
}
```

```ts
const childNames = triageCommand.commands.map((command) => command.name()).toSorted();
JSON.stringify(childNames)
=> ["apply","confirm","correct","decisions","instructions","judge","prepare","replay"]

const help = triageCommand.commands.map((command) => command.helpInformation()).join("\n");
["--out <file>", "--overwrite", "--json", "--overlay <file>", "--landmarks <file>", "--max-calls <count>", "--prepare-again", "--question <ref>", "--source <ref>"].every((option) => help.includes(option))
=> true

JSON.stringify({ legacyEngineDefault: engineTriageCommand.args[0]?.default, cliEngineFlag: triageCommand.options.find((option) => option.long === "--engine")?.defaultValue })
=> {"legacyEngineDefault":"agent","cliEngineFlag":"agent"}
```

## Commander dispatch is leaf-only

The real command factory preserves the registered parent and child structure.
Replacing the actions with spies proves options following a child name reach
that child, even when the parent also defines `--json`.

```ts
JSON.stringify(await dispatchProbe())
=> {"parentCalls":0,"childCalls":1,"json":true,"out":"decision.json"}
```

Parent-only automatic-run flags cannot be mistaken for harmless options on an
applying subcommand. Leaf-only parsing also rejects `--dry-run` after `apply`.

```ts
const parentDryRun = await rejectedApply(["--dry-run", "apply", "decision.json"]);
const parentEngine = await rejectedApply(["--engine", "jev", "apply", "decision.json"]);
const leafDryRun = await rejectedApply(["apply", "decision.json", "--dry-run"]);
JSON.stringify({ parentDryRun: { actions: parentDryRun.actions, rejected: parentDryRun.error.includes("automatic triage only") },
  parentEngine: { actions: parentEngine.actions, rejected: parentEngine.error.includes("automatic triage only") },
  leafDryRun: { actions: leafDryRun.actions, rejected: leafDryRun.error.includes("unknown option '--dry-run'") } })
=> {"parentDryRun":{"actions":0,"rejected":true},"parentEngine":{"actions":0,"rejected":true},"leafDryRun":{"actions":0,"rejected":true}}
```

## JSON and explicit output files

Output files are new by default. JSON stdout remains complete, and a second
write cannot replace the first file unless `--overwrite` was supplied.

```ts
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "triage-cli-"));
const file = path.join(directory, "evidence.json");
const value = { status: "ready", text: "prepared content" };
JSON.stringify(await captureJsonOutput(value, file))
=> {"saved":{"status":"ready","text":"prepared content"},"printed":{"status":"ready","text":"prepared content"}}

await output({ status: "blocked" }, { out: file, summary: "must not replace" }).then(() => "unexpected", (error: NodeJS.ErrnoException) => error.code)
=> EEXIST

await quietly(() => output({ status: "replaced" }, { out: file, overwrite: true, summary: "updated" }));
JSON.stringify(JSON.parse(await fs.readFile(file, "utf8")))
=> {"status":"replaced"}

await fs.rm(directory, { recursive: true, force: true });
```
