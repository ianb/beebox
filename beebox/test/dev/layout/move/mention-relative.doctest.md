# Form 4: a mention relative to the mentioning file's own directory

```ts setup
import { relativeCandidates, isRelativeMentionCandidateFile } from "../../../../src/dev/layout/move/mention-relative.js";

const move = { from: "pkg/src/a.ts", to: "pkg/src/sub/a.ts" };
const moveMap = new Map([[move.from, move.to]]);
```

## A `.ts` module gets three candidate styles (raw, `.js`, extensionless), relative to the mentioning file's directory

```ts
const candidates = relativeCandidates({ move, mentioningPath: "pkg/docs/readme.md", moveMap });
JSON.stringify(candidates)
=> [{"old":"../src/a.ts","new":"../src/sub/a.ts"},{"old":"../src/a.js","new":"../src/sub/a.js"},{"old":"../src/a","new":"../src/sub/a"}]
```

## When the mentioning file itself also moves, the "new" side is relative to ITS new directory

```ts
const movedMentioner = new Map([[move.from, move.to], ["pkg/docs/readme.md", "pkg/deep/guides/readme.md"]]);
const candidates2 = relativeCandidates({ move, mentioningPath: "pkg/docs/readme.md", moveMap: movedMentioner });
JSON.stringify(candidates2[0])
=> {"old":"../src/a.ts","new":"../../src/sub/a.ts"}
```

## A non-module (no real extension swap) move gets only its raw extension's candidate

```ts
const jsonMove = { from: "pkg/data/x.json", to: "pkg/data/y/x.json" };
JSON.stringify(relativeCandidates({ move: jsonMove, mentioningPath: "pkg/scripts/run.sh", moveMap: new Map([[jsonMove.from, jsonMove.to]]) }))
=> [{"old":"../data/x.json","new":"../data/y/x.json"}]
```

## Only JSON/shell/YAML/Markdown files are relative-mention candidates — a `.ts` file's specifiers are the AST importer's job instead

```ts
isRelativeMentionCandidateFile("docs/note.md")
=> true

isRelativeMentionCandidateFile("scripts/run.sh")
=> true

isRelativeMentionCandidateFile("src/a.ts")
=> false
```
