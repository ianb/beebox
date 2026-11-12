// # The dashboard rewrite adds the box's path prefix to root-absolute paths
//
// docs/plans/shared-browser.md, Track C (`rewrite.ts`). The upstream dashboard
// names `/_next/` and `/api/` paths from the site root; under
// `/test1/browser/` they need the prefix, in every quoting form the bundle
// uses, and nowhere else.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { countDashboardPathSites, InvalidRewritePrefixError, isRewritableType, rewriteDashboardBody } from "../../../src/core/browser/rewrite.js";

const PREFIX = "/test1/browser";

// Plan Track C rewrite rule: each quote form gains the prefix.
void test("Every quoting form of a root-absolute path gains the prefix", (t) => {
  t.check(rewriteDashboardBody("<script src=\"/_next/a.js\"></script>", PREFIX), "<script src=\"/test1/browser/_next/a.js\"></script>");
  t.check(rewriteDashboardBody("{\\\"src\\\":\\\"/_next/a.js\\\"}", PREFIX), "{\\\"src\\\":\\\"/test1/browser/_next/a.js\\\"}");
  t.check(rewriteDashboardBody("import('/_next/a.js')", PREFIX), "import('/test1/browser/_next/a.js')");
  t.check(rewriteDashboardBody("url(\"/_next/f.woff2\")", PREFIX), "url(\"/test1/browser/_next/f.woff2\")");
  t.check(rewriteDashboardBody("url(/_next/f.woff2)", PREFIX), "url(/test1/browser/_next/f.woff2)");
  t.check(rewriteDashboardBody("fetch(\"/api/sessions\")", PREFIX), "fetch(\"/test1/browser/api/sessions\")");
  t.check(rewriteDashboardBody("fetch(`/api/sessions`)", PREFIX), "fetch(`/test1/browser/api/sessions`)");
  t.end();
});

// Plan Track C: only `/_next/` and `/api/` after a quote or paren are sites.
void test("Other paths and mid-string occurrences are left alone", (t) => {
  t.check(rewriteDashboardBody("<a href=\"/other/x\">x</a> see https://h/api/x and \"a/_next/b\" and \"/apix/\"", PREFIX), "<a href=\"/other/x\">x</a> see https://h/api/x and \"a/_next/b\" and \"/apix/\"");
  t.end();
});

// Plan Track C: a prefix that is not a clean absolute path is a typed error.
void test("A malformed prefix is refused", async (t) => {
  for (const bad of ["test1/browser", "/test1/browser/", "/a/../b", "/a b", "", "/", "/a//b", "/a?x"]) {
    await t.checkThrows(() => rewriteDashboardBody("\"/_next/x\"", bad), "InvalidRewritePrefixError");
  }
  try {
    rewriteDashboardBody("x", "/a/");
  } catch (err) {
    t.check(err instanceof InvalidRewritePrefixError ? err.prefix : err, "/a/");
  }
});

// Plan Track C: the rewrite runs on a known content-type set.
void test("Only HTML, CSS and JavaScript are rewritable, parameters ignored", (t) => {
  t.check(
    ["text/html; charset=utf-8", "text/css", "application/javascript", "text/javascript; charset=UTF-8", "application/json", "image/png", "text/plain", "application/octet-stream"].map((c) => isRewritableType(c)),
    [true, true, true, true, false, false, false, false],
  );
  t.check(isRewritableType(undefined), false);
  t.end();
});

// Plan Track C: the contract test counts sites with this function.
void test("Path sites are counted with the same pattern the rewrite uses", (t) => {
  t.check(countDashboardPathSites("\"/_next/a\" '/api/b' \\\"/_next/c\\\" (/_next/d) /_next/e"), 4);
  t.check(countDashboardPathSites(rewriteDashboardBody("\"/_next/a\" \"/api/b\"", PREFIX)), 0);
  t.end();
});
