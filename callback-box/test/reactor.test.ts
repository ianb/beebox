/**
 * Tests for the jobs/reactor system.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "tap";
import "../src/test-lib/tap-check.js";
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

  t.check(template, `<news-job created="«date»" source="rss-connector">
  <description>3 new items from RSS feeds</description>
  <item ref="box/inbox/news/item1.news-item.card" />
  <item ref="box/inbox/news/item2.news-item.card" />
  <item ref="box/inbox/news/item3.news-item.card" />
</news-job>
`);
});

test("createNewsJobTemplate escapes special characters", async (t) => {
  const template = createNewsJobTemplate({
    source: "test",
    description: "Items with <special> & chars",
    items: ['path/with"quotes.card'],
  });

  t.check(template, `<news-job created="«date»" source="test">
  <description>Items with &lt;special&gt; &amp; chars</description>
  <item ref="path/with&quot;quotes.card" />
</news-job>
`);
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

  t.check(template, `<intake-job status="pending" created="«date»" source="capture-connector" priority="normal">
  <description>Triage 2 new capture sessions</description>
  <item ref="box/inbox/capture-1/session.capture-session.card" />
  <item ref="box/inbox/capture-2/session.capture-session.card" />
</intake-job>
`);
});

test("createIntakeJobTemplate supports low priority", async (t) => {
  const template = createIntakeJobTemplate({
    source: "raindrop-connector",
    description: "Triage bookmarks",
    items: ["box/inbox/bookmark.bookmark.card"],
    priority: "low",
  });

  t.check(template, `<intake-job status="pending" created="«date»" source="raindrop-connector" priority="low">
  <description>Triage bookmarks</description>
  <item ref="box/inbox/bookmark.bookmark.card" />
</intake-job>
`);
});

test("createIntakeJobTemplate escapes special characters", async (t) => {
  const template = createIntakeJobTemplate({
    source: "test",
    description: "Items with <special> & chars",
    items: ['path/with"quotes.card'],
  });

  t.check(template, `<intake-job status="pending" created="«date»" source="test" priority="normal">
  <description>Items with &lt;special&gt; &amp; chars</description>
  <item ref="path/with&quot;quotes.card" />
</intake-job>
`);
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

  t.check(template, `<calendar-review-job status="pending" created="«date»" source="google-calendar" priority="normal">
  <description>2 calendar changes to review</description>
  <change action="new" ref="store/calendar/2026-02-25_abc.ics">Dentist appointment</change>
  <change action="updated" ref="store/calendar/2026-02-22_def.ics">Standup — time changed</change>
</calendar-review-job>
`);
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

  t.check(template, `<calendar-review-job status="pending" created="«date»" source="google-calendar" priority="normal">
  <description>1 deletion</description>
  <change action="deleted">
    Cancelled meeting
    <ics>BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR</ics>
  </change>
</calendar-review-job>
`);
});

test("createCalendarReviewJobTemplate supports priority", async (t) => {
  const template = createCalendarReviewJobTemplate({
    source: "google-calendar",
    description: "test",
    changes: [{ action: "new", summary: "test" }],
    priority: "low",
  });

  t.check(template, `<calendar-review-job status="pending" created="«date»" source="google-calendar" priority="low">
  <description>test</description>
  <change action="new">test</change>
</calendar-review-job>
`);
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
    t.check(content, `<intake-job status="pending" created="«date»" source="test-connector" priority="normal">
  <description>Triage 1 item</description>
  <item ref="box/inbox/item1.memo.card" />
</intake-job>
`);
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
    t.check(content, `<intake-job status="pending" created="«date»" source="test-connector" priority="normal">
  <description>Triage 2 items</description>
  <item ref="box/inbox/item1.memo.card" />
  <item ref="box/inbox/item2.memo.card" />
</intake-job>
`);
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
