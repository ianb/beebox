// # Browser-task card schema
//
// A `browser-task` card is a prompt for someone with a logged-in browser, and
// the inbox for what they bring back. It is the first schema to declare
// `submissions`: the generic route and form ask the schema whether the card is
// accepting and whether a batch is valid.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, is, str } from "@ianbicking/tap-check/check";
import { BrowserTaskSchema, createBrowserTaskTemplate } from "../../src/schemas/browser-task.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas.js";
import { getTemplate } from "../../src/templates-registry.js";

const schemas = await createCardSchemaMap();
const recordSchema = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["permalink"],
  properties: { permalink: { type: "string" }, poster: { type: "string", format: "attachment" } },
});
const coverage = { scanned: 3, stoppedAt: "x", reason: "end-of-feed" };
const attachments = (files: Record<string, string>) => async (name: string) => files[name] ?? null;

// ## Registered, authored, with a template
void test("Registered, authored, with a template", async (t) => {
  t.check(schemas.get("browser-task"), is(BrowserTaskSchema));

  t.check(getTemplate("browser-task")?.defaultForTypes, [
    "browser-task",
  ]);
});

// Without a prompt the template emits the four-heading scaffold, and `limit` is data:
void test("Without a prompt the template emits the four-heading scaffold, and limit is d...", async (t) => {
  const scaffolded = parseCardText(createBrowserTaskTemplate({ title: "Scan", start: "https://example.test/feed" }), { source: "Scan.browser-task.card", schemas });
  t.check([...String(scaffolded.fields["body"]).matchAll(/^## (.+)$/gm)].map((m) => m[1]), [
    "What to look for",
    "What does not count",
    "How far to go",
    "What each record must contain",
  ]);

  const bounded = parseCardText("---\ntype: browser-task\nstart:\n  href: https://x.test\nlimit:\n  posts: 40\n  since: 2025-01-01\n---\nx\n", { source: "B.browser-task.card", schemas });
  t.check(bounded.fields["limit"], {
    posts: 40,
    since: "2025-01-01",
  });

  await t.checkThrows(
    async () => (parseCardText("---\ntype: browser-task\nstart:\n  href: https://x.test\nlimit:\n  since: soon\n---\nx\n", { source: "B.browser-task.card", schemas }))
    ,
    "CardIOError",
  );
});

// Cadence, subject, and scan history are fields too:
void test("Cadence, subject, and scan history are fields too:", async (t) => {
  const standing = parseCardText("---\ntype: browser-task\nstart:\n  href: https://x.test\nrescan-after: P2W\nsubject:\n  ref: _content/people/Potter.person.card\nruns:\n  - batch: 20260912-213306-649a\n    at: 2026-09-12T21:40:00Z\n    scanned: 14\n    kept: 1\n    filed: 1\n    skipped: 0\n    reason: reached-watermark\n    stoppedAt: https://example.test/p/100\n---\nx\n", { source: "S.browser-task.card", schemas });
  t.check(standing.fields, {
    type: "browser-task",
    start: { href: "https://x.test" },
    "rescan-after": "P2W",
    subject: { ref: "_content/people/Potter.person.card" },
    runs: [
      {
        batch: "20260912-213306-649a",
        at: "2026-09-12T21:40:00Z",
        scanned: 14,
        kept: 1,
        filed: 1,
        skipped: 0,
        reason: "reached-watermark",
        stoppedAt: "https://example.test/p/100",
      },
    ],
    body: "x\n",
  });

  await t.checkThrows(
    async () => (parseCardText("---\ntype: browser-task\nstart:\n  href: https://x.test\nrescan-after: fortnightly\n---\nx\n", { source: "S.browser-task.card", schemas }))
    ,
    "CardIOError",
  );
});

// `start.href` must be a URL; the start page is handed to a browser executor:
void test("start.href must be a URL; the start page is handed to a browser executor:", async (t) => {
  await t.checkThrows(async () => (parseCardText("---\ntype: browser-task\nstart:\n  href: not a url\n---\nx\n", { source: "T.browser-task.card", schemas })), "CardIOError");
});

// The template emits an open task (no `closed`) with the prompt as the body:
void test("The template emits an open task (no closed) with the prompt as the body:", async (t) => {
  const text = createBrowserTaskTemplate({ title: "Pottery shows", start: "https://example.test/feed", prompt: "Find show announcements." });
  const parsed = parseCardText(text, { source: "Pottery.browser-task.card", schemas });
  t.check(parsed.fields, {
    type: "browser-task",
    title: "Pottery shows",
    start: { href: "https://example.test/feed" },
    body: "Find show announcements.\n",
  });
});

// ## The prompt must not lean on the box
//
// The reader has a browser and no box. A link to a card, a box path, the
// briefing, or a `bbx` command is a warning at validate time, one per kind:
void test("The reader has a browser and no box.", async (t) => {
  const warn = (bodyText: string) => (BrowserTaskSchema.validate ? BrowserTaskSchema.validate({ fields: { start: { href: "https://x.test" }, body: bodyText } }) : []).map((i) => `${i.severity}: ${i.message}`);
  t.check(
    warn("Scan the page and record each show. See https://example.test/about for context.")
    ,
    [],
  );

  t.check(warn("Use the rule in the briefing; file into _content/events/ as Show.record.card via bbx create."), [
    "warning: the prompt refers to a card file; the reader has a browser and no box, so name the thing itself (a URL, a date, a name)",
    "warning: the prompt refers to a box path; the reader has a browser and no box, so name the thing itself (a URL, a date, a name)",
    "warning: the prompt refers to the briefing; the reader has a browser and no box, so name the thing itself (a URL, a date, a name)",
    "warning: the prompt refers to a bbx command; the reader has a browser and no box, so name the thing itself (a URL, a date, a name)",
  ]);
});

// ## The submission contract
//
// The card refuses when closed and accepts when open:
void test("The card refuses when closed and accepts when open:", async (t) => {
  const sub = BrowserTaskSchema.submissions!;
  t.check([sub.dir, sub.refusal({}), sub.refusal({ closed: true })], [
    "inbox",
    null,
    "this task is closed and no longer accepts submissions",
  ]);

  // Validation reads `schema.json` from the attach scope through the injected reader:

  const good = await sub.validate({ fields: {}, manifest: { coverage, records: [{ permalink: "p", poster: "a.jpg" }] }, fileNames: ["a.jpg"], readAttachment: attachments({ "schema.json": recordSchema }) });
  t.check(good, {
    ok: true,
    count: 1,
    manifest: {
      coverage: {
        scanned: 3,
        stoppedAt: "x",
        reason: "end-of-feed",
      },
      records: [
        {
          permalink: "p",
          poster: "a.jpg",
        },
      ],
    },
  });

  const noSchema = await sub.validate({ fields: {}, manifest: { coverage, records: [] }, fileNames: [], readAttachment: attachments({}) });
  t.check(noSchema, {
    ok: false,
    issues: [
      {
        path: "schema",
        message: "attach/schema.json is missing; the task has no record schema yet",
      },
    ],
  });

  const badJson = await sub.validate({ fields: {}, manifest: { coverage, records: [] }, fileNames: [], readAttachment: attachments({ "schema.json": "{oops" }) });
  t.check(badJson, {
    ok: false,
    issues: [{ path: "schema", message: str`attach/schema.json is not valid JSON: ${any(String)}` }],
  });

  const missing = await sub.validate({ fields: {}, manifest: { coverage, records: [{ permalink: "p", poster: "a.jpg" }] }, fileNames: [], readAttachment: attachments({ "schema.json": recordSchema }) });
  t.check(missing.ok ? [] : missing.issues, [
    {
      path: "records[0].poster",
      message: "references \"a.jpg\", which was not uploaded",
    },
  ]);
});
