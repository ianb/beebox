// # Views API
//
// The views API serves agent-generated React components. It lists available views, serves compiled JS modules, and returns cards matching a view's dependency globs.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { join, relative } from "node:path";
import { makeTestServer } from "../../helpers/test-route-server.js";

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
  // The compiled output externalizes React via the window shim. The payload embeds
  // the shared react-shim runtime, so the check names the shim use, not the whole file.
  t.check(res.statusCode, 200);
  t.check(res.payload, any(String).includes("var React = window.__bbxReact;"));
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
  // The error module contains the actual error message:
  t.check({ statusCode: res.statusCode, payload: res.payload }, {
    statusCode: 200,
    payload: `export default function ErrorView() {
  return window.__bbxReact.createElement("pre", {style:{color:"red",whiteSpace:"pre-wrap",padding:"1rem"}}, \`Build failed with 1 error:
${relative(process.cwd(), join(ctx.boxRoot, "src/views/broken.tsx"))}:1:39: ERROR: Expected ">" but found end of file\`);
}
export const name = "Error";
export const description = "Failed to compile";
export const dependencies = [];
export const modes = ["page", "chat"];
`,
  });
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
  const doc = {
    path: "_content/inbox/Test.doc.card",
    type: "doc",
    frontmatter: { title: "Test doc" },
    bodyLineOffset: 3,
    body: "Test doc content\n",
  };
  t.check(res, { statusCode: 200, body: { cards: [doc], files: [] } });

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
  // Size and path are exact; the timestamp and etag come from the file system.
  const history = {
    path: "_content/inbox/Test.attach/sessions/history.jsonl",
    size: 49,
    mtimeMs: any(Number).positive(),
    etag: str`W/"${any(String)}"`,
    gitStatus: "untracked",
  };
  t.check(res2, { statusCode: 200, body: { cards: [{ ...doc, attachments: [history] }], files: [history] } });

  // Content comes from `/api/files/*`, which supports byte ranges — a view
  // tails a large log instead of downloading it (suffix form `bytes=-N`):

  // doctest:L154
  const full = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/inbox/Test.attach/sessions/history.jsonl" });
  t.check({ statusCode: full.statusCode, acceptRanges: full.headers["accept-ranges"] }, { statusCode: 200, acceptRanges: "bytes" });

  // doctest:L161
  const tail = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=-25" } });
  t.check({ statusCode: tail.statusCode, contentRange: tail.headers["content-range"], payload: tail.payload }, {
    statusCode: 206,
    contentRange: "bytes 24-48/49",
    payload: "{\"summary\":\"second run\"}\n",
  });

  // doctest:L171
  const mid = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=0-22" } });
  t.check({ statusCode: mid.statusCode, payload: mid.payload }, { statusCode: 206, payload: "{\"summary\":\"first run\"}" });

  // doctest:L175
  const past = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=999-" } });
  t.check({ statusCode: past.statusCode, payload: past.payload }, { statusCode: 416, payload: "{\"error\":\"Range not satisfiable\"}" });
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
  t.check(res, { statusCode: 200, body: { cards: [], files: [] } });
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
  t.check(res, { statusCode: 404, body: { error: "View not found" } });
});
