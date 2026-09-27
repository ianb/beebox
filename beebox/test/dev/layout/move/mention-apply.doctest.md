# Mention-rewrite text mechanics: the path-token boundary rule and `knip.ts` block scoping

```ts setup
import {
  containsToken,
  replaceToken,
  replaceDirectoryToken,
  knipWorkspaceBlockRange,
  replaceTokenInRange,
} from "../../../../src/dev/layout/move/mention-apply.js";
```

## A file token match requires non-path-character boundaries: `src/core/foo.ts` inside `src/core/foo.tsx` or `xsrc/core/foo.ts` doesn't count

```ts
containsToken({ text: "import from src/core/foo.tsx", literal: "src/core/foo.ts" })
=> false

containsToken({ text: "see xsrc/core/foo.ts here", literal: "src/core/foo.ts" })
=> false

containsToken({ text: "see src/core/foo.ts here", literal: "src/core/foo.ts" })
=> true

containsToken({ text: '"src/core/foo.ts"', literal: "src/core/foo.ts" })
=> true
```

## `replaceToken` rewrites every token match and reports the count; a non-matching text is untouched

```ts
JSON.stringify(replaceToken({ text: "See `src/core/foo.ts` and src/core/foo.ts again.", oldToken: "src/core/foo.ts", newToken: "src/core/bar.ts" }))
=> {"text":"See `src/core/bar.ts` and src/core/bar.ts again.","count":2}

JSON.stringify(replaceToken({ text: "unrelated text", oldToken: "src/core/foo.ts", newToken: "src/core/bar.ts" }))
=> {"text":"unrelated text","count":0}
```

## A directory token matches a bare mention (with or without a trailing slash) and a glob continuation, but not a deeper specific file — that's a file mention, already `fileForms`'s job

```ts
containsToken({ text: "scripts/migrated/foo.ts", literal: "scripts/migrate", kind: "directory" })
=> false

containsToken({ text: "see scripts/migrate/foo.ts here", literal: "scripts/migrate", kind: "directory" })
=> false

containsToken({ text: '"scripts/migrate/"', literal: "scripts/migrate", kind: "directory" })
=> true

containsToken({ text: '"scripts/migrate/**/*.ts"', literal: "scripts/migrate", kind: "directory" })
=> true
```

## `replaceDirectoryToken` rewrites a plain directory mention but skips a line with a glob metacharacter, leaving it for review

```ts
const globText = 'moved: "src/schemas/"\nproject: "src/schemas/**/*.list-entry.tsx"\n';
JSON.stringify(replaceDirectoryToken({ text: globText, oldToken: "src/schemas", newToken: "src/cards" }))
=> {"text":"moved: \"src/cards/\"\nproject: \"src/schemas/**/*.list-entry.tsx\"\n","count":1}
```

## `knipWorkspaceBlockRange` finds the balanced-brace range of one package's block, and `replaceTokenInRange` confines a rewrite to it

```ts
const knipText = `export default {
  workspaces: {
    "beebox": {
      entry: ["src/cli/index.ts"],
    },
    "canvas-loop": {
      entry: ["src/cli/index.ts"],
    },
  },
};
`;
const range = knipWorkspaceBlockRange(knipText, "beebox")!;
knipText.slice(range.start, range.end).includes("canvas-loop")
=> false

const rewritten = replaceTokenInRange({ text: knipText, oldToken: "src/cli/index.ts", newToken: "src/cli/entry/run.ts", range });
rewritten.count
=> 1

rewritten.text.includes('"beebox": {\n      entry: ["src/cli/entry/run.ts"],')
=> true

rewritten.text.includes('"canvas-loop": {\n      entry: ["src/cli/index.ts"],')
=> true

knipWorkspaceBlockRange(knipText, "no-such-package")
=> null
```
