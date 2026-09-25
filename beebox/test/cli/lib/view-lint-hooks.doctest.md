# Edit-time view compile check

Agent-authored views (`views/*.tsx`) get a compile check the moment they're
written — the same edit-time nudge cards already get. The check runs from **both**
validation hook paths: the shell `bbx validate --hook` (installed
`.claude/settings.json`) and the in-process `cardValidatorHook()` that agent chat
and agent-run sessions use. Both call the shared `lintViewFile`, and then, for a
view that compiles, `lintViewMarkdown`: rendering card text other than through
`Markdown` is an error of the same weight (`test/core/view-markdown-check.doctest.md`).

```ts setup
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { spawn } from "node:child_process";
import { isViewFile } from "../../../src/lib/paths.js";
import { lintViewFile } from "../../../src/webapp/views/compiler.js";
import { cardValidatorHook } from "../../../src/core/sdk-hooks.js";

const GOOD_VIEW = `
export const name = "Good";
export const dependencies = [];
export const modes = ["page"];
export default function Good() { return <div>ok</div>; }
`;
const BROKEN_VIEW = `export default function Broken() { return <div`;
const RAW_BODY_VIEW = `
export const name = "Raw";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page"];
export default function Raw({ cards }) { return cards.map((card) => <p key={card.path}>{card.body}</p>); }
`;

async function makeViews() {
  const box = await makeTmpBox({ git: true });
  const tmp = box.root;
  const viewsDir = join(tmp, "src", "views");
  await mkdir(viewsDir, { recursive: true });
  await writeFile(join(viewsDir, "good.tsx"), GOOD_VIEW);
  await writeFile(join(viewsDir, "broken.tsx"), BROKEN_VIEW);
  await writeFile(join(viewsDir, "raw.tsx"), RAW_BODY_VIEW);
  return viewsDir;
}

// Run the real CLI (prebuilt by pretest) in hook mode with a PostToolUse
// payload on stdin; resolve its exit code and output channels.
function runShellHook(filePath, sessionId) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PACKAGE_ROOT, "dist/cli.mjs"), "validate", "--hook"], { cwd: dirname(filePath) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify({ session_id: sessionId, tool_input: { file_path: filePath } }));
  });
}
```

## The predicate

`isViewFile` matches a `.tsx` directly in a `views/` directory, not other tsx:

```ts
[
  isViewFile("/box/views/dashboard.tsx"),
  isViewFile("views/foo.tsx"),
  isViewFile("/box/src/components/Foo.tsx"),
  isViewFile("/box/views/sub/nested.tsx"),
  isViewFile("/box/views/notes.md"),
].join(",")
=> true,true,false,false,false
```

## The shared check

`lintViewFile` returns null for a view that compiles, and an error message for
one that doesn't:

```ts
const viewsDir = await makeViews();
await lintViewFile(join(viewsDir, "good.tsx"))
=> null
```

```ts continue
const err = await lintViewFile(join(viewsDir, "broken.tsx"));
typeof err === "string" && err.length > 0
=> true
```

```ts cleanup
await rm(dirname(dirname(viewsDir)), { recursive: true, force: true });
```

## In-process hook (cardValidatorHook)

The hook agent sessions actually run surfaces a broken view's compile error as
`additionalContext`. A clean view returns an empty result (no nudge):

```ts
const viewsDir = await makeViews();
const hook = cardValidatorHook().hooks[0];

const brokenOut = await hook({
  hook_event_name: "PostToolUse",
  tool_input: { file_path: join(viewsDir, "broken.tsx") },
  cwd: viewsDir,
});
brokenOut.hookSpecificOutput.additionalContext.startsWith("View compile error")
=> true
```

A view that compiles but renders a body as raw text gets the Markdown rule:

```ts continue
const rawOut = await hook({
  hook_event_name: "PostToolUse",
  tool_input: { file_path: join(viewsDir, "raw.tsx") },
  cwd: viewsDir,
});
rawOut.hookSpecificOutput.additionalContext.includes("Render card text with `Markdown` from `beebox/view-widgets`")
=> true
```

```ts continue
const goodOut = await hook({
  hook_event_name: "PostToolUse",
  tool_input: { file_path: join(viewsDir, "good.tsx") },
  cwd: viewsDir,
});
JSON.stringify(goodOut)
=> {}
```

The matcher covers MultiEdit too (not just Write|Edit):

```ts continue
cardValidatorHook().matcher
=> Write|Edit|MultiEdit
```

```ts cleanup
await rm(dirname(dirname(viewsDir)), { recursive: true, force: true });
```

## Shell hook (bbx validate --hook)

A broken view through the installed shell hook exits 2 (the nudge contract) with
the compile error on stderr:

```ts
const viewsDir = await makeViews();
const broken = await runShellHook(join(viewsDir, "broken.tsx"));
broken.code
=> 2
```

```ts continue
broken.stderr.includes("View compile error")
=> true
```

The Markdown rule fails the same way:

```ts continue
const raw = await runShellHook(join(viewsDir, "raw.tsx"));
[raw.code, raw.stderr.includes("line 5: reads `card.body` outside `<Markdown>`")].join(" ")
=> 2 true
```

A clean view exits 0:

```ts continue
const good = await runShellHook(join(viewsDir, "good.tsx"));
good.code
=> 0
```

```ts cleanup
await rm(dirname(dirname(viewsDir)), { recursive: true, force: true });
```

A soft instruction-size warning exits 0 and reaches the agent through the
`PostToolUse` JSON context channel, without a failing tool result:

```ts
const warningBox = await makeTmpBox();
const instructions = join(warningBox.root, "CLAUDE.md");
await writeFile(instructions, "x".repeat(13000));
const warning = await runShellHook(instructions);
JSON.stringify({
  code: warning.code,
  context: JSON.parse(warning.stdout).hookSpecificOutput.additionalContext.includes("claude-md-size"),
  stderr: warning.stderr,
})
=> {"code":0,"context":true,"stderr":""}
```

```ts cleanup
await warningBox.cleanup();
```

## Repeated instruction-size warnings

One session sees a size tier once for each file. A larger character count in
the same tier stays quiet; crossing to the firm tier warns again. A clean edit
resets the notice, and another session gets its own notice.

```ts
const repeatBox = await makeTmpBox();
const repeatFile = join(repeatBox.root, "CLAUDE.md");
await writeFile(repeatFile, "x".repeat(13000));
const first = await runShellHook(repeatFile, "session-one");
await writeFile(repeatFile, "x".repeat(13100));
const repeated = await runShellHook(repeatFile, "session-one");
await writeFile(repeatFile, "x".repeat(21000));
const firm = await runShellHook(repeatFile, "session-one");
await writeFile(repeatFile, "x".repeat(19000));
const softAgain = await runShellHook(repeatFile, "session-one");
await writeFile(repeatFile, "x".repeat(21010));
const firmAgain = await runShellHook(repeatFile, "session-one");
await writeFile(repeatFile, "small");
const clean = await runShellHook(repeatFile, "session-one");
await writeFile(repeatFile, "x".repeat(13000));
const afterClean = await runShellHook(repeatFile, "session-one");
const newSession = await runShellHook(repeatFile, "session-two");
const cacheFile = join(repeatBox.root, ".beebox", "validate-hook-warnings.json");
await writeFile(cacheFile, "{");
const corruptCache = await runShellHook(repeatFile, "session-one");
const recoveredCache = await runShellHook(repeatFile, "session-one");
await rm(cacheFile);
await mkdir(cacheFile);
const unavailableCache = await runShellHook(repeatFile, "session-one");
JSON.stringify([first, repeated, firm, softAgain, firmAgain, clean, afterClean, newSession, corruptCache, recoveredCache, unavailableCache].map((result) => ({
  code: result.code,
  warning: result.stdout.includes("claude-md-size"),
  stderr: result.stderr,
})))
=> [{"code":0,"warning":true,"stderr":""},{"code":0,"warning":false,"stderr":""},{"code":0,"warning":true,"stderr":""},{"code":0,"warning":false,"stderr":""},{"code":0,"warning":false,"stderr":""},{"code":0,"warning":false,"stderr":""},{"code":0,"warning":true,"stderr":""},{"code":0,"warning":true,"stderr":""},{"code":0,"warning":true,"stderr":""},{"code":0,"warning":false,"stderr":""},{"code":0,"warning":true,"stderr":""}]
```

```ts cleanup
await repeatBox.cleanup();
```
