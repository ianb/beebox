# Parsing through the TypeScript 7 process

`createParser` (`src/lib/typescript/syntax.ts`) returns syntax trees from the
TypeScript 7 Go process. Its callers walk them with the 5.x node shape:
`kind`, `parent`, `forEachChild`, `getText`.

```ts setup
import { execFileSync } from "node:child_process";
import { createParser, isIdentifier, SyntaxKind, type Node } from "../../../src/lib/typescript/syntax.js";

function identifiers(node: Node): string[] {
  const out: string[] = [];
  const visit = (n: Node): void => {
    if (isIdentifier(n)) out.push(n.text);
    n.forEachChild(visit);
  };
  visit(node);
  return out;
}
```

The file name decides how the text parses: `.tsx` allows JSX, and the case of
the name does not matter. A tree stays readable after the parser closes.

```ts
const parser = createParser();
const view = parser.parse({ fileName: "Card.TSX", sourceText: "export default function V({ body }) { return <p>{body}</p>; }\n" });
const module = parser.parse({ fileName: "a.ts", sourceText: "import x from './y.js';\nx();\n" });
parser.close();
JSON.stringify({
  kind: SyntaxKind[view.kind],
  identifiers: identifiers(view),
  statements: module.statements.length,
  parentLinked: module.statements[0]?.parent === module,
  line: module.getLineAndCharacterOfPosition(module.text.indexOf("x()")).line,
})
=> {"kind":"SourceFile","identifiers":["V","body","p","body","p"],"statements":2,"parentLinked":true,"line":1}
```

A name that is not a TypeScript or JavaScript file is refused before anything
is sent to the process:

```ts
const named = createParser();
named.parse({ fileName: "notes.md", sourceText: "# hi" })
=> throws ParseError
```

```ts continue
named.close();
```

When the TypeScript process dies, the next parse throws instead of returning
a tree, and `close` is still safe. The Markdown check turns that throw into a
message for the agent (`test/core/views/markdown-check.doctest.md`). The
parser's process is the child started with `--cwd /parse`; the test process
has other children (tsx's esbuild service).

```ts
const dying = createParser();
dying.parse({ fileName: "a.ts", sourceText: "1;" });
const pids = execFileSync("pgrep", ["-P", String(process.pid), "-f", "cwd /parse"]).toString().trim().split("\n");
for (const pid of pids) process.kill(Number(pid), "SIGKILL");
await new Promise((resolve) => setTimeout(resolve, 200));
pids.length
=> 1
```

```ts continue
dying.parse({ fileName: "b.ts", sourceText: "2;" })
=> throws Error
```

```ts continue
dying.close();
```
