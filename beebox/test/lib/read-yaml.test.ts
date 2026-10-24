// # Read-only YAML parsing
//
// `parseYaml` (`src/lib/read-yaml.ts`) parses with js-yaml for speed and
// hands text to the `yaml` package wherever the two could disagree, so every
// value and error is `yaml`'s. Each case below is one js-yaml alone reads
// differently (`docs/plans/yaml-read-parser.md`, Failure modes).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseYaml } from "../../src/lib/read-yaml.js";

// Empty and comment-only text is null, as `yaml` returns (js-yaml returns
// undefined), so callers that turn an empty frontmatter block into `{}` work.
void test("Empty or comment-only text is null", async (t) => {
  t.check([parseYaml(""), parseYaml("# only a comment\n")], [null, null]);
});

// The YAML 1.2 core schema: dates stay strings, `yes` is a string, `<<` is an
// ordinary key.
void test("Dates, yes/no and merge keys read as the YAML 1.2 core schema does", async (t) => {
  t.check(parseYaml("due: 2026-01-01\nok: yes\nb: &x {c: 1}\nd:\n  <<: *x\n"), {
    due: "2026-01-01",
    ok: "yes",
    b: { c: 1 },
    d: { "<<": { c: 1 } },
  });
});

// Inputs js-yaml alone reads differently: signed hex and leading-dot numbers,
// `0b` literals, null keys, collection keys, an unknown tag (js-yaml throws),
// a `%YAML 1.1` directive, keys that collide only as strings (js-yaml
// throws), numbers that overflow (js-yaml keeps the text), and a key starting
// `---` (js-yaml takes it as a document marker). Each gives `yaml`'s value.
void test("Inputs js-yaml reads differently give yaml's value", async (t) => {
  const inputs = [
    "a: -.5\nb: +0x1F\nc: 0b101\nd: -0",
    "~: a",
    "null: b",
    "{: a}",
    "[a]: b",
    "? [1, 2]\n: v",
    "a: !foo bar",
    "%YAML 1.1\n---\na: yes",
    "1: a\n\"1\": b",
    `a: 1e999\nb: ${"9".repeat(400)}`,
    "---x: v",
  ];
  t.check(
    inputs.map((text) => parseYaml(text)),
    [
      { a: -0.5, b: "+0x1F", c: "0b101", d: -0 },
      { "": "a" },
      { "": "b" },
      { "": "a" },
      { "[ a ]": "b" },
      { "[ 1, 2 ]": "v" },
      { a: "bar" },
      { a: true },
      { "1": "b" },
      { a: Infinity, b: Infinity },
      { "---x": "v" },
    ],
  );
});

// Malformed text throws `yaml`'s error, so messages keep `yaml`'s wording.
// js-yaml accepts the last two: a flow collection continued below its key's
// indentation, and a bare carriage return.
void test("Malformed YAML throws the yaml package's error", async (t) => {
  t.checkThrows(
    () => parseYaml("a: [1, 2"),
    "YAMLParseError: Flow sequence in block collection must be sufficiently indented and end with a ] at line 1, column 9:\n\na: [1, 2\n        ^\n",
  );
  t.checkThrows(
    () => parseYaml("a: [1,\n2]"),
    "YAMLParseError: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1:\n\na: [1,\n2]\n^\n",
  );
  t.checkThrows(
    () => parseYaml("a: 1\rb: 2"),
    "YAMLParseError: Nested mappings are not allowed in compact mappings at line 1, column 4:\n\na: 1\rb: 2\n   ^\n",
  );
});

// Nested aliases that would expand to millions of values hit `yaml`'s alias
// limit instead of expanding: js-yaml has no limit.
void test("Alias expansion keeps yaml's limit", async (t) => {
  const levels = ["l0: &l0 [x, x, x, x, x, x, x, x, x, x]"];
  for (let i = 1; i < 12; i++) levels.push(`l${i}: &l${i} [${Array.from({ length: 10 }, () => `*l${i - 1}`).join(", ")}]`);
  t.checkThrows(() => parseYaml(levels.join("\n")), "ReferenceError: Excessive alias count indicates a resource exhaustion attack");
});
