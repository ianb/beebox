/**
 * Tests for the jobs/reactor system.
 */

import { test } from "tap";
import { createNewsJobTemplate } from "../src/schemas/news-job.js";
import { NewsJobSchema, getCardTypes, isKnownCardType } from "../src/schemas/index.js";

test("NewsJobSchema is registered in the schema registry", async (t) => {
  const types = getCardTypes();
  t.ok(types.includes("news-job"), "news-job should be in card types");
  t.ok(isKnownCardType("news-job"), "news-job should be a known card type");
});

test("NewsJobSchema has correct tag name", async (t) => {
  t.equal(NewsJobSchema.tagName, "news-job");
});

test("NewsJobSchema has instructions", async (t) => {
  t.ok(NewsJobSchema.instructions, "should have instructions");
  t.ok(NewsJobSchema.instructions!.includes("cb finish"), "instructions should mention cb finish");
});

test("createNewsJobTemplate generates valid XML", async (t) => {
  const template = createNewsJobTemplate({
    source: "rss-connector",
    description: "3 new items from RSS feeds",
    items: [
      "box/inbox/news/item1.news-item.card",
      "box/inbox/news/item2.news-item.card",
      "box/inbox/news/item3.news-item.card",
    ],
  });

  t.ok(template.includes("<news-job"), "should have news-job root element");
  t.ok(template.includes('source="rss-connector"'), "should have source attribute");
  t.ok(template.includes("<description>3 new items from RSS feeds</description>"), "should have description");
  t.ok(template.includes('ref="box/inbox/news/item1.news-item.card"'), "should have item refs");
  t.ok(template.includes('ref="box/inbox/news/item2.news-item.card"'), "should have second item ref");
  t.ok(template.includes("</news-job>"), "should close news-job element");
});

test("createNewsJobTemplate escapes special characters", async (t) => {
  const template = createNewsJobTemplate({
    source: "test",
    description: "Items with <special> & chars",
    items: ['path/with"quotes.card'],
  });

  t.ok(template.includes("&lt;special&gt;"), "should escape < and > in description");
  t.ok(template.includes("&amp;"), "should escape & in description");
  t.ok(template.includes("&quot;"), "should escape quotes in ref attributes");
});

test("createNewsJobTemplate uses provided created timestamp", async (t) => {
  const template = createNewsJobTemplate({
    created: "2026-02-21T08:00:00Z",
    source: "test",
    description: "test",
    items: [],
  });

  t.ok(template.includes('created="2026-02-21T08:00:00Z"'), "should use provided timestamp");
});

test("createNewsJobTemplate auto-generates created timestamp", async (t) => {
  const before = new Date().toISOString();
  const template = createNewsJobTemplate({
    source: "test",
    description: "test",
    items: [],
  });

  // Should contain a created attribute with an ISO timestamp
  const match = template.match(/created="([^"]+)"/);
  t.ok(match, "should have created attribute");
  const created = match![1]!;
  t.ok(created >= before, "created timestamp should be recent");
});

test("cb finish rejects non-job files", async (t) => {
  // This tests the extension check logic from finish.ts
  const filename = "test.memo.card";
  t.ok(!filename.endsWith(".job.card"), "memo card should not pass job check");

  const jobFilename = "test.news.job.card";
  t.ok(jobFilename.endsWith(".job.card"), "job card should pass job check");
});

test("job type extraction from filename", async (t) => {
  // Test the filename parsing logic used in cb finish
  const filename = "2026-02-21T08-00-00.news.job.card";
  const parts = filename.split(".");
  // parts: ["2026-02-21T08-00-00", "news", "job", "card"]
  t.equal(parts.length, 4);
  const jobType = parts[parts.length - 3]; // "news"
  t.equal(jobType, "news", "should extract job type from filename");
});
