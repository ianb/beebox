// # Parsing through the TypeScript 7 process
//
// `createParser` (`src/lib/typescript/syntax.ts`) returns syntax trees from the
// TypeScript 7 Go process. Its callers walk them with the 5.x node shape:
// `kind`, `parent`, `forEachChild`, `getText`.

import { test } from "tap";
import "agent-doctest/tap";
import { eventually } from "agent-doctest/check";
import { spawnSync } from "node:child_process";
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

// The file name decides how the text parses: `.tsx` allows JSX, and the case of
// the name does not matter. A tree stays readable after the parser closes.
void test("The file name decides how the text parses:", async (t) => {
  // doctest:L26
  const parser = createParser();
  const view = parser.parse({ fileName: "Card.TSX", sourceText: "export default function V({ body }) { return <p>{body}</p>; }\n" });
  const module = parser.parse({ fileName: "a.ts", sourceText: "import x from './y.js';\nx();\n" });
  parser.close();
  t.check(
    ({
      kind: SyntaxKind[view.kind],
      identifiers: identifiers(view),
      statements: module.statements.map((statement) => SyntaxKind[statement.kind]),
      firstParent: SyntaxKind[module.statements[0]?.parent.kind ?? SyntaxKind.Unknown],
      callLine: module.getLineAndCharacterOfPosition(module.text.indexOf("x()")).line,
    }),
    {
    kind: "SourceFile",
    identifiers: [
      "V",
      "body",
      "p",
      "body",
      "p",
    ],
    statements: [
      "ImportDeclaration",
      "ExpressionStatement",
    ],
    firstParent: "SourceFile",
    callLine: 1,
  },
  );
});

// A name that is not a TypeScript or JavaScript file is refused before anything
// is sent to the process:
void test("A name that is not a TypeScript or JavaScript file is refused before anything...", async (t) => {
  // doctest:L50
  const named = createParser();
  await t.checkThrows(async () => (named.parse({ fileName: "notes.md", sourceText: "# hi" })), "ParseError");

  // doctest:L56
  named.close();
});

// When the TypeScript process dies, the next parse throws instead of returning
// a tree, and `close` is still safe. The Markdown check turns that throw into a
// message for the agent (`test/core/views/markdown-check.doctest.md`). The
// parser's process is the child started with `--cwd /parse`; the test process
// has other children (tsx's esbuild service).
void test("When the TypeScript process dies, the next parse throws instead of returning...", async (t) => {
  // doctest:L66
  const dying = createParser();
  dying.parse({ fileName: "a.ts", sourceText: "1;" });
  // pgrep exits 1 when nothing matches, so read its output rather than its status.
  const parserPids = (): string[] =>
    spawnSync("pgrep", ["-P", String(process.pid), "-f", "cwd /parse"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const pids = parserPids();
  for (const pid of pids) process.kill(Number(pid), "SIGKILL");
  await t.checkText(pids.length, "1");

  // doctest:L78
  t.check(await eventually(() => parserPids().length === 0, { label: "the TypeScript process exits" }), true);

  // doctest:L83
  await t.checkThrows(async () => (dying.parse({ fileName: "b.ts", sourceText: "2;" })), "Error");

  // doctest:L88
  dying.close();
});
