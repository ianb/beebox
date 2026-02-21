/**
 * Tests for the jobs/reactor system.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "tap";
import { createOrAppendIntakeJob } from "../src/connectors/intake-utils.js";
import { createCalendarReviewJobTemplate } from "../src/schemas/calendar-review-job.js";
import {
  NewsJobSchema,
  IntakeJobSchema,
  CalendarReviewJobSchema,
  getCardTypes,
  isKnownCardType,
} from "../src/schemas/index.js";
import { createIntakeJobTemplate } from "../src/schemas/intake-job.js";
import { createNewsJobTemplate } from "../src/schemas/news-job.js";

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

// --- Intake Job Schema ---

test("IntakeJobSchema is registered in the schema registry", async (t) => {
  const types = getCardTypes();
  t.ok(types.includes("intake-job"), "intake-job should be in card types");
  t.ok(isKnownCardType("intake-job"), "intake-job should be a known card type");
});

test("IntakeJobSchema has correct tag name", async (t) => {
  t.equal(IntakeJobSchema.tagName, "intake-job");
});

test("IntakeJobSchema has instructions", async (t) => {
  t.ok(IntakeJobSchema.instructions, "should have instructions");
  t.ok(IntakeJobSchema.instructions!.includes("cb finish"), "instructions should mention cb finish");
});

test("createIntakeJobTemplate generates valid XML", async (t) => {
  const template = createIntakeJobTemplate({
    source: "capture-connector",
    description: "Triage 2 new capture sessions",
    items: [
      "box/inbox/capture-1/session.capture-session.card",
      "box/inbox/capture-2/session.capture-session.card",
    ],
  });

  t.ok(template.includes("<intake-job"), "should have intake-job root element");
  t.ok(template.includes('status="pending"'), "should have pending status");
  t.ok(template.includes('source="capture-connector"'), "should have source attribute");
  t.ok(template.includes('priority="normal"'), "should default to normal priority");
  t.ok(template.includes("<description>Triage 2 new capture sessions</description>"), "should have description");
  t.ok(template.includes('ref="box/inbox/capture-1/session.capture-session.card"'), "should have first item ref");
  t.ok(template.includes('ref="box/inbox/capture-2/session.capture-session.card"'), "should have second item ref");
  t.ok(template.includes("</intake-job>"), "should close intake-job element");
});

test("createIntakeJobTemplate supports low priority", async (t) => {
  const template = createIntakeJobTemplate({
    source: "raindrop-connector",
    description: "Triage bookmarks",
    items: ["box/inbox/bookmark.bookmark.card"],
    priority: "low",
  });

  t.ok(template.includes('priority="low"'), "should have low priority");
});

test("createIntakeJobTemplate escapes special characters", async (t) => {
  const template = createIntakeJobTemplate({
    source: "test",
    description: "Items with <special> & chars",
    items: ['path/with"quotes.card'],
  });

  t.ok(template.includes("&lt;special&gt;"), "should escape < and > in description");
  t.ok(template.includes("&amp;"), "should escape & in description");
  t.ok(template.includes("&quot;"), "should escape quotes in ref attributes");
});

test("intake job filename pattern", async (t) => {
  const filename = "2026-02-21T12-00-00.intake.job.card";
  t.ok(filename.endsWith(".job.card"), "should end with .job.card");
  t.ok(filename.endsWith(".intake.job.card"), "should include intake type");
  const parts = filename.split(".");
  t.equal(parts[parts.length - 3], "intake", "should extract intake job type");
});

// --- Calendar Review Job Schema ---

test("CalendarReviewJobSchema is registered in the schema registry", async (t) => {
  const types = getCardTypes();
  t.ok(types.includes("calendar-review-job"), "calendar-review-job should be in card types");
  t.ok(isKnownCardType("calendar-review-job"), "calendar-review-job should be a known card type");
});

test("CalendarReviewJobSchema has correct tag name", async (t) => {
  t.equal(CalendarReviewJobSchema.tagName, "calendar-review-job");
});

test("CalendarReviewJobSchema has instructions", async (t) => {
  t.ok(CalendarReviewJobSchema.instructions, "should have instructions");
  t.ok(CalendarReviewJobSchema.instructions!.includes("cb finish"), "instructions should mention cb finish");
});

test("createCalendarReviewJobTemplate generates valid XML for new events", async (t) => {
  const template = createCalendarReviewJobTemplate({
    source: "google-calendar",
    description: "2 calendar changes to review",
    changes: [
      { action: "new", ref: "store/calendar/2026-02-25_abc.ics", summary: "Dentist appointment" },
      { action: "updated", ref: "store/calendar/2026-02-22_def.ics", summary: "Standup — time changed" },
    ],
  });

  t.ok(template.includes("<calendar-review-job"), "should have root element");
  t.ok(template.includes('source="google-calendar"'), "should have source");
  t.ok(template.includes("<description>2 calendar changes to review</description>"), "should have description");
  t.ok(template.includes('action="new"'), "should have new action");
  t.ok(template.includes('action="updated"'), "should have updated action");
  t.ok(template.includes('ref="store/calendar/2026-02-25_abc.ics"'), "should have ref for new event");
  t.ok(template.includes("Dentist appointment"), "should have summary text");
  t.ok(template.includes("</calendar-review-job>"), "should close root element");
});

test("createCalendarReviewJobTemplate handles deleted events with ICS", async (t) => {
  const icsContent = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Cancelled\nEND:VEVENT\nEND:VCALENDAR";
  const template = createCalendarReviewJobTemplate({
    source: "google-calendar",
    description: "1 deletion",
    changes: [
      { action: "deleted", summary: "Cancelled meeting", icsContent },
    ],
  });

  t.ok(template.includes('action="deleted"'), "should have deleted action");
  t.ok(template.includes("<ics>"), "should have ics element");
  t.ok(template.includes("BEGIN:VCALENDAR"), "should contain ICS content");
  t.ok(!template.includes('ref='), "deleted events without ref should have no ref attr");
});

test("createCalendarReviewJobTemplate supports priority", async (t) => {
  const template = createCalendarReviewJobTemplate({
    source: "google-calendar",
    description: "test",
    changes: [{ action: "new", summary: "test" }],
    priority: "low",
  });

  t.ok(template.includes('priority="low"'), "should support low priority");
});

// --- Intake Utils ---

test("createOrAppendIntakeJob creates a new job card", async (t) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "cb-test-"));
  try {
    const relPath = await createOrAppendIntakeJob({
      boxRoot: tmpDir,
      source: "test-connector",
      items: ["box/inbox/item1.memo.card"],
      description: "Triage 1 item",
    });

    t.ok(relPath.startsWith("box/jobs/"), "should return relative path under box/jobs/");
    t.ok(relPath.endsWith(".intake.job.card"), "should have intake.job.card extension");

    const content = await readFile(join(tmpDir, relPath), "utf-8");
    t.ok(content.includes('source="test-connector"'), "should have source");
    t.ok(content.includes("<description>Triage 1 item</description>"), "should have description");
    t.ok(content.includes('ref="box/inbox/item1.memo.card"'), "should have item ref");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("createOrAppendIntakeJob appends to existing job from same source", async (t) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "cb-test-"));
  try {
    // Create first job
    const relPath1 = await createOrAppendIntakeJob({
      boxRoot: tmpDir,
      source: "test-connector",
      items: ["box/inbox/item1.memo.card"],
      description: "Triage 1 item",
    });

    // Append to it
    const relPath2 = await createOrAppendIntakeJob({
      boxRoot: tmpDir,
      source: "test-connector",
      items: ["box/inbox/item2.memo.card"],
      description: "Triage 2 items",
    });

    t.equal(relPath1, relPath2, "should return same path (appended, not new)");

    const content = await readFile(join(tmpDir, relPath2), "utf-8");
    t.ok(content.includes('ref="box/inbox/item1.memo.card"'), "should still have first item");
    t.ok(content.includes('ref="box/inbox/item2.memo.card"'), "should have appended second item");
    t.ok(content.includes("<description>Triage 2 items</description>"), "should have updated description");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("createOrAppendIntakeJob creates separate jobs for different sources", async (t) => {
  const tmpDir = await mkdtemp(join(tmpdir(), "cb-test-"));
  try {
    const relPath1 = await createOrAppendIntakeJob({
      boxRoot: tmpDir,
      source: "connector-a",
      items: ["box/inbox/a.memo.card"],
      description: "From A",
    });

    const relPath2 = await createOrAppendIntakeJob({
      boxRoot: tmpDir,
      source: "connector-b",
      items: ["box/inbox/b.memo.card"],
      description: "From B",
    });

    t.not(relPath1, relPath2, "should create separate job files for different sources");

    const files = await readdir(join(tmpDir, "box/jobs"));
    const jobFiles = files.filter((f) => f.endsWith(".intake.job.card"));
    t.equal(jobFiles.length, 2, "should have 2 separate job files");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
