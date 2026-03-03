/**
 * Tests for routes/briefs.ts — news brief reading workflow.
 *
 * These routes involve git commits (mark-read, feedback, complete-reading)
 * so they exercise the full read→mutate→commit cycle.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "tap";
import "../src/test-lib/tap-check.js";
import "./helpers/check-serializers.js";
import { createTestServer, seedCard, commitAll, TEST_SLUG } from "./helpers/test-server.js";

const BASE = `/${TEST_SLUG}`;

/** Minimal valid news-brief card XML. */
const BRIEF_XML = `<news-brief>
<title>Test Brief</title>
<date>2026-03-01</date>
<byline>A test brief for route testing</byline>
<content format="markdown">
<section id="s1" heading="First Section">
Some content here.
</section>
</content>
<sources>
<ref path="box/inbox/news/item1.news-item.card" />
</sources>
</news-brief>
`;

// --- Listing ---

test("GET /api/briefs returns empty when no briefs exist", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/briefs` });
    t.check(res, `200\n___"briefs": []___`);
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/briefs lists unread briefs from box/output/briefs/", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/output/briefs/2026-03-01_test.news-brief.card",
      content: BRIEF_XML,
    });
    await commitAll(ctx.boxRoot, "add test brief");

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/briefs` });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.equal(body.briefs.length, 1);
    t.equal(body.briefs[0].title, "Test Brief");
    t.equal(body.briefs[0].read, false);
    t.equal(body.briefs[0].date, "2026-03-01");
    t.ok(body.briefs[0].relativePath.includes("2026-03-01_test.news-brief.card"));
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/briefs lists read briefs from store/archive/briefs/", async (t) => {
  const ctx = await createTestServer();
  try {
    const readBrief = BRIEF_XML.replace("<news-brief>", '<news-brief read-at="2026-03-01T12:00:00Z" read-reason="user">');
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "store/archive/briefs/2026-02-28_old.news-brief.card",
      content: readBrief,
    });
    await commitAll(ctx.boxRoot, "add archived brief");

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/briefs` });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.equal(body.briefs.length, 1);
    t.equal(body.briefs[0].read, true);
    t.equal(body.briefs[0].readReason, "user");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/briefs sorts unread before read", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/output/briefs/2026-03-01_unread.news-brief.card",
      content: BRIEF_XML,
    });
    const readBrief = BRIEF_XML.replace("<news-brief>", '<news-brief read-at="2026-03-01T12:00:00Z" read-reason="user">');
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "store/archive/briefs/2026-02-28_read.news-brief.card",
      content: readBrief,
    });
    await commitAll(ctx.boxRoot, "add briefs");

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/briefs` });
    const body = res.json();
    t.equal(body.briefs.length, 2);
    t.equal(body.briefs[0].read, false, "unread should come first");
    t.equal(body.briefs[1].read, true, "read should come second");
  } finally {
    await ctx.cleanup();
  }
});

// --- Fetching a single brief ---

test("GET /api/brief/:path loads a brief", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/output/briefs/2026-03-01_test.news-brief.card",
      content: BRIEF_XML,
    });

    const encodedPath = encodeURIComponent("box/output/briefs/2026-03-01_test.news-brief.card");
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/brief/${encodedPath}` });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.equal(body.brief.title, "Test Brief");
    t.equal(body.brief.date, "2026-03-01");
    t.equal(body.brief.byline, "A test brief for route testing");
    t.ok(body.brief.content, "should have content");
    t.ok(body.brief.content.sections, "should have sections");
    t.equal(body.brief.content.sections.length, 1);
    t.equal(body.brief.content.sections[0].heading, "First Section");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/brief/:path returns 404 for missing brief", async (t) => {
  const ctx = await createTestServer();
  try {
    const encodedPath = encodeURIComponent("box/output/briefs/nope.news-brief.card");
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/brief/${encodedPath}` });
    t.equal(res.statusCode, 404);
  } finally {
    await ctx.cleanup();
  }
});

// --- Mark read ---

test("POST /api/brief/mark-read moves brief to archive", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/output/briefs/2026-03-01_test.news-brief.card",
      content: BRIEF_XML,
    });
    await commitAll(ctx.boxRoot, "add brief");

    const res = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/brief/mark-read`,
      payload: { briefPath: "box/output/briefs/2026-03-01_test.news-brief.card" },
    });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.equal(body.success, true);
    t.ok(body.newPath.includes("store/archive/briefs/"), "should move to archive");

    // Verify the file actually moved
    const archivedContent = await readFile(join(ctx.boxRoot, body.newPath), "utf-8");
    t.check(archivedContent, `___read-at="___" read-reason="user"___`);
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/brief/mark-read rejects briefs not in unread location", async (t) => {
  const ctx = await createTestServer();
  try {
    const readBrief = BRIEF_XML.replace("<news-brief>", '<news-brief read-reason="user">');
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "store/archive/briefs/2026-03-01_test.news-brief.card",
      content: readBrief,
    });
    await commitAll(ctx.boxRoot, "add archived brief");

    const res = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/brief/mark-read`,
      payload: { briefPath: "store/archive/briefs/2026-03-01_test.news-brief.card" },
    });
    t.equal(res.statusCode, 400, "should reject archived brief");
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/brief/mark-read returns 404 for missing brief", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/brief/mark-read`,
      payload: { briefPath: "box/output/briefs/nope.news-brief.card" },
    });
    t.equal(res.statusCode, 404);
  } finally {
    await ctx.cleanup();
  }
});

// --- Complete reading ---

test("POST /api/brief/complete-reading applies feedback and archives", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/output/briefs/2026-03-01_test.news-brief.card",
      content: BRIEF_XML,
    });
    await commitAll(ctx.boxRoot, "add brief");

    const res = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/brief/complete-reading`,
      payload: {
        briefPath: "box/output/briefs/2026-03-01_test.news-brief.card",
        overallRating: "great",
        selectedReactions: [{ id: "interesting-topic", source: "guide" }],
        itemFeedback: [{ id: "s1", feedback: "thumbs-up" }],
      },
    });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.equal(body.success, true);
    t.ok(body.newPath.includes("store/archive/briefs/"));

    // Verify feedback attributes were written
    const content = await readFile(join(ctx.boxRoot, body.newPath), "utf-8");
    t.check(content, `___overall-rating="great"___read-reason="user"___selected-reactions="interesting-topic"___user-feedback="thumbs-up"___`);
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/brief/complete-reading rejects missing fields", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/brief/complete-reading`,
      payload: { briefPath: "box/output/briefs/test.news-brief.card" },
    });
    t.equal(res.statusCode, 400, "should reject missing overallRating");
  } finally {
    await ctx.cleanup();
  }
});

// --- Text feedback ---

test("POST /api/brief/feedback creates feedback card and commits", async (t) => {
  const ctx = await createTestServer();
  try {
    await seedCard({
      boxRoot: ctx.boxRoot,
      relativePath: "box/output/briefs/2026-03-01_test.news-brief.card",
      content: BRIEF_XML,
    });
    await commitAll(ctx.boxRoot, "add brief");

    const res = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/brief/feedback`,
      payload: {
        briefPath: "box/output/briefs/2026-03-01_test.news-brief.card",
        targetId: "s1",
        comment: "Great section!",
      },
    });
    t.check(res, `200\n___"success": true___"isVoice": false___`);
  } finally {
    await ctx.cleanup();
  }
});

// --- Reactions ---

test("GET /api/news-guide/reactions returns empty when no guide exists", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/news-guide/reactions` });
    t.check(res, `200\n___"reactions": []___`);
  } finally {
    await ctx.cleanup();
  }
});
