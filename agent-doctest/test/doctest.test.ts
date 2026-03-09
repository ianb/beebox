/**
 * Tests for the doctest parser and generator.
 */

import { test } from "tap";
import "../src/tap-check.js";
import {
  parseCodeBlocks,
  parseExample,
  parseExamples,
  generateTestSource,
} from "../src/doctest-hooks.mjs";

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

test("parseExamples: multiple single-line examples in one block", async (t) => {
  const examples = parseExamples('foo("a")\n=> 1\n\nfoo("b")\n=> 2\n\nfoo("c")\n=> 3');
  t.equal(examples.length, 3);
  t.equal(examples[0].expression, 'foo("a")');
  t.equal(examples[0].expected, "1");
  t.equal(examples[1].expression, 'foo("b")');
  t.equal(examples[1].expected, "2");
  t.equal(examples[2].expression, 'foo("c")');
  t.equal(examples[2].expected, "3");
});

test("parseExamples: mixed single and multi-line", async (t) => {
  const examples = parseExamples('quick()\n=> yes\n\nslow()\n=>\nline 1\nline 2');
  t.equal(examples.length, 2);
  t.equal(examples[0].expected, "yes");
  t.equal(examples[1].expected, "line 1\nline 2");
});

test("parseExamples: multi-line ends at blank line", async (t) => {
  const examples = parseExamples('a()\n=>\nfoo\nbar\n\nb()\n=> baz');
  t.equal(examples.length, 2);
  t.equal(examples[0].expected, "foo\nbar");
  t.equal(examples[1].expected, "baz");
});

test("parseExamples: tracks lineOffset", async (t) => {
  const examples = parseExamples('foo()\n=> 1\n\nbar()\n=> 2');
  t.equal(examples[0].lineOffset, 0);
  t.equal(examples[1].lineOffset, 3);
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

test("generateTestSource: no-assertion block generates runnable test", async (t) => {
  const md = `\`\`\`
doStuff()
\`\`\`
`;

  const source = generateTestSource(md, "/test.doctest.md");
  t.ok(source.includes("doStuff()"), "should include the statement");
  t.ok(source.includes("test("), "should generate a test function");
});

test("generateTestSource: cleanup after test emits t.teardown()", async (t) => {
  const md = `\`\`\`
const x = setup()
x.value
=> 42
\`\`\`

\`\`\` cleanup
await x.destroy();
\`\`\`

\`\`\`
const y = other()
y.name
=> hello
\`\`\`
`;

  const source = generateTestSource(md, "/test.doctest.md");
  // Cleanup declared after first test attaches to first test via t.teardown()
  t.ok(source.includes("t.teardown("), "should have teardown");
  t.ok(source.includes("await x.destroy()"), "should include cleanup code");
  // Second test should NOT have the cleanup
  const teardownCount = (source.match(/t\.teardown/g) || []).length;
  t.equal(teardownCount, 1, "cleanup should only apply to one test");
});

test("generateTestSource: cleanup before test emits t.teardown()", async (t) => {
  const md = `\`\`\` cleanup
await cleanup();
\`\`\`

\`\`\`
step1()
=> a
\`\`\`

\`\`\` continue
step2()
=> b
\`\`\`
`;

  const source = generateTestSource(md, "/test.doctest.md");
  t.ok(source.includes("t.teardown("), "should have teardown");
  t.ok(source.includes("await cleanup()"), "should include cleanup");
  // Both steps should be in the same test (continue)
  const testCount = (source.match(/\btest\(/g) || []).length;
  t.equal(testCount, 1, "should have one test function");
});

test("generateTestSource: print() is available per test", async (t) => {
  const md = `\`\`\`
print("hello");
print("world");
42
=> hello
world
42
\`\`\`
`;

  const source = generateTestSource(md, "/test.doctest.md");
  // Each test should get its own __prints and print
  t.ok(source.includes("const __prints = []"), "should declare __prints");
  t.ok(source.includes("const print = "), "should declare print");
  // Check should use __withPrints
  t.ok(source.includes("__withPrints(__prints,"), "should drain prints in check");
});

test("generateTestSource: separate tests get separate print scopes", async (t) => {
  const md = `\`\`\`
print("first");
1
=> first
1
\`\`\`

\`\`\`
print("second");
2
=> second
2
\`\`\`
`;

  const source = generateTestSource(md, "/test.doctest.md");
  // Two tests, each with their own __prints
  const printDecls = (source.match(/const __prints = \[\]/g) || []).length;
  t.equal(printDecls, 2, "each test should have its own __prints");
});
