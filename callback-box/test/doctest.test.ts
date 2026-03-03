/**
 * Tests for the doctest parser and generator.
 */

import { test } from "tap";
import "../src/test-lib/tap-check.js";
import {
  parseCodeBlocks,
  parseExample,
  generateTestSource,
} from "../src/test-lib/doctest-hooks.mjs";

test("parseCodeBlocks extracts fenced code blocks", async (t) => {
  const md = `# Title

\`\`\`ts setup
import { foo } from "./foo.js";
\`\`\`

Some text.

\`\`\`
foo("bar")
=> baz
\`\`\`
`;

  const blocks = parseCodeBlocks(md);
  t.equal(blocks.length, 2);
  t.equal(blocks[0].info, "ts setup");
  t.equal(blocks[0].content, 'import { foo } from "./foo.js";');
  t.equal(blocks[1].info, "");
  t.ok(blocks[1].content.includes("foo(\"bar\")"));
  t.ok(blocks[1].content.includes("=> baz"));
});

test("parseCodeBlocks tracks line numbers", async (t) => {
  const md = `line 1
\`\`\`
content
\`\`\`
`;

  const blocks = parseCodeBlocks(md);
  t.equal(blocks.length, 1);
  t.equal(blocks[0].line, 3, "content starts on line 3 (1-based)");
});

test("parseExample: single-line result", async (t) => {
  const result = parseExample('foo("bar")\n=> baz');
  t.equal(result.expression, 'foo("bar")');
  t.equal(result.expected, "baz");
});

test("parseExample: multi-line result", async (t) => {
  const result = parseExample('foo()\n=>\nline 1\nline 2');
  t.equal(result.expression, "foo()");
  t.equal(result.expected, "line 1\nline 2");
});

test("parseExample: no expected value", async (t) => {
  const result = parseExample("doSomething()");
  t.equal(result.expression, "doSomething()");
  t.equal(result.expected, null);
});

test("parseExample: strips trailing semicolon from expression", async (t) => {
  const result = parseExample("foo();\n=> bar");
  t.equal(result.expression, "foo()");
  t.equal(result.expected, "bar");
});

test("parseExample: multi-line expression", async (t) => {
  const result = parseExample('foo(\n  "a",\n  "b"\n)\n=> result');
  t.equal(result.expression, 'foo(\n  "a",\n  "b"\n)');
  t.equal(result.expected, "result");
});

test("generateTestSource produces valid test module", async (t) => {
  const md = `# Test

\`\`\`ts setup
import { foo } from "./foo.js";
\`\`\`

\`\`\`
foo("hello")
=> world
\`\`\`
`;

  const source = generateTestSource(md, "/path/to/test.doctest.md");
  t.ok(source.includes('import { test } from "tap"'), "should import tap");
  t.ok(source.includes('import { foo } from "./foo.js"'), "should include setup");
  t.ok(source.includes("foo(\"hello\")"), "should include expression");
  t.ok(source.includes('"world"'), "should include expected value");
  t.ok(source.includes("test.doctest.md:"), "should reference source file");
});

test("generateTestSource: no-assertion block generates pass", async (t) => {
  const md = `\`\`\`
doStuff()
\`\`\`
`;

  const source = generateTestSource(md, "/test.doctest.md");
  t.ok(source.includes("t.pass"), "should use t.pass for no-assertion blocks");
});
