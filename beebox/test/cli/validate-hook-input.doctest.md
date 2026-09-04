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

An edit at the box root, or anywhere under an npm-namespace entry
(`package.json`, a lockfile, `tsconfig.json`, `node_modules/`), runs the
closed-vocabulary root check. A clean root stays silent — the edited file
still gets its own handling (the CLAUDE.md size warning above, for a
root-level CLAUDE.md edit) — but a stray root entry is surfaced:

```ts
const strayBox = await makeTmpBox();
await strayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await writeFile(`${strayBox.root}/package.json`, "{}");
const npmEdit = await validateHookPathsResult([`${strayBox.root}/package.json`]);
await strayBox.cleanup();
JSON.stringify({ hasErrors: npmEdit.hasErrors, feedback: npmEdit.feedback })
=> {"hasErrors":true,"feedback":"Box root: recipes: the box root is a closed vocabulary — user content goes under /_content/"}
```

The same tripwire fires for a `node_modules/` edit, not just the entry
itself:

```ts
const nmBox = await makeTmpBox();
await nmBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await nmBox.write("node_modules/pkg/index.js", "module.exports = {};");
const nmEdit = await validateHookPathsResult([`${nmBox.root}/node_modules/pkg/index.js`]);
await nmBox.cleanup();
nmEdit.hasErrors
=> true
```

A box root with no strays stays quiet for a `package.json` edit — there is
nothing to nudge about:

```ts
const cleanBox = await makeTmpBox();
await writeFile(`${cleanBox.root}/package.json`, "{}");
const cleanEdit = await validateHookPathsResult([`${cleanBox.root}/package.json`]);
await cleanBox.cleanup();
JSON.stringify(cleanEdit)
=> {"feedback":null,"hasErrors":false}
```
