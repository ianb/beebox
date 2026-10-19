// # private-link-check: no public→private links
//
// Lexical guard for doc-check: a tracked (public) file must never link into
// `private-issues/`, the gitignored symlink some developers mount to a separate
// private repo. The check is lexical (string/path matching, no `fs`) so it
// catches the link on every machine — including one where the symlink exists
// and would otherwise resolve.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isForbiddenPrivateLinkTarget, findPrivateLinkViolations, PRIVATE_LINK_REASON } from "../../../src/dev/doc-check/private-link.js";

// ## Forbidden forms: relative, `../`-relative, root-relative, dev-browser URL
void test("Forbidden forms: relative, `../`-relative, root-relative, dev-browser URL", async (t) => {
  // doctest:L16
  t.check(isForbiddenPrivateLinkTarget("private-issues/foo.md"), true);

  // doctest:L19
  t.check(isForbiddenPrivateLinkTarget("../../private-issues/bar.md"), true);

  // doctest:L22
  t.check(isForbiddenPrivateLinkTarget("/private-issues/baz.md"), true);

  // doctest:L25
  t.check(isForbiddenPrivateLinkTarget("/workstreams/issues/private/some-thread"), true);

  // doctest:L28
  t.check(
    // The permanent legacy redirect stays forbidden too.
    isForbiddenPrivateLinkTarget("http://localhost:3210/main/test1/dev/issues/private/some-thread")
    ,
    true,
  );
});

// ## Not flagged: prose-like substrings, other hosts, unrelated routes
void test("Not flagged: prose-like substrings, other hosts, unrelated routes", async (t) => {
  // doctest:L36
  t.check(
    // segment-exact: "not-private-issues-thing.md" must not match
    isForbiddenPrivateLinkTarget("not-private-issues-thing.md"),
    false,
  );

  // doctest:L40
  t.check(isForbiddenPrivateLinkTarget("issues/features/private-issues-migration.md"), false);

  // doctest:L43
  t.check(
    // an external URL to another host is fine unless its path is the private browser route
    isForbiddenPrivateLinkTarget("https://example.com/private-issues/README.md")
    ,
    false,
  );

  // doctest:L47
  t.check(isForbiddenPrivateLinkTarget("docs/testing.md"), false);

  // doctest:L50
  t.check(isForbiddenPrivateLinkTarget("/workstreams/issues/public/some-thread"), false);
});

// ## findPrivateLinkViolations flags inline links and reference-style definitions
void test("findPrivateLinkViolations flags inline links and reference-style definitions", async (t) => {
  // doctest:L57
  const inline = findPrivateLinkViolations("issues/features/x.md", "see [private thread](../private-issues/thread.md) for detail");
  t.check(inline, [
    {
      path: "issues/features/x.md",
      line: 1,
      target: "../private-issues/thread.md",
    },
  ]);

  // doctest:L61
  const refStyle = findPrivateLinkViolations("docs/x.md", "context: [ref]\n\n[ref]: /private-issues/thread.md");
  t.check(refStyle, [
    {
      path: "docs/x.md",
      line: 3,
      target: "/private-issues/thread.md",
    },
  ]);
});

// ## Prose mentions and inline-code examples stay clean
void test("Prose mentions and inline-code examples stay clean", async (t) => {
  // doctest:L69
  const prose = findPrivateLinkViolations("issues/AGENTS.md", "private-issues is a separate private repo; see the private README for details.");
  t.check(prose, []);

  // doctest:L73
  const code = findPrivateLinkViolations("issues/AGENTS.md", "the forbidden form looks like `[t](private-issues/foo.md)` — do not write this in a public file.");
  t.check(code, []);

  // doctest:L77
  const fence = "```\n[t](private-issues/foo.md)\n```";
  const fenced = findPrivateLinkViolations("issues/AGENTS.md", fence);
  t.check(fenced, []);
});

// ## A legal private→public link (the other direction) stays clean
void test("A legal private→public link (the other direction) stays clean", async (t) => {
  // doctest:L86
  const legal = findPrivateLinkViolations("issues/features/x.md", "[public doc](../../beebox/docs/testing.md)");
  t.check(legal, []);
});

// ## Angle-bracket inline link destinations are unwrapped (CommonMark form)
void test("Angle-bracket inline link destinations are unwrapped (CommonMark form)", async (t) => {
  // doctest:L94
  t.check(isForbiddenPrivateLinkTarget("<private-issues/a.md>"), true);

  // doctest:L97
  t.check(
    // a title after the closing bracket doesn't hide the path
    isForbiddenPrivateLinkTarget('<private-issues/a.md> "some title"'),
    true,
  );

  // doctest:L101
  const bracketed = findPrivateLinkViolations("issues/features/x.md", "see [t](<private-issues/a.md>) for detail");
  t.check(bracketed, [
    {
      path: "issues/features/x.md",
      line: 1,
      target: "<private-issues/a.md>",
    },
  ]);
});

// ## Doctest fixtures are covered: prose errors, fenced code stays exempt
//
// Doctest files (`.doctest.md`) are public tracked markdown — doc-check now
// scans them too — but they legitimately contain link syntax inside fenced
// code blocks (the code under test). A private-issues link in doctest prose
// must still error; the same text inside a fenced block must not.
void test("Doctest files (.doctest.md) are public tracked markdown — doc-check now scans...", async (t) => {
  // doctest:L114
  const doctestProse = findPrivateLinkViolations("test/example.doctest.md", "See [the private thread](../private-issues/thread.md) for background before running this doctest.");
  t.check(doctestProse, [
    {
      path: "test/example.doctest.md",
      line: 1,
      target: "../private-issues/thread.md",
    },
  ]);

  // doctest:L118
  const fence = "```ts\nconst x = \"[t](private-issues/thread.md)\";\n```";
  const doctestFenced = findPrivateLinkViolations("test/example.doctest.md", fence);
  t.check(doctestFenced, []);
});

// ## The reason string names the rule and the fix
void test("The reason string names the rule and the fix", async (t) => {
  // doctest:L127
  t.check(PRIVATE_LINK_REASON, "public files must not link into private-issues/ — it is a separate private repo; move the link into a private issue instead (private→public links are allowed)");
});
