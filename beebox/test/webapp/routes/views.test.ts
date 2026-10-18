// # Views API
//
// The views API serves agent-generated React components. It lists available views, serves compiled JS modules, and returns cards matching a view's dependency globs.

import { test } from "tap";
import "agent-doctest/tap";
import { z } from "zod";
import { makeTestServer } from "../../helpers/doctest-server.js";
import { bodyField } from "../../helpers/doctest-helpers.js";

const VIEW_SOURCE = `
export const name = "Test View";
export const description = "A test view";
export const dependencies = ["_content/**/*.card"];
export const modes = ["page", "chat"];
export default function TestView({ cards }) {
  return <div>Cards: {cards.length}</div>;
}
`;

const DOC_CARD = `---
title: Test doc
---
Test doc content
`;

// ## Serving compiled modules
//
// The module endpoint returns compiled JavaScript (not JSON), so we use `rawRequest` to get the raw payload:
void test("The module endpoint returns compiled JavaScript (not JSON), so we use rawRequ...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L32
  const ctx = await makeTestServer();
  await ctx.seedView("test.tsx", VIEW_SOURCE);

  // doctest:L35
  const res = await ctx.rawRequest({ method: "GET", url: "/api/views/test/module.js" });
  t.check(res.statusCode, 200);

  // The compiled output externalizes React via the window shim:

  // doctest:L43
  await t.checkText(res.payload.includes("__bbxReact"), "true");
});

// A view with a syntax error returns an error module (not a 500):
void test("A view with a syntax error returns an error module (not a 500):", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L54
  const ctx = await makeTestServer();
  await ctx.seedView("broken.tsx", "export default function() { return <div");

  // doctest:L57
  const res = await ctx.rawRequest({ method: "GET", url: "/api/views/broken/module.js" });
  t.check(res.statusCode, 200);

  // doctest:L63
  await t.checkText(res.payload.includes("ErrorView"), "true");

  // doctest:L66
  await t.checkText(res.payload.includes("Compile error"), "false");

  // The error module contains the actual error message:

  // doctest:L73
  await t.checkText(res.payload.includes("Expected"), "true");
});

// ## Fetching cards
//
// The cards endpoint returns cards matching a view's dependency globs:
void test("The cards endpoint returns cards matching a view's dependency globs:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L86
  const ctx = await makeTestServer();
  await ctx.seedView("test.tsx", VIEW_SOURCE);
  await ctx.seed("_content/inbox/Test.doc.card", DOC_CARD);
  ctx.commitAll("add test data");

  // doctest:L91
  const res = await ctx.request({ method: "GET", url: "/api/views/test/cards" });
  t.check(res.statusCode, 200);

  // doctest:L97
  t.check(bodyField(res.body, "cards", "length"), 1);

  // doctest:L100
  t.check(bodyField(res.body, "cards", 0, "type"), "doc");

  // doctest:L103
  t.check(bodyField(res.body, "cards", 0, "path"), "_content/inbox/Test.doc.card");

  // doctest:L106
  t.check(bodyField(res.body, "cards", 0, "frontmatter", "title"), "Test doc");

  // doctest:L109
  t.check(bodyField(res.body, "files"), []);

  // Non-card files matching the globs arrive in `files` as metadata (content
  // can be huge or binary, so it's fetched separately), and each card carries a
  // deep metadata listing of its attach scope:

  // doctest:L118
  const PLAYGROUND_VIEW = `
export const name = "Playground";
export const description = "Session history";
export const dependencies = ["_content/**/*.card", "_content/inbox/Test.attach/**/*.jsonl"];
export const modes = ["page"];
export default function P({ cards, files }) { return <div>{files.length}</div>; }
`;
  await ctx.seedView("playground.tsx", PLAYGROUND_VIEW);
  await ctx.seed("_content/inbox/Test.attach/sessions/history.jsonl", '{"summary":"first run"}\n{"summary":"second run"}\n');
  const res2 = await ctx.request({ method: "GET", url: "/api/views/playground/cards" });
  t.check(res2.statusCode, 200);

  // doctest:L131
  t.check(z.array(z.looseObject({ path: z.string() })).parse(bodyField(res2.body, "cards", 0, "attachments")).map((a) => a.path).join(", "), "_content/inbox/Test.attach/sessions/history.jsonl");

  // doctest:L134
  await t.checkText(Number(bodyField(res2.body, "cards", 0, "attachments", 0, "size")) > 0, "true");

  // doctest:L137
  t.check(bodyField(res2.body, "files", "length"), 1);

  // doctest:L140
  t.check(bodyField(res2.body, "files", 0, "path"), "_content/inbox/Test.attach/sessions/history.jsonl");

  // doctest:L143
  await t.checkText(typeof bodyField(res2.body, "files", 0, "content"), "undefined");

  // doctest:L146
  t.check(typeof bodyField(res2.body, "files", 0, "mtimeMs"), "number");

  // Content comes from `/api/files/*`, which supports byte ranges — a view
  // tails a large log instead of downloading it (suffix form `bytes=-N`):

  // doctest:L154
  const full = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/inbox/Test.attach/sessions/history.jsonl" });
  t.check(full.statusCode, 200);

  // doctest:L158
  t.check(full.headers["accept-ranges"], "bytes");

  // doctest:L161
  const tail = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=-25" } });
  t.check(tail.statusCode, 206);

  // doctest:L165
  t.check(tail.headers["content-range"], "bytes 24-48/49");

  // doctest:L168
  t.check(JSON.parse(tail.payload.trim()).summary, "second run");

  // doctest:L171
  const mid = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=0-22" } });
  await t.checkText(mid.payload, "{\"summary\":\"first run\"}");

  // doctest:L175
  const past = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=999-" } });
  t.check(past.statusCode, 416);
});

// A view with no dependencies returns an empty card list:
void test("A view with no dependencies returns an empty card list:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L187
  const ctx = await makeTestServer();

  // doctest:L189
  const noDeps = `
export const name = "Empty";
export const description = "No deps";
export const dependencies = [];
export const modes = ["page"];
export default function Empty() { return null; }
`;
  await ctx.seedView("empty.tsx", noDeps);

  // doctest:L198
  const res = await ctx.request({ method: "GET", url: "/api/views/empty/cards" });
  t.check(res.statusCode, 200);

  // doctest:L202
  t.check(bodyField(res.body, "cards", "length"), 0);
});

// Cards endpoint returns 404 for a nonexistent view:
void test("Cards endpoint returns 404 for a nonexistent view:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L213
  const ctx = await makeTestServer();
  const res = await ctx.request({ method: "GET", url: "/api/views/nonexistent/cards" });
  t.check(res.statusCode, 404);
});
