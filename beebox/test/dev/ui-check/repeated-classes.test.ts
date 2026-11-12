// # ui-check: repeated class strings
//
// `repeatedClassProblems` reports an appearance class string of six or more
// tokens that appears in two or more frontend files. These fixtures fix the
// definition of a class-shaped string, an appearance token and a "same"
// string.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseSourceFile } from "../../../src/dev/layout/scan/imports.js";
import { classSetKey, repeatedClassProblems } from "../../../src/dev/ui-check/repeated-classes.js";

function file(name: string, sourceText: string) {
  return { file: name, sourceFile: parseSourceFile({ fileName: `src/${name}`, sourceText }) };
}

const CHIP = "block rounded-lg bg-black/15 px-3 py-2 hover:bg-black/25";
const SUFFIX = "; share it through a primitive, a component or one exported constant";

// The same set in two files is one group, whatever the token order; files and
// groups are sorted so the report is stable.
void test("the same token set in a different order is one group", async (t) => {
  const problems = repeatedClassProblems(
    [
      file("b.tsx", `const a = <a className="${CHIP}" />;`),
      file("a.tsx", "const a = <a className=\"hover:bg-black/25 py-2 px-3 bg-black/15 rounded-lg block\" />;"),
      file("c.tsx", `const a = "${CHIP}";`),
    ],
    [],
  );
  t.check(problems, [`repeated class string "bg-black/15 block hover:bg-black/25 px-3 py-2 rounded-lg" in a.tsx, b.tsx, c.tsx${SUFFIX}`]);
});

// One file repeating its own string is not a finding.
void test("a string repeated inside one file is not a finding", async (t) => {
  t.check(repeatedClassProblems([file("a.tsx", `const a = "${CHIP}"; const b = "${CHIP}";`)], []), []);
});

// Words that look like classes but include a capital letter or punctuation
// are prose.
void test("prose that looks like classes is skipped", async (t) => {
  const text = "const a = \"Pick up where you left off\";";
  t.check(classSetKey("Pick up where you left off".split(" ")), null);
  t.check(repeatedClassProblems([file("a.ts", text), file("b.ts", text)], []), []);
  t.check(classSetKey("pick up where you left off, border".split(" ")), null);
});

// A string with no bg-, border, rounded, shadow, ring- or palette text token
// is layout only.
void test("a layout-only string is skipped", async (t) => {
  const text = "const a = \"flex items-center gap-2 px-3 py-2 min-w-0 text-sm\";";
  t.check(repeatedClassProblems([file("a.tsx", text), file("b.tsx", text)], []), []);
});

// Appearance tokens count after their variant chain; text- counts only with a
// palette role.
void test("appearance tokens are read after variants, and text- needs a palette role", async (t) => {
  t.check(classSetKey(["flex", "gap-2", "px-3", "py-2", "text-sm", "hover:bg-warm-50"]), "flex gap-2 hover:bg-warm-50 px-3 py-2 text-sm");
  t.check(classSetKey(["flex", "gap-2", "px-3", "py-2", "text-sm", "text-warm-700"]), "flex gap-2 px-3 py-2 text-sm text-warm-700");
  t.check(classSetKey(["flex", "gap-2", "px-3", "py-2", "text-sm", "text-left"]), null);
  t.check(classSetKey(["flex", "gap-2", "px-3", "py-2", "text-sm", "md:rounded"]), "flex gap-2 md:rounded px-3 py-2 text-sm");
});

// Variants are kept: strings that differ only in hover: are two sets.
void test("strings that differ only in a hover: variant are two sets", async (t) => {
  const problems = repeatedClassProblems(
    [file("a.tsx", `const a = "${CHIP}";`), file("b.tsx", `const a = "${CHIP.replace("hover:bg-black/25", "bg-black/25")}";`)],
    [],
  );
  t.check(problems, []);
});

// Each quasi of a template is its own string, and a token touching `${}`
// is partial and dropped, so two halves of three tokens do not make six.
void test("a template literal split by ${} counts only whole quasis", async (t) => {
  const split = "const a = `rounded-lg bg-black/15 px-3 ${x} py-2 hover:bg-black/25 block`;";
  t.check(repeatedClassProblems([file("a.tsx", split), file("b.tsx", split)], []), []);
  const partial = "const a = `rounded-lg bg-black/15 px-3 py-2 hover:bg-black/25 block-${x}`;";
  t.check(repeatedClassProblems([file("a.tsx", partial), file("b.tsx", partial)], []), []);
  const whole = `const a = \`${CHIP} \${x}\`;`;
  t.check(repeatedClassProblems([file("a.tsx", whole), file("b.tsx", whole)], []), [
    `repeated class string "bg-black/15 block hover:bg-black/25 px-3 py-2 rounded-lg" in a.tsx, b.tsx${SUFFIX}`,
  ]);
});

// A bbx- hook class is class-shaped and counts as a token.
void test("a bbx- hook class counts as a token", async (t) => {
  const text = "const a = \"bbx-chat-user-attachment rounded-lg bg-black/15 px-3 py-2 block\";";
  t.check(repeatedClassProblems([file("a.tsx", text), file("b.tsx", text)], []), [
    `repeated class string "bbx-chat-user-attachment bg-black/15 block px-3 py-2 rounded-lg" in a.tsx, b.tsx${SUFFIX}`,
  ]);
});

// Five distinct tokens is below the threshold; a repeated token counts once.
void test("a five-token string is below the threshold", async (t) => {
  const text = "const a = \"rounded-lg bg-black/15 px-3 py-2 block block\";";
  t.check(repeatedClassProblems([file("a.tsx", text), file("b.tsx", text)], []), []);
});

// An allowance silences its set; one that no longer repeats is reported.
void test("an allowance silences its set and is reported once stale", async (t) => {
  const key = "bg-black/15 block hover:bg-black/25 px-3 py-2 rounded-lg";
  const text = `const a = "${CHIP}";`;
  t.check(repeatedClassProblems([file("a.tsx", text), file("b.tsx", text)], [{ key, reason: "test" }]), []);
  t.check(repeatedClassProblems([file("a.tsx", text)], [{ key, reason: "test" }]), [
    `allowed repeated class string "${key}" no longer repeats; remove its allowance`,
  ]);
});
