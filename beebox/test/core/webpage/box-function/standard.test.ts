// # `standard`: refuse what looks blocked or failed, otherwise read the page
//
// docs/plans/webpage-capture-tools.md. Links leave the site absolute, and page
// script never runs. A page with almost no text is kept and says so.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { standard } from "../../../../src/core/webpage/box-function/standard.js";
import type { CapturedResponse } from "../../../../src/core/webpage/response.js";

const ARTICLE = `<!DOCTYPE html><html><head><title>Raised beds</title>
<script>document.title = "script ran";</script></head><body><article><h1>Raised beds</h1>
<p>${"Raised beds warm early in spring and drain well through wet weeks. ".repeat(8)}</p>
<p>See <a href="/guide">the guide</a>.</p></article></body></html>`;

function response(over: Partial<CapturedResponse>): CapturedResponse {
  return { url: "https://garden.example/beds", requestedUrl: "https://garden.example/beds", redirectedFrom: [], status: 200, headers: {}, contentType: "text/html", html: ARTICLE, via: "http", ...over };
}

void test("A page becomes its title and markdown, with absolute links and no script run", (t) => {
  const result = standard(response({}));
  if ("refuse" in result) throw new Error("refused");
  t.check(result.title, "Raised beds");
  t.check(result.markdown.split("\n").at(-1), "See [the guide](https://garden.example/guide).");
  t.check(result.note, undefined);
  t.end();
});

void test("A failed or blocked status is refused", (t) => {
  t.check(standard(response({ status: 404 })), { refuse: "the site answered HTTP 404" });
  t.check(standard(response({ status: 403 })), { refuse: "the site answered HTTP 403" });
  t.end();
});

void test("A page with almost no text is kept, with a note", (t) => {
  const result = standard(response({ html: "<html><head><title>App</title></head><body><div id=root></div></body></html>" }));
  if ("refuse" in result) throw new Error("refused");
  t.check(result.note, "Almost no text was found. The page may need scripts to show its content.");
  t.end();
});
