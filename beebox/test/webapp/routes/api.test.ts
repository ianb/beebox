// # Core Data API
//
// The core data API provides endpoints for reading box state, browsing cards, and modifying card attributes. All routes are purely local (file reads and git operations).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTestServer } from "../../helpers/test-route-server.js";
import { execSync } from "node:child_process";

// ## Keeping a visible box awake
//
// The frontend's visible-tab heartbeat uses a cheap box-scoped `HEAD` request.
// Reaching the box scope lets a lazy hub start or refresh that box without doing
// the full work of `/api/health`:
void test("The frontend's visible-tab heartbeat uses a cheap box-scoped HEAD request.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const response = await ctx.rawRequest({ method: "HEAD", url: "/api/keepalive" });
  t.check(response.statusCode, 204);

  t.check(response.headers["cache-control"], "no-store");

  t.check(response.payload, "");
});

// ## Browsing directories
//
// `GET /api/browse/*` lists directory contents with parsed card metadata:
void test("GET /api/browse/ lists directory contents with parsed card metadata:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  await ctx.seed(
    "_content/inbox/browse-test.doc.card",
    "---\ntitle: Browse\n---\nBrowse\n",
  );
  await t.checkText(await ctx.inject({ method: "GET", url: "/api/browse/_content/inbox" }), `200
{
  "path": "_content/inbox",
  «*»
  "cards": [
    {
      "relativePath": "_content/inbox/browse-test.doc.card",
      «*»
      "type": "doc"«*»
    }
  ]
}`);
});

// ### The box namespace fence (Track B)
//
// The root listing shows ONLY the underscore areas — not `src/`, `node_modules/`,
// or any other root entry, even though those pass the plain dotfile filter:
void test("The root listing shows ONLY the underscore areas — not src/, nodemodules/, or...", async (t) => {
  t.teardown(async () => {
    try {
      await nsCtx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const nsCtx = await makeTestServer();
  await nsCtx.seed("src/tricks/scripts/helper.ts", "export {};\n");
  await nsCtx.seed("node_modules/pkg/index.js", "module.exports = {};\n");
  await t.checkText(await nsCtx.inject({ method: "GET", url: "/api/browse/" }), `200
{
  "path": "",
  "dirs": [
    "_bookkeeping",
    "_config",
    "_content",
    "_publish",
    "_tmp"
  ],
  "cards": []
}`);

  // A request path outside the namespace 403s rather than listing it:

  await t.checkText(await nsCtx.inject({ method: "GET", url: "/api/browse/src/tricks/scripts" }), `403
{
  "error": "Access denied"
}`);
});

// ## Serving raw files
//
// `GET /api/files/*` serves the file body, includes `ETag` and `Last-Modified`
// for conditional GETs, and advertises `no-cache` so the browser revalidates
// every time (otherwise agent edits would stay hidden behind stale HTTP cache):
void test("GET /api/files/ serves the file body, includes ETag and Last-Modified for con...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  await ctx.seed("_content/notes/hello.md", "# Hello");
  const res = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/notes/hello.md" });
  t.check(res.statusCode, 200);

  t.check(res.headers["cache-control"], "no-cache");

  t.check(res.payload, "# Hello");

  t.check(typeof res.headers["last-modified"], "string");

  // A second request that echoes the ETag back in `If-None-Match` gets a 304 with
  // no body:

  const etag = String(res.headers["etag"]);
  const revalidate = await ctx.rawRequest({
    method: "GET",
    url: "/api/files/_content/notes/hello.md",
    headers: { "if-none-match": etag },
  });
  t.check(revalidate.statusCode, 304);

  t.check(revalidate.payload, "");

  // After the file changes on disk, the ETag changes and the client gets a fresh
  // 200 even when it sends the old ETag:

  await ctx.seed("_content/notes/hello.md", "# Hello, world");
  const fresh = await ctx.rawRequest({
    method: "GET",
    url: "/api/files/_content/notes/hello.md",
    headers: { "if-none-match": etag },
  });
  t.check(fresh.statusCode, 200);

  t.check(fresh.payload, "# Hello, world");

  // `.card` files are served as text here too — the card Source view fetches the
  // verbatim file this way (card.get returns only the parsed form):

  await ctx.seed("_bookkeeping/archive/Note.doc.card", "---\ntitle: Note\n---\nBody\n");
  const card = await ctx.rawRequest({ method: "GET", url: "/api/files/_bookkeeping/archive/Note.doc.card" });
  t.check(card.statusCode, 200);

  await t.checkText(card.payload, `---
title: Note
---
Body`);
});

// ### The box namespace fence applies to reads too (Track B)
//
// A path outside the underscore areas — even one that exists on disk — 403s
// rather than serving it:
void test("A path outside the underscore areas — even one that exists on disk — 403s rat...", async (t) => {
  const nsCtx2 = await makeTestServer();
  await nsCtx2.seed("AGENTS.md", "# Box\n");
  const agentsMd = await nsCtx2.rawRequest({ method: "GET", url: "/api/files/AGENTS.md" });
  t.check(agentsMd.statusCode, 403);

  await nsCtx2.cleanup();
});

// ## Deleting raw files
//
// `DELETE /api/files/*` removes a non-card file and commits the deletion:
void test("DELETE /api/files/ removes a non-card file and commits the deletion:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  await ctx.seed("_content/images/delete-me.webp", "not really an image");
  ctx.commitAll("seed image");
  const res = await ctx.request({ method: "DELETE", url: "/api/files/_content/images/delete-me.webp" });
  t.check(res.statusCode, 200);

  t.check(execSync("git log -1 --pretty=%s", { cwd: ctx.boxRoot, encoding: "utf-8" }).trim(), "Deleted by user: _content/images/delete-me.webp");

  await t.checkText(await ctx.inject({ method: "GET", url: "/api/files/_content/images/delete-me.webp" }), `404
«*»"error": "Not found"«*»`);
});

// Dirty files get preserved in their own commit before the delete commit.
//
// The two versions differ in LENGTH deliberately, and only because of a FIXTURE
// defect: in a `makeTestServer` box a same-size overwrite of a committed asset is
// invisible to `git status`, so `pathsHaveChanges` reads clean and the
// preservation commit never happens. A real box does not behave that way — the
// same sequence on `bbx init` and on `makeTmpBox` reports the change — so this
// line is working around the fixture, not around the route. See
// `issues/bugs/2026-09-14-route-test-fixture-hides-asset-changes-from-git.md`.
void test("Dirty files get preserved in their own commit before the delete commit.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  await ctx.seed("_content/images/dirty-delete.webp", "version 1");
  ctx.commitAll("seed dirty image");
  await ctx.seed("_content/images/dirty-delete.webp", "version 2 (a different length)");
  const res = await ctx.request({ method: "DELETE", url: "/api/files/_content/images/dirty-delete.webp" });
  t.check(res.statusCode, 200);

  await t.checkText(execSync("git log -2 --pretty=%s", { cwd: ctx.boxRoot, encoding: "utf-8" }).trim(), `Deleted by user: _content/images/dirty-delete.webp
Saved before user delete: _content/images/dirty-delete.webp`);
});
