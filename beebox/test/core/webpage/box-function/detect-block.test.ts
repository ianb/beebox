// # Does a response look like a site refusing the box?
//
// docs/plans/webpage-capture-tools.md. A status that means "not for you", a
// challenge header, or a short page with a challenge marker or phrase. A long
// article that quotes such a phrase is an article, and with no status (the box
// browser) only the page itself counts.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { detectBlock } from "../../../../src/core/webpage/box-function/detect-block.js";

const check = (over: { status?: number | null; headers?: Record<string, string>; html?: string }): string | null =>
  detectBlock({ status: 200, headers: {}, html: "<p>hello</p>", ...over });

void test("Each signal names itself", (t) => {
  t.check(check({}), null);
  t.check(check({ status: 403 }), "the site answered HTTP 403, with no challenge page seen: it may be blocking the box, or the page may not exist");
  t.check(check({ status: 403, html: "<title>Just a moment...</title>" }), "the page is a Cloudflare challenge");
  t.check(check({ status: 404 }), null);
  t.check(check({ headers: { "cf-mitigated": "challenge" } }), "a Cloudflare challenge (cf-mitigated header)");
  t.check(check({ headers: { "x-datadome": "protected" } }), "a DataDome challenge (x-datadome header)");
  t.check(check({ html: "<title>Just a moment...</title>" }), "the page is a Cloudflare challenge");
  t.check(check({ html: "<title>Radware Captcha Page</title>" }), "the page is a Radware challenge");
  t.check(check({ html: "<title>Radware Bot Manager Captcha</title>" }), "the page is a Radware challenge");
  t.check(check({ html: "<p>Please verify you are human</p>" }), 'a short page that says "verify you are human"');
  t.end();
});

// Real small pages on protected sites carry the vendor's script.
void test("A script is not a challenge", (t) => {
  t.check(check({ html: "<title>Manual</title><script src='https://x.perfdrive.com/stormcaster.js'></script><p>hello</p>" }), null);
  t.check(check({ html: "<title>Manual</title><script>var m = 'verify you are human';</script><p>hello</p>" }), null);
  t.end();
});

void test("A long article that quotes a phrase is an article", (t) => {
  t.check(check({ html: `<p>Access denied, the sign said.</p><p>${"x".repeat(21 * 1024)}</p>` }), null);
  t.end();
});

void test("With no status, only the page counts", (t) => {
  t.check(check({ status: null }), null);
  t.check(check({ status: null, html: "<p>Access denied</p>" }), 'a short page that says "access denied"');
  t.end();
});
