// # Read-only YAML parsing
//
// `parseYaml` (`src/lib/read-yaml.ts`) reads YAML with js-yaml's core schema;
// writes and edits stay on the `yaml` package. These cases pin where it agrees
// with `yaml`'s defaults and the hand-typed inputs where it does not
// (`docs/plans/yaml-read-parser.md`, Failure modes).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isYamlSyntaxError, parseYaml } from "../../src/lib/read-yaml.js";

// Empty and comment-only text is null, as `yaml` returns, so callers that turn
// an empty frontmatter block into `{}` keep working.
void test("Empty or comment-only text is null", async (t) => {
  t.check([parseYaml(""), parseYaml("# only a comment\n")], [null, null]);
});

// The core schema: dates stay strings, `yes` is a string, `<<` is an ordinary key.
void test("Dates, yes/no and merge keys read as the YAML 1.2 core schema does", async (t) => {
  t.check(parseYaml("due: 2026-01-01\nok: yes\nb: &x {c: 1}\nd:\n  <<: *x\n"), {
    due: "2026-01-01",
    ok: "yes",
    b: { c: 1 },
    d: { "<<": { c: 1 } },
  });
});

// Differences from `yaml` on hand-typed values: a signed float with no digit
// before the point stays a string, and a binary literal is a number.
void test("Signed leading-dot floats stay strings; 0b literals are numbers", async (t) => {
  t.check(parseYaml("a: -.5\nb: .5\nc: 0b101\n"), { a: "-.5", b: 0.5, c: 5 });
});

// Malformed text, a duplicate key and an unknown tag are syntax errors
// (`yaml` only warns on an unknown tag); other errors are not.
void test("Malformed YAML, duplicate keys and unknown tags are syntax errors", async (t) => {
  const thrown = (text: string): unknown => {
    try {
      parseYaml(text);
    } catch (error) {
      return error;
    }
    return undefined;
  };
  t.check(
    [thrown("a: [1, 2"), thrown("a: 1\na: 2"), thrown("a: !foo bar"), thrown("a: *nope")].map(isYamlSyntaxError),
    [true, true, true, true],
  );
  t.check(isYamlSyntaxError(new Error("other")), false);
});
