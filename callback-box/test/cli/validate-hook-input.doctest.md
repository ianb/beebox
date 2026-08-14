# Validation hook input

The installed Claude and Codex plugins call the same validation command. Claude
Write/Edit hooks provide one `file_path`; Codex `apply_patch` hooks provide a
patch command that can name several files.

```ts setup
import { parseHookFilePaths } from "../../src/cli/commands/validate-hook.js";
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
*** Update File: store/One.memo.card
@@
-old
+new
*** Add File: store/Two.memo.card
+new
*** Delete File: store/Old.memo.card
*** End Patch`,
  },
}))
=> ["store/One.memo.card","store/Two.memo.card","store/Old.memo.card"]
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
  tool_input: { command: "*** Begin Patch\n*** Update File: store/One.memo.card\n*** End Patch" },
}))
=> ["/box/content/store/One.memo.card"]
```
