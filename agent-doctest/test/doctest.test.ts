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

test("parseExamples: blank lines and arrows inside a template literal are content, not boundaries", async (t) => {
  const expr = 'const s = `first\n\n=> not an arrow\nlast`';
  const examples = parseExamples(`${expr}\ns.length > 0\n=> true`);
  t.equal(examples.length, 1);
  t.equal(examples[0].expression, `${expr}\ns.length > 0`);
  t.equal(examples[0].expected, "true");
});

test("generateTestSource: template-literal content is emitted verbatim (no injected indent)", async (t) => {
  const md = '```\nconst ics = `BEGIN:VCALENDAR\nEND:VCALENDAR`;\nics.split("\\n").length\n=> 2\n```\n';
  const source = generateTestSource(md, "/test.doctest.md");
  t.ok(source.includes("const ics = `BEGIN:VCALENDAR\nEND:VCALENDAR`;"),
    "template lines must not be re-indented");
  t.notOk(/\n\s+END:VCALENDAR/.test(source), "no whitespace prepended inside the literal");
});

test("parseExamples: backticks inside quoted strings or line comments don't open a template", async (t) => {
  // Three backticks inside a double-quoted string (markdown fence in test
  // data) must not flip the template tracker — this exact shape appears in
  // callback-box's reactor.doctest.md and once broke the whole file.
  const examples = parseExamples('desc.includes("```xml")\n=> true\n\nfoo() // don`t count `these`\n=> 1');
  t.equal(examples.length, 2);
  t.equal(examples[0].expression, 'desc.includes("```xml")');
  t.equal(examples[1].expected, "1");
});

test("generateTestSource: a semicolon at a template-literal line end is not a statement boundary", async (t) => {
  const md = '```\nconst s = `content;\nmore`;\ns.includes(";")\n=> true\n```\n';
  const source = generateTestSource(md, "/test.doctest.md");
  t.ok(source.includes('t.check(__withPrints(__prints, s.includes(";"))'),
    "the check expression is the line after the literal closes");
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

test("generateTestSource: throws assertion emits an awaited async thunk", async (t) => {
  const md = `\`\`\`
await failAsync()
=> throws RangeError
\`\`\`
`;

  const source = generateTestSource(md, "/test.doctest.md");
  t.ok(
    source.includes("await t.checkThrows(async () => (await failAsync())"),
    "throws thunk is async and awaited, so await-containing expressions compile",
  );
});

test("generateTestSource: continue block with no open test throws", async (t) => {
  const md = `\`\`\`ts setup
const x = 1;
\`\`\`

\`\`\`ts continue
x + 1
=> 2
\`\`\`
`;

  t.throws(
    () => generateTestSource(md, "/test.doctest.md"),
    /has no open test to continue/,
    "orphan continue is a generation-time error, not a silent new test",
  );
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

// ── Throws parsing ──────────────────────────────────────────────────────────

test("parseExample: throws with error name only", async (t) => {
  const result = parseExample("badCall()\n=> throws TypeError");
  t.equal(result.expression, "badCall()");
  t.equal(result.expected, "TypeError");
  t.equal((result as { throws?: boolean }).throws, true);
});

test("parseExample: throws with error name and message", async (t) => {
  const result = parseExample('badCall()\n=> throws RangeError: value out of range');
  t.equal(result.expression, "badCall()");
  t.equal(result.expected, "RangeError: value out of range");
  t.equal((result as { throws?: boolean }).throws, true);
});

test("parseExamples: throws mixed with normal assertions", async (t) => {
  const examples = parseExamples('good()\n=> 42\n\nbad()\n=> throws Error\n\nalso()\n=> fine');
  t.equal(examples.length, 3);
  t.equal(examples[0].expected, "42");
  t.equal((examples[0] as { throws?: boolean }).throws, undefined);
  t.equal(examples[1].expected, "Error");
  t.equal((examples[1] as { throws?: boolean }).throws, true);
  t.equal(examples[2].expected, "fine");
  t.equal((examples[2] as { throws?: boolean }).throws, undefined);
});

test("generateTestSource: throws emits t.checkThrows", async (t) => {
  const md = `\`\`\`
badCall()
=> throws TypeError
\`\`\`
`;

  const source = generateTestSource(md, "/test.doctest.md");
  t.ok(source.includes("t.checkThrows("), "should use t.checkThrows");
  t.ok(source.includes('"TypeError"'), "should include expected error name");
  t.ok(source.includes('"name"'), "should use name mode for name-only");
});

test("generateTestSource: throws with message uses full mode", async (t) => {
  const md = `\`\`\`
badCall()
=> throws RangeError: out of range
\`\`\`
`;

  const source = generateTestSource(md, "/test.doctest.md");
  t.ok(source.includes("t.checkThrows("), "should use t.checkThrows");
  t.ok(source.includes('"full"'), "should use full mode for name:message");
});

// ── Print scopes ────────────────────────────────────────────────────────────

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
