// # Getting a page over HTTP
//
// docs/plans/webpage-capture-tools.md. A redirect is followed only when it is
// the same page in another form, and each hop is recorded; any other redirect
// goes back to the agent with the chain so far. The server is a fake `fetch`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { fetchPage, isSamePageForm } from "../../../src/core/webpage/fetch.js";

function sequence(steps: Record<string, Response>): typeof fetch {
  return async (input) => {
    const answer = steps[input instanceof URL ? input.href : String(input)];
    if (answer === undefined) throw new Error(`unexpected request: ${String(input)}`);
    return answer;
  };
}

const redirect = (location: string): Response => new Response(null, { status: 301, headers: { location } });
const found = (location: string): Response => new Response(null, { status: 302, headers: { location } });
const page = (html: string): Response => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

void test("Same page, another form", (t) => {
  const same = (a: string, b: string): boolean => isSamePageForm(new URL(a), new URL(b));
  t.check(same("http://a.example/x", "https://a.example/x"), true);
  t.check(same("https://a.example/x", "https://www.a.example/x"), true);
  t.check(same("https://a.example/x", "https://a.example/x/"), true);
  t.check(same("https://a.example/x", "http://a.example/x"), false);
  t.check(same("https://a.example/x", "https://a.example/login"), false);
  t.check(same("https://a.example/x?a=1", "https://a.example/x?a=2"), false);
  t.check(same("https://t.example/x", "https://news.example/x"), false);
  t.end();
});

void test("A same-form redirect is followed and recorded", async (t) => {
  const fetchImpl = sequence({ "http://a.example/x": redirect("https://a.example/x"), "https://a.example/x": page("<p>hi</p>") });
  const outcome = await fetchPage({ url: "http://a.example/x", from: [], fetchImpl });
  if (outcome.kind !== "page") throw new Error(outcome.kind);
  t.check([outcome.response.url, outcome.response.requestedUrl, outcome.response.redirectedFrom, outcome.response.status, outcome.response.via],
    ["https://a.example/x", "http://a.example/x", ["http://a.example/x"], 200, "http"]);
});

void test("A redirect to a sign-in page stops, with the whole chain", async (t) => {
  const fetchImpl = sequence({ "https://a.example/x": found("/login?next=x") });
  t.check(await fetchPage({ url: "https://a.example/x", from: ["https://t.example/1"], fetchImpl }),
    { kind: "redirect", status: 302, target: "https://a.example/login?next=x", chain: ["https://t.example/1", "https://a.example/x"] });
});

void test("--from addresses reach the response, oldest first", async (t) => {
  const outcome = await fetchPage({ url: "https://b.example/", from: ["https://a.example/"], fetchImpl: sequence({ "https://b.example/": page("<p>hi</p>") }) });
  if (outcome.kind !== "page") throw new Error(outcome.kind);
  t.check([outcome.response.requestedUrl, outcome.response.redirectedFrom], ["https://a.example/", ["https://a.example/"]]);
});

void test("A redirect loop, a non-web target, a non-page, and a bad address fail", async (t) => {
  const loop = sequence({ "http://a.example/": redirect("https://a.example/"), "https://a.example/": redirect("https://www.a.example/"), "https://www.a.example/": redirect("https://a.example/") });
  t.check(await fetchPage({ url: "http://a.example/", from: [], fetchImpl: loop }),
    { kind: "failed", message: "Redirect loop: http://a.example/ -> https://a.example/ -> https://www.a.example/ -> https://a.example/" });
  t.check(await fetchPage({ url: "https://a.example/", from: [], fetchImpl: sequence({ "https://a.example/": redirect("ftp://a.example/") }) }),
    { kind: "failed", message: "https://a.example/ redirects to something that is not a web address: ftp://a.example/" });
  t.check(await fetchPage({ url: "https://a.example/f.pdf", from: [], fetchImpl: sequence({ "https://a.example/f.pdf": new Response("x", { status: 200, headers: { "content-type": "application/pdf" } }) }) }),
    { kind: "failed", message: "https://a.example/f.pdf is not a web page: its type is application/pdf" });
  t.check(await fetchPage({ url: "file:///etc/passwd", from: [] }), { kind: "failed", message: "Not a web address: file:///etc/passwd" });
});

// A failed status reaches the box function: `standard` refuses it, and a box may know better.
void test("A failed status with a page body is still a page", async (t) => {
  const outcome = await fetchPage({ url: "https://a.example/", from: [], fetchImpl: sequence({ "https://a.example/": new Response("<p>no</p>", { status: 403, headers: { "content-type": "text/html" } }) }) });
  if (outcome.kind !== "page") throw new Error(outcome.kind);
  t.check(outcome.response.status, 403);
});

void test("A body over the limit fails", async (t) => {
  const outcome = await fetchPage({ url: "https://a.example/", from: [], fetchImpl: sequence({ "https://a.example/": page("x".repeat(11 * 1024 * 1024)) }) });
  t.check(outcome, { kind: "failed", message: "https://a.example/ is over the 10 MB limit" });
});
