# Validation hook input

The installed Claude and Codex plugins call the same validation command. Claude
Write/Edit hooks provide one `file_path`; Codex `apply_patch` hooks provide a
patch command that can name several files.

```ts setup
import { parseHookFilePaths, validateHookPathsResult } from "../../src/cli/commands/validate-hook.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { writeFile } from "node:fs/promises";
```

## Claude file tools

```ts
JSON.stringify(parseHookFilePaths({
  tool_name: "Write",
  tool_input: { file_path: "/box/store/Note.memo.card", content: "..." },
}))
=> ["/box/store/Note.memo.card"]
```

## Codex apply_patch

```ts
JSON.stringify(parseHookFilePaths({
  tool_name: "apply_patch",
  tool_input: {
    command: `*** Begin Patch
*** Update File: _content/One.memo.card
@@
-old
+new
*** Add File: _content/Two.memo.card
+new
*** Delete File: _content/Old.memo.card
*** End Patch`,
  },
}))
=> ["_content/One.memo.card","_content/Two.memo.card","_content/Old.memo.card"]
```

Unknown and malformed tool inputs are ignored quietly:

```ts
parseHookFilePaths({ tool_name: "Bash", tool_input: { command: "git status" } })
=> []

parseHookFilePaths(null)
=> []
```

Codex paths are resolved against the hook payload's cwd, not the hook
subprocess's potentially different cwd:

```ts
JSON.stringify(parseHookFilePaths({
  cwd: "/box/content",
  tool_name: "apply_patch",
  tool_input: { command: "*** Begin Patch\n*** Update File: _content/One.memo.card\n*** End Patch" },
}))
=> ["/box/content/_content/One.memo.card"]
```

## Warning severity is preserved

Harness adapters need to show validation errors as failed turns while keeping
soft instruction-size feedback as a warning.

```ts
const box = await makeTmpBox();
await writeFile(`${box.root}/CLAUDE.md`, "x".repeat(13000));
const warning = await validateHookPathsResult([`${box.root}/CLAUDE.md`]);
await box.cleanup();
JSON.stringify({ hasFeedback: warning.feedback?.includes("claude-md-size"), hasErrors: warning.hasErrors })
=> {"hasFeedback":true,"hasErrors":false}
```

## Package-surface tripwire (Track C)

An edit anywhere under a top-level segment outside the closed vocabulary
runs the closed-vocabulary root check — not just a direct root-level edit; a
stray root entry (here `recipes/`, created implicitly by the nested card
write) is surfaced even though the edited file itself is nested under it:

```ts
const strayBox = await makeTmpBox();
await strayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
const nestedStrayEdit = await validateHookPathsResult([`${strayBox.root}/recipes/Bread.recipe.card`]);
await strayBox.cleanup();
JSON.stringify({ hasErrors: nestedStrayEdit.hasErrors, feedback: nestedStrayEdit.feedback })
=> {"hasErrors":true,"feedback":"Box root: recipes: the box root is a closed vocabulary — user content goes under /_content/"}
```

The same tripwire fires for a stray directly at the root — the edited file
need not be nested under it:

```ts
const rootStrayBox = await makeTmpBox();
await rootStrayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await writeFile(`${rootStrayBox.root}/stray-file.txt`, "hi");
const strayFileEdit = await validateHookPathsResult([`${rootStrayBox.root}/stray-file.txt`]);
await rootStrayBox.cleanup();
strayFileEdit.hasErrors
=> true
```

## npm-namespace edit feedback is independent of stray detection

Editing `package.json` (or a lockfile, `tsconfig.json`, `node_modules/`)
always gets a nudge — even on an otherwise-clean root, where the stray check
alone would stay silent:

```ts
const cleanBox = await makeTmpBox();
await writeFile(`${cleanBox.root}/package.json`, "{}");
const cleanEdit = await validateHookPathsResult([`${cleanBox.root}/package.json`]);
await cleanBox.cleanup();
JSON.stringify(cleanEdit)
=> {"feedback":"Edit touches the box's npm/package surface (package.json) — make sure this is a deliberate dependency/tooling change, not accidental drift.","hasErrors":false}
```

The same independent nudge fires for a `node_modules/` edit, not just the
entry itself — and it's a warning (`hasErrors: false`), not a blocker:

```ts
const nmBox = await makeTmpBox();
await nmBox.write("node_modules/pkg/index.js", "module.exports = {};");
const nmEdit = await validateHookPathsResult([`${nmBox.root}/node_modules/pkg/index.js`]);
await nmBox.cleanup();
JSON.stringify(nmEdit)
=> {"feedback":"Edit touches the box's npm/package surface (node_modules) — make sure this is a deliberate dependency/tooling change, not accidental drift.","hasErrors":false}
```

An edit inside a legitimate underscore area or another vocabulary entry
stays quiet — the tripwire fires only on a top-level segment outside the
closed vocabulary, or the npm namespace specifically:

```ts
const quietBox = await makeTmpBox();
await quietBox.write("_content/inbox/x.memo.card", "---\nstatus: new\ncreated: 2026-01-01T00:00:00Z\n---\n");
const quietEdit = await validateHookPathsResult([`${quietBox.root}/_content/inbox/x.memo.card`]);
await quietBox.cleanup();
quietEdit.feedback
=> null
```
