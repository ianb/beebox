# Edit-time view compile check

Agent-authored views (`views/*.tsx`) get a compile check the moment they're
written — the same edit-time nudge cards already get. The check runs from **both**
validation hook paths: the shell `cb validate --hook` (installed
`.claude/settings.json`) and the in-process `cardValidatorHook()` that agent chat
and agent-run sessions use. Both call the shared `lintViewFile`.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { isViewFile } from "../src/cli/lib/paths.js";
import { lintViewFile } from "../src/webapp/views/compiler.js";
import { cardValidatorHook } from "../src/core/sdk-hooks.js";

const GOOD_VIEW = `
export const name = "Good";
export const dependencies = [];
export const modes = ["page"];
export default function Good() { return <div>ok</div>; }
`;
const BROKEN_VIEW = `export default function Broken() { return <div`;

async function makeViews() {
  const tmp = await mkdtemp(join(tmpdir(), "view-lint-"));
  const viewsDir = join(tmp, "views");
  await mkdir(viewsDir, { recursive: true });
  await writeFile(join(viewsDir, "good.tsx"), GOOD_VIEW);
  await writeFile(join(viewsDir, "broken.tsx"), BROKEN_VIEW);
  return viewsDir;
}

// Run the real CLI (prebuilt by pretest) in hook mode with a PostToolUse
// payload on stdin; resolve its exit code + stderr.
function runShellHook(filePath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["dist/cli.mjs", "validate", "--hook"], { cwd: process.cwd() });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify({ tool_input: { file_path: filePath } }));
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

## Shell hook (cb validate --hook)

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

A clean view exits 0:

```ts continue
const good = await runShellHook(join(viewsDir, "good.tsx"));
good.code
=> 0
```
