// # search/extract: card → search documents
//
// Pure extraction: a loaded card becomes one search document, plus per-section
// documents when the body is long. Per-kind frontmatter folds into searchable
// text; email body files are deliberately never read (untrusted content stays
// out of the index — see `src/schemas/email-message.tsx`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { loadCardFromText, type LoadCardContext } from "../../../../src/core/card-io.js";
import {
  declareInputFiles,
  extractCardDocs,
  SECTION_SPLIT_THRESHOLD,
} from "../../../../src/core/search/extract/core.js";
import { splitMarkdownSections } from "../../../../src/shared/markdown-sections.js";
import { createCardSchemaMap } from "../../../../src/schemas.js";

const ctx: LoadCardContext = {
  cardSchemas: await createCardSchemaMap(),
};

async function docsFor(path: string, text: string) {
  const card = await loadCardFromText({ content: text, source: path, ctx });
  return extractCardDocs({ path, card, contentHash: "hash0" });
}

// ## A doc card becomes one document titled from its `title:` field
//
// A short body stays a single document; the `contains` sentence rides along.
void test("A short body stays a single document; the contains sentence rides along.", async (t) => {
  const docs = await docsFor(
    "_content/inbox/Dentist_Call.doc.card",
    "---\ntitle: Dentist call\ncontains: Dentist moved to June 17; confirmation in this email.\n---\nThe dentist called — appointment moved to June 17.\n"
  );
  t.check(docs, [
    {
      path: "_content/inbox/Dentist_Call.doc.card",
      kind: "doc",
      title: "Dentist call",
      contains: "Dentist moved to June 17; confirmation in this email.",
      contentHash: "hash0",
      id: "_content/inbox/Dentist_Call.doc.card#",
      fragment: "",
      content: "The dentist called — appointment moved to June 17.",
    },
  ]);
});

// ## Email messages fold headers and snippet, never the body file
void test("Email messages fold headers and snippet, never the body file", async (t) => {
  const docs = await docsFor(
    "_content/inbox/email/t.attach/msg-001.email-message.card",
    "---\nemail:\n  message-id: \"<m1@example.com>\"\n  thread-id: t1\n  from: alice@example.com\n  to: bob@example.com\n  received: 2026-05-14T19:00:00Z\n  subject: Weekend plans\n  snippet: Hey, are you free Saturday...\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n"
  );
  t.check(docs, [
    {
      path: "_content/inbox/email/t.attach/msg-001.email-message.card",
      kind: "email-message",
      title: "Weekend plans",
      contains: "",
      contentHash: "hash0",
      id: "_content/inbox/email/t.attach/msg-001.email-message.card#",
      fragment: "",
      content: "Weekend plans\nalice@example.com\nbob@example.com\nHey, are you free Saturday...",
    },
  ]);

  t.check(declareInputFiles({ path: "_content/inbox/email/t.attach/msg-001.email-message.card", card: await loadCardFromText({ content: "---\nemail:\n  message-id: \"<m1@example.com>\"\n  thread-id: t1\n  from: a@x.com\n  received: 2026-05-14T19:00:00Z\n  subject: s\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n", source: "_content/inbox/email/t.attach/msg-001.email-message.card", ctx }) }), []);
});

// ## Email threads fold subject, participants, labels, and date-range
void test("Email threads fold subject, participants, labels, and date-range", async (t) => {
  const docs = await docsFor(
    "_content/inbox/email/thread-x.email-thread.card",
    "---\nemail:\n  thread-id: t1\n  subject: Usage-based pricing demo\n  participants:\n    - hello@metricly.example\n  date-range:\n    start: 2026-05-14T19:00:00Z\n    end: 2026-05-14T19:00:00Z\n  labels:\n    - promotions\nmessages:\n  - ref: attach/msg-001.email-message.card\n---\n"
  );
  t.check(docs, [
    {
      path: "_content/inbox/email/thread-x.email-thread.card",
      kind: "email-thread",
      title: "Usage-based pricing demo",
      contains: "",
      contentHash: "hash0",
      id: "_content/inbox/email/thread-x.email-thread.card#",
      fragment: "",
      content: "Usage-based pricing demo\nhello@metricly.example\npromotions",
    },
  ]);
});

// ## Gdocs declare their content snapshot and index it as the body
void test("Gdocs declare their content snapshot and index it as the body", async (t) => {
  const cardText = "---\ndrive:\n  id: d1\n  link: https://docs.google.com/document/d/d1/edit\n  owner: owner@example.com\n  modified: 2026-05-01\ntitle: Project Notes\ncontent:\n  ref: attach/Project_Notes.md\n---\n";
  const path = "_content/drive/Project_Notes.gdoc.card";
  const card = await loadCardFromText({ content: cardText, source: path, ctx });
  t.check(declareInputFiles({ path, card }), [
    "_content/drive/Project_Notes.attach/Project_Notes.md",
  ]);

  const inputContents = new Map([["_content/drive/Project_Notes.attach/Project_Notes.md", "Quarterly planning notes for the project."]]);
  const docs = extractCardDocs({ path, card, contentHash: "h1", inputContents });
  t.check(docs, [
    {
      path: "_content/drive/Project_Notes.gdoc.card",
      kind: "gdoc",
      title: "Project Notes",
      contains: "",
      contentHash: "h1",
      id: "_content/drive/Project_Notes.gdoc.card#",
      fragment: "",
      content: "Quarterly planning notes for the project.",
    },
  ]);
});

// ## A briefing's purpose is folded in from frontmatter
//
// The purpose statement lives in the briefing's `purpose:` field, not its body,
// so the extractor folds it into the document; a directory briefing with no body
// text is still found by what it says the directory is for.
void test("The purpose statement lives in the briefing's purpose: field, not its body, s...", async (t) => {
  const docs = await docsFor(
    "_content/garden/briefing.briefing.card",
    "---\ntype: briefing\npurpose: Plans and records for the vegetable garden.\n---\n"
  );
  t.check(docs, [
    {
      path: "_content/garden/briefing.briefing.card",
      kind: "briefing",
      title: "briefing",
      contains: "",
      contentHash: "hash0",
      id: "_content/garden/briefing.briefing.card#",
      fragment: "",
      content: "Plans and records for the vegetable garden.",
    },
  ]);
});

// ## An image's description doubles as its contains fallback; OCR text indexes
void test("An image's description doubles as its contains fallback; OCR text indexes", async (t) => {
  const docs = await docsFor(
    "_bookkeeping/archive/photo.image.card",
    "---\nfilename:\n  ref: attach/boiler.jpg\n  via:\n    channel: camera-user\n    at: 2026-05-01T10:00:00Z\ndescription: The boiler's serial-number plate (K-44210)\ntext:\n  - source: plate\n    content: Serial K-44210 Model HX-200 240V\n---\n"
  );
  t.check(docs, [
    {
      path: "_bookkeeping/archive/photo.image.card",
      kind: "image",
      title: "The boiler's serial-number plate (K-44210)",
      contains: "The boiler's serial-number plate (K-44210)",
      contentHash: "hash0",
      id: "_bookkeeping/archive/photo.image.card#",
      fragment: "",
      content: "The boiler's serial-number plate (K-44210)\nSerial K-44210 Model HX-200 240V",
    },
  ]);
});

// ## Long bodies split into per-section documents; the preamble stays on the card
//
// The card document carries the title and `contains`. A section document
// carries only its own text: copying the card's title and summary into each
// section made a title query return every section and every section preview
// repeat the summary (`issues/closed/bugs/2026-09-21-search-sections-repeat-the-card-summary.md`).
void test("Long bodies split into per-section documents; the preamble stays on the card", async (t) => {
  const section = "words ".repeat(Math.ceil(SECTION_SPLIT_THRESHOLD / 12));
  const bodyText = `Intro before any heading.\n\n# Mill\n${section}\n\n## Gears\n${section}\n\n# Store\n${section}\n`;
  const docs = await docsFor(
    "box/examples/Engine.doc.card",
    `---\ntitle: The Analytical Engine\ncontains: Babbage's design for a general-purpose computer\n---\n${bodyText}`
  );
  const engineDoc = (fragment: string, content: string) => ({
    path: "box/examples/Engine.doc.card",
    kind: "doc",
    title: fragment === "" ? "The Analytical Engine" : "",
    contains: fragment === "" ? "Babbage's design for a general-purpose computer" : "",
    contentHash: "hash0",
    id: `box/examples/Engine.doc.card#${fragment}`,
    fragment,
    content,
  });
  t.check(docs, [
    engineDoc("", "Intro before any heading."),
    engineDoc("/Mill", section.trim()),
    engineDoc("/Mill/Gears", section.trim()),
    engineDoc("/Store", section.trim()),
  ]);
});

// ## Short bodies with headings stay one document
void test("Short bodies with headings stay one document", async (t) => {
  const split = splitMarkdownSections("Preamble.\n\n# One\nalpha\n\n# Two\nbeta\n");
  t.check(split, {
    preamble: "Preamble.",
    sections: [
      { fragment: "/One", line: 2, text: "alpha" },
      { fragment: "/Two", line: 5, text: "beta" },
    ],
  });

  const docs = await docsFor("box/examples/Short.doc.card", "---\ntitle: Short\n---\nPreamble.\n\n# One\nalpha\n");
  t.check(docs, [
    {
      path: "box/examples/Short.doc.card",
      kind: "doc",
      title: "Short",
      contains: "",
      contentHash: "hash0",
      id: "box/examples/Short.doc.card#",
      fragment: "",
      content: "Preamble.\n\n# One\nalpha",
    },
  ]);
});

// ## Sheets index their tab titles
void test("Sheets index their tab titles", async (t) => {
  const docs = await docsFor(
    "_content/drive/Budget.gsheet.card",
    "---\ndrive:\n  id: d2\n  link: https://docs.google.com/spreadsheets/d/d2/edit\n  owner: o@example.com\n  modified: 2026-05-01\ntitle: Family Budget\nsheets:\n  - ref: attach/tab-0.json\n    title: Monthly Spending\n    gid: \"0\"\n---\n"
  );
  t.check(docs, [
    {
      path: "_content/drive/Budget.gsheet.card",
      kind: "gsheet",
      title: "Family Budget",
      contains: "",
      contentHash: "hash0",
      id: "_content/drive/Budget.gsheet.card#",
      fragment: "",
      content: "Monthly Spending",
    },
  ]);
});
