import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ClassValue,
  findMatch,
  parsePattern,
  parseToken,
  tokenMatches,
  tokensOf,
} from "../lib/class-matcher.ts";

/** Whether `token` matches `pattern`. */
function matches(token: string, pattern: string): boolean {
  const parsed = parseToken(token);
  assert.notEqual(parsed, null);
  return parsed !== null && tokenMatches(parsed, parsePattern(pattern));
}

function value(unconditional: string, ...operands: string[]): ClassValue {
  return { unconditional: tokensOf(unconditional), operands: operands.map(tokensOf) };
}

function entry(all: string[], none?: string[]) {
  return { all: all.map(parsePattern), none: (none ?? []).map(parsePattern) };
}

/** The outline-removal entry shape that Track 11 configures: removal needs a focus replacement. */
const OUTLINE = entry(
  ["outline-none|focus:outline-none"],
  [
    "focus:ring-*|focus-visible:ring-*|focus:border-*|focus-visible:border-*",
    "focus:outline-*!focus:outline-none|focus-visible:outline-*!focus-visible:outline-none",
  ],
);

describe("class matcher: tokens", () => {
  it("splits the variant chain off the utility", () => {
    assert.deepEqual(parseToken("sm:focus-visible:ring-2"), {
      raw: "sm:focus-visible:ring-2",
      variants: ["focus-visible"],
      utility: "ring-2",
    });
  });

  it("keeps a colon inside an arbitrary variant", () => {
    assert.deepEqual(parseToken("[&:hover]:fixed"), {
      raw: "[&:hover]:fixed",
      variants: ["[&:hover]"],
      utility: "fixed",
    });
  });

  it("drops the important marker from the utility", () => {
    assert.deepEqual(parseToken("!fixed"), { raw: "!fixed", variants: [], utility: "fixed" });
  });
});

describe("class matcher: patterns", () => {
  it("globs the utility", () => {
    assert.deepEqual(
      [matches("z-50", "z-*"), matches("z", "z-*"), matches("zz-1", "z-*")],
      [true, false, false],
    );
  });

  it("ignores responsive variants and dark", () => {
    assert.deepEqual(
      [matches("md:fixed", "fixed"), matches("dark:2xl:fixed", "fixed")],
      [true, true],
    );
  });

  it("requires every other variant to be listed", () => {
    assert.deepEqual(
      [
        matches("hover:ring-2", "focus-visible:ring-*"),
        matches("md:focus:border-accent", "focus:border-*"),
        matches("focus:outline-none", "outline-none"),
      ],
      [false, true, false],
    );
  });

  it("matches variants in any order", () => {
    assert.equal(matches("hover:focus:ring-2", "focus:hover:ring-*"), true);
  });

  it("takes alternatives with |", () => {
    assert.deepEqual(
      [
        matches("outline-none", "outline-none|focus:outline-none"),
        matches("focus:outline-none", "outline-none|focus:outline-none"),
      ],
      [true, true],
    );
  });

  it("excludes with !", () => {
    assert.deepEqual(
      [
        matches("focus:outline-2", "focus:outline-*!focus:outline-none"),
        matches("focus:outline-none", "focus:outline-*!focus:outline-none"),
      ],
      [true, false],
    );
  });

  it("escapes regular-expression characters in a pattern", () => {
    assert.deepEqual([matches("z-[100]", "z-[100]"), matches("z-1001", "z-[100]")], [true, false]);
  });
});

describe("class matcher: candidate sets", () => {
  it("matches a combination in one branch with the unconditional tokens", () => {
    // cn("z-10", a ? "fixed" : "absolute") against all: [fixed, z-*]
    assert.deepEqual(findMatch(value("z-10", "fixed", "absolute"), entry(["fixed", "z-*"])), [
      "fixed",
      "z-10",
    ]);
  });

  it("does not combine two operands (correlated conditions)", () => {
    // clsx(a && "absolute top-full", !a && "z-50")
    assert.equal(
      findMatch(value("", "absolute top-full", "z-50"), entry(["absolute", "top-full", "z-*"])),
      null,
    );
  });

  it("misses a combination split across independent operands (documented)", () => {
    // a && "absolute", b && "top-full z-50"
    assert.equal(
      findMatch(value("", "absolute", "top-full z-50"), entry(["absolute", "top-full", "z-*"])),
      null,
    );
  });

  it("counts a none pattern in the same operand as the match", () => {
    assert.equal(findMatch(value("", "fixed static"), entry(["fixed"], ["static"])), null);
  });

  it("counts a none pattern in the unconditional tokens", () => {
    assert.equal(findMatch(value("static", "fixed"), entry(["fixed"], ["static"])), null);
  });

  it("does not let a none pattern in another operand excuse a match", () => {
    assert.deepEqual(findMatch(value("", "fixed", "static"), entry(["fixed"], ["static"])), [
      "fixed",
    ]);
  });

  it("returns one match with many unrelated optional classes", () => {
    assert.deepEqual(
      findMatch(
        value("animate-spin", "p-1", "p-2", "p-3", "p-4", "p-5", "p-6"),
        entry(["animate-spin"]),
      ),
      ["animate-spin"],
    );
  });

  it("reports a later class that twMerge would override", () => {
    assert.deepEqual(findMatch(value("fixed static"), entry(["fixed"])), ["fixed"]);
  });

  it("matches nothing for an empty all list", () => {
    assert.equal(findMatch(value("fixed"), entry([])), null);
  });
});

describe("class matcher: outline removal entry", () => {
  const cases: [string, boolean][] = [
    ["outline-none hover:ring-2", true],
    ["focus:outline-none", true],
    ["focus:outline-none focus-visible:ring-2", false],
    ["outline-none md:focus-visible:ring-2", false],
    ["outline-none focus:border-accent", false],
    // Removal does not count as its own replacement.
    ["focus:outline-none focus:outline-none", true],
  ];
  for (const [classes, fires] of cases) {
    it(`${fires ? "fires on" : "passes"} "${classes}"`, () => {
      assert.equal(findMatch(value(classes), OUTLINE) !== null, fires);
    });
  }
});
