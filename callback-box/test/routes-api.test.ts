/**
 * Tests for routes/api.ts — core data access endpoints.
 *
 * All routes tested here are purely local (file reads, git log).
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { test } from "tap";
import "../src/test-lib/tap-check.js";
import "./helpers/check-serializers.js";
import { createTestServer, seedCard, commitAll, TEST_SLUG } from "./helpers/test-server.js";

const BASE = `/${TEST_SLUG}`;

test("GET /api/status returns box state", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/status` });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.ok(body.boxRoot, "should have boxRoot");
    t.ok(body.counts, "should have counts");
    t.equal(typeof body.counts.inbox, "number");
    t.equal(typeof body.counts.questions, "number");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/inbox returns empty array for empty inbox", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/inbox` });
    t.check(res, `200\n___"items": []___`);
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/inbox returns seeded cards", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/inbox/test.memo.card",
      content: '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Hello</content></memo>\n',
    });
    await commitAll(ctx.boxRoot, "seed memo");

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/inbox` });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.ok(body.items.length > 0, "should have at least one item");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/card/* loads a card", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/inbox/hello.memo.card",
      content: '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Hello world</content></memo>\n',
    });

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/card/box/inbox/hello.memo.card` });
    // field order: path, tagName, status, version, xml, element
    t.check(res, `200
{
  "path": "box/inbox/hello.memo.card",
  "tagName": "memo",
  ___
  "element": {
    "tagName": "memo"___
  }
}`);
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/card/* returns 404 for missing card", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/card/box/inbox/nope.memo.card` });
    t.equal(res.statusCode, 404);
  } finally {
    await ctx.cleanup();
  }
});

test("PATCH /api/card/* applies set-attr op", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/inbox/patch-test.memo.card",
      content: '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Patch me</content></memo>\n',
    });

    const res = await ctx.server.inject({
      method: "PATCH",
      url: `${BASE}/api/card/box/inbox/patch-test.memo.card`,
      payload: {
        ops: [{ op: "set-attr", attr: "status", value: "processed" }],
      },
    });
    // field order: path, tagName, status, version, xml, element
    t.check(res, `200\n___"status": "processed"___"element":___"status": "processed"___`);
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/browse/* lists directory contents", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/inbox/browse-test.memo.card",
      content: '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Browse</content></memo>\n',
    });

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/browse/box/inbox` });
    // field order in cards: relativePath, name, type, tagName, status
    t.check(res, `200
{
  "path": "box/inbox",
  ___
  "cards": [
    {
      "relativePath": "box/inbox/browse-test.memo.card",
      ___
      "tagName": "memo"___
    }
  ]
}`);
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/news-status returns counts", async (t) => {
  const ctx = await createTestServer();
  try {
    // Seed one news item in inbox
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/inbox/news/test.news-item.card",
      content: '<news-item status="new"><title>Test</title><source-url>https://example.com</source-url></news-item>\n',
    });

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/news-status` });
    t.check(res, `200
{
  "inbox": 1,
  "pool": 0,
  "archive": 0,
  "trash": 0
}`);
  } finally {
    await ctx.cleanup();
  }
});

test("debug-log POST/GET/DELETE cycle", async (t) => {
  const ctx = await createTestServer();
  try {
    // POST entries
    const postRes = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/debug-log`,
      payload: { entries: [{ level: "info", message: "test message" }] },
    });
    t.equal(postRes.statusCode, 200);

    // GET entries — field order: ts, level, message
    const getRes = await ctx.server.inject({ method: "GET", url: `${BASE}/api/debug-log` });
    t.check(getRes, `200\n___"level": "info",\n      "message": "test message"___`);

    // DELETE entries
    const delRes = await ctx.server.inject({ method: "DELETE", url: `${BASE}/api/debug-log` });
    t.equal(delRes.statusCode, 200);

    // Verify empty
    const getRes2 = await ctx.server.inject({ method: "GET", url: `${BASE}/api/debug-log` });
    const body2 = getRes2.json();
    t.equal(body2.entries.length, 0);
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/activity returns git log", async (t) => {
  const ctx = await createTestServer();
  try {
    // initBox already made an initial commit; add one more
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/inbox/log-test.memo.card",
      content: '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Log test</content></memo>\n',
    });
    await commitAll(ctx.boxRoot, "add log test card");

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/activity?count=5` });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.ok(Array.isArray(body.entries), "should have entries array");
    t.ok(body.entries.length >= 1, "should have at least one commit");
  } finally {
    await ctx.cleanup();
  }
});
