# Knowledge-audit behavior extraction

Behavior extraction reads a bounded first page from the main agent transcript
and every subagent transcript. Short reads stay quiet; if either transcript is
actually longer than the page, the audit announces what it omitted.

```ts setup
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MAX_SESSION_ENTRIES } from "../../../src/cli/lib/session.js";
import { getSessionLogPath } from "../../../src/core/chat/session/transcript-paths.js";
import { assertFixturePathInBox } from "../../../src/dev/lib/audit-fixtures.js";
import { extractBehavior, loadTests } from "../../../src/dev/lib/test-runner.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

function raw(uuid: string) {
  return {
    type: "user",
    uuid,
    timestamp: "2026-08-06T12:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "audit fixture" }] },
  };
}

async function writeLog(logPath: string, count: number): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const lines = Array.from({ length: count }, (_, i) => JSON.stringify(raw(`entry-${String(i)}`)));
  await writeFile(logPath, `${lines.join("\n")}\n`);
}

async function captureWarnings(action: () => Promise<void>): Promise<string[]> {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    await action();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}
```

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

const shortId = "short-audit";
await writeLog(getSessionLogPath(box.root, shortId), 2);
const shortWarnings = await captureWarnings(async () => { await extractBehavior(box.root, shortId); });
shortWarnings.length
=> 0

const longId = "long-audit";
const mainLog = getSessionLogPath(box.root, longId);
await writeLog(mainLog, MAX_SESSION_ENTRIES + 1);
const subagentLog = join(dirname(mainLog), longId, "subagents", "agent-a.jsonl");
await writeLog(subagentLog, MAX_SESSION_ENTRIES + 1);

const longWarnings = await captureWarnings(async () => { await extractBehavior(box.root, longId); });
longWarnings.length
=> 2

longWarnings.every((warning) => warning.includes(`has ${String(MAX_SESSION_ENTRIES + 1)} entries; using the first ${String(MAX_SESSION_ENTRIES)}.`))
=> true
```

```continue
const linkedPackage = box.path("node_modules/beebox");
const outside = await makeTmpBox();
await mkdir(dirname(linkedPackage), { recursive: true });
await symlink(outside.root, linkedPackage, "dir");

const linkedFixtureRejected = await assertFixturePathInBox(
  box.root,
  "node_modules/beebox/box-docs/README.md",
).then(() => false, (error: Error) => error.message.includes("symbolic link"));
linkedFixtureRejected
=> true
```

```continue
const escapingFixtureRejected = await assertFixturePathInBox(box.root, "../outside.txt")
  .then(() => false, (error: Error) => error.message.includes("escapes the box"));
escapingFixtureRejected
=> true
```

```continue
const photosAudit = (await loadTests("src/dev/knowledge-audits.yaml")).tests
  .find((test) => test.id === "iphone-photos-album-setup");
const forbiddenResponses = photosAudit?.response_not_matches?.map((pattern) => new RegExp(pattern, "i")) ?? [];
const isForbiddenResponse = (response: string) => forbiddenResponses.some((pattern) => pattern.test(response));
JSON.stringify({
  refusesCommands: !isForbiddenResponse("I can't run commands on your Mac or handle the token."),
  spacedRefusal: !isForbiddenResponse("I can not run commands on your Mac."),
  explainsCommands: !isForbiddenResponse("I can explain the commands; you should run them locally."),
  willInstall: isForbiddenResponse("I'll install osxphotos for you."),
  curlyWillInstall: isForbiddenResponse("I’ll install osxphotos for you."),
  willMint: isForbiddenResponse("I will mint the token for you."),
  canDoSetup: isForbiddenResponse("I can do most of the setup for you."),
})
=> {"refusesCommands":true,"spacedRefusal":true,"explainsCommands":true,"willInstall":true,"curlyWillInstall":true,"willMint":true,"canDoSetup":true}
```

```ts cleanup
await box.cleanup();
await outside.cleanup();
```
