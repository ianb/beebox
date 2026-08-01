# Scan-import card emission — review question shape

`emitPhotoBundle` writes the photo's image card and, when the Gemini analysis
flags the bundle, a review question in `box/questions/`. The review question
carries a `learning:` block targeting the scan guide — identification
ambiguities are where durable scanner priors surface — while the orphan-back
and unsure questions deliberately carry none (one-off page dispositions; see
`docs/plans/scan-guide-card.md`).

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { emitPhotoBundle, emitOrphanBackQuestion } from "../../../src/core/commands/scan-import-cards.js";
import { splitCardContent } from "../../../src/cards/index.js";
import { createCardSchemaMap } from "../../../src/schemas/registry.js";

function analysis(index, overrides) {
  return {
    index,
    kind: "photo",
    paired_with_index: null,
    description: `Photo ${index}`,
    title: `Photo_${index}`,
    rotation: 0,
    subject_bbox: null,
    has_text: false,
    text_blocks: [],
    date_hint: null,
    flag_for_review: false,
    flag_reason: null,
    ...overrides,
  };
}

async function makeSession() {
  const boxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scan-cards-"));
  const sessionAttachRelDir = "box/inbox/scan-20260801T0900-abcd1234.attach";
  const sessionAttachAbsDir = path.join(boxRoot, sessionAttachRelDir);
  await fs.mkdir(sessionAttachAbsDir, { recursive: true });
  const pageDir = path.join(boxRoot, "tmp", "pages");
  await fs.mkdir(pageDir, { recursive: true });
  const archivePages = [];
  for (let i = 0; i < 2; i++) {
    const p = path.join(pageDir, `page-${i}.jpg`);
    await fs.writeFile(p, "jpeg-bytes");
    archivePages.push(p);
  }
  return { boxRoot, sessionAttachRelDir, sessionAttachAbsDir, archivePages };
}

async function readQuestionFields(boxRoot, questionRelPath) {
  const raw = await fs.readFile(path.join(boxRoot, questionRelPath), "utf-8");
  return parseYaml(splitCardContent(raw).frontmatterText);
}
```

## A flagged bundle emits a review question with a scan-guide learning block

```ts
const session = await makeSession();
const filesToStage = [];
const imageRefs = [];
const questionPaths = [];
await emitPhotoBundle({
  cardSchemas: await createCardSchemaMap(),
  index: 0,
  bundle: {
    photoIndex: 0,
    backIndex: null,
    photo: analysis(0),
    back: null,
    flagForReview: true,
    flagReasons: ["Name on back is ambiguous"],
  },
  startedAt: "2026-08-01T09:00:00Z",
  boxRoot: session.boxRoot,
  sessionAttachAbsDir: session.sessionAttachAbsDir,
  sessionAttachRelDir: session.sessionAttachRelDir,
  archivePages: session.archivePages,
  filesToStage,
  imageRefs,
  questionPaths,
});
JSON.stringify(questionPaths)
=> ["box/questions/scan-20260801T0900-abcd1234-photo-001.review.question.card"]

const fields = await readQuestionFields(session.boxRoot, questionPaths[0]);
fields.learning.sink
=> guide

fields.learning.ref
=> config/scan.guide.card

fields.learning.proposal.includes("DURABLE identification")
=> true

fields.learning.proposal.includes("cb create guide --name scan")
=> true

await fs.rm(session.boxRoot, { recursive: true, force: true });
```

## Orphan-back questions carry no learning block

```ts
const session = await makeSession();
const filesToStage = [];
const questionPaths = [];
await emitOrphanBackQuestion(
  { index: 1, analysis: analysis(1, { kind: "back", text_blocks: [{ source: "back", text: "May 72" }] }) },
  {
    index: 0,
    boxRoot: session.boxRoot,
    sessionAttachAbsDir: session.sessionAttachAbsDir,
    sessionAttachRelDir: session.sessionAttachRelDir,
    archivePages: session.archivePages,
    filesToStage,
    questionPaths,
    askedAt: "2026-08-01T09:00:00Z",
  }
);
const fields = await readQuestionFields(session.boxRoot, questionPaths[0]);
"learning" in fields
=> false

await fs.rm(session.boxRoot, { recursive: true, force: true });
```
