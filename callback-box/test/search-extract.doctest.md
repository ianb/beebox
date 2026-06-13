# search/extract: card → search documents

Pure extraction: a loaded card becomes one search document, plus per-section
documents when the body is long. Per-kind frontmatter folds into searchable
text; email body files are deliberately never read (untrusted content stays
out of the index — see `src/schemas/email-message.tsx`).

```ts setup
import { loadCardFromText, type LoadCardContext } from "../src/core/card-io.js";
import {
  declareInputFiles,
  extractCardDocs,
  SECTION_SPLIT_THRESHOLD,
} from "../src/core/search/extract.js";
import { splitMarkdownSections } from "../src/core/search/markdown-sections.js";
import { schemas, createCardSchemaMap } from "../src/schemas/registry.js";
import type { ElementSchema } from "cardworks";

const ctx: LoadCardContext = {
  cardSchemas: await createCardSchemaMap(),
  elementSchemas: new Map<string, ElementSchema>(schemas.map((s) => [s.tagName, s])),
};

async function docsFor(path: string, text: string, inputContents?: Map<string, string>) {
  const card = await loadCardFromText({ content: text, source: path, ctx });
  const input = { path, card, contentHash: "hash0" };
  return extractCardDocs(inputContents ? { ...input, inputContents } : input);
}
```

## A memo becomes one document titled from its body

```
const docs = await docsFor(
  "box/inbox/Voice_Note.memo.card",
  "---\ncreated: 2026-05-22T10:00:00Z\ncontains: Dentist moved to June 17; confirmation in this email.\n---\nThe dentist called — appointment moved to June 17.\n"
);
docs.length
=> 1

docs[0].id
=> box/inbox/Voice_Note.memo.card#

docs[0].kind
=> memo

docs[0].title
=> The dentist called — appointment moved to June 17.

docs[0].contains
=> Dentist moved to June 17; confirmation in this email.

docs[0].created
=> 2026-05-22T10:00:00Z

docs[0].content
=> The dentist called — appointment moved to June 17.
```

## Email messages fold headers and snippet, never the body file

```
const docs = await docsFor(
  "box/inbox/email/t.attach/msg-001.email-message.card",
  "---\nmessage-id: \"<m1@example.com>\"\nthread-id: t1\nfrom: alice@example.com\nto: bob@example.com\ndate: 2026-05-14T19:00:00Z\nsubject: Weekend plans\nsnippet: Hey, are you free Saturday...\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n"
);
docs[0].title
=> Weekend plans

docs[0].content
=> Weekend plans
alice@example.com
bob@example.com
Hey, are you free Saturday...

JSON.stringify(declareInputFiles({ path: "box/inbox/email/t.attach/msg-001.email-message.card", card: await loadCardFromText({ content: "---\nmessage-id: \"<m1@example.com>\"\nthread-id: t1\nfrom: a@x.com\ndate: 2026-05-14T19:00:00Z\nsubject: s\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n", source: "box/inbox/email/t.attach/msg-001.email-message.card", ctx }) }))
=> []
```

## Email threads fold subject, participants, labels, and date-range

```
const docs = await docsFor(
  "box/inbox/email/thread-x.email-thread.card",
  "---\nthread-id: t1\nsubject: Usage-based pricing demo\nparticipants:\n  - hello@metricly.example\ndate-range:\n  start: 2026-05-14T19:00:00Z\n  end: 2026-05-14T19:00:00Z\nlabels:\n  - promotions\nmessages:\n  - ref: attach/msg-001.email-message.card\n---\n"
);
docs[0].title
=> Usage-based pricing demo

docs[0].created
=> 2026-05-14T19:00:00Z

docs[0].content
=> Usage-based pricing demo
hello@metricly.example
promotions
```

## Gdocs declare their content snapshot and index it as the body

```
const cardText = "---\ndrive-id: d1\ntitle: Project Notes\nmodified: 2026-05-01\nlink: https://docs.google.com/document/d/d1/edit\nowner: owner@example.com\ncontent:\n  ref: attach/Project_Notes.md\n---\n";
const path = "store/drive/Project_Notes.gdoc.card";
const card = await loadCardFromText({ content: cardText, source: path, ctx });
JSON.stringify(declareInputFiles({ path, card }))
=> ["store/drive/Project_Notes.attach/Project_Notes.md"]

const inputContents = new Map([["store/drive/Project_Notes.attach/Project_Notes.md", "Quarterly planning notes for the project."]]);
const docs = extractCardDocs({ path, card, contentHash: "h1", inputContents });
docs[0].title
=> Project Notes

docs[0].content
=> Quarterly planning notes for the project.
```

## An image's description doubles as its contains fallback; OCR text indexes

```
const docs = await docsFor(
  "store/archive/photo.image.card",
  "---\nstatus: analyzed\nfilename:\n  ref: attach/boiler.jpg\n  captured: 2026-05-01T10:00:00Z\n  source: camera-user\ndescription: The boiler's serial-number plate (K-44210)\ntext:\n  - source: plate\n    content: Serial K-44210 Model HX-200 240V\n---\n"
);
docs[0].contains
=> The boiler's serial-number plate (K-44210)

docs[0].title
=> The boiler's serial-number plate (K-44210)

docs[0].content.includes("Model HX-200 240V")
=> true
```

## Long bodies split into per-section documents; the preamble stays on the card

```
const section = "words ".repeat(Math.ceil(SECTION_SPLIT_THRESHOLD / 12));
const bodyText = `Intro before any heading.\n\n# Mill\n${section}\n\n## Gears\n${section}\n\n# Store\n${section}\n`;
const docs = await docsFor(
  "box/examples/Engine.doc.card",
  `---\ntitle: The Analytical Engine\n---\n${bodyText}`
);
JSON.stringify(docs.map((d) => d.fragment))
=> ["","/Mill","/Mill/Gears","/Store"]

docs[0].content
=> Intro before any heading.

docs[1].id
=> box/examples/Engine.doc.card#/Mill

docs.every((d) => d.kind === "doc" && d.title === "The Analytical Engine")
=> true
```

## Short bodies with headings stay one document

```
const split = splitMarkdownSections("Preamble.\n\n# One\nalpha\n\n# Two\nbeta\n");
JSON.stringify(split.preamble)
=> "Preamble."

JSON.stringify(split.sections.map((s) => s.fragment))
=> ["/One","/Two"]

const docs = await docsFor("box/examples/Short.doc.card", "---\ntitle: Short\n---\nPreamble.\n\n# One\nalpha\n");
docs.length
=> 1
```

## XML cards index their walked text

```
const card = await loadCardFromText({
  content: "<note title=\"Saute step\"><step>Heat the pan.</step><step>Add onions.</step></note>",
  source: "store/Note.note.card",
  ctx,
});
card.kind
=> xml

const docs = extractCardDocs({ path: "store/Note.note.card", card, contentHash: "h2" });
docs[0].title
=> Saute step

docs[0].content
=> Heat the pan. Add onions.
```

## Sheets index their tab titles

```
const docs = await docsFor(
  "store/drive/Budget.sheet.card",
  "---\ndrive-id: d2\ntitle: Family Budget\nmodified: 2026-05-01\nlink: https://docs.google.com/spreadsheets/d/d2/edit\nowner: o@example.com\nsheets:\n  - ref: attach/tab-0.json\n    title: Monthly Spending\n    gid: \"0\"\n---\n"
);
docs[0].content
=> Monthly Spending
```
