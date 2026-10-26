// # Scan-import card emission — review question shape
//
// `emitPhotoBundle` writes the photo's image card and, when the Gemini analysis
// flags the bundle, a review question in `_bookkeeping/questions/`. The review question
// carries a `learning:` block targeting the scan guide — identification
// ambiguities are where durable scanner priors surface — while the orphan-back
// and unsure questions deliberately carry none (one-off page dispositions; see
// `docs/plans/scan-guide-card.md`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { emitPhotoBundle, emitOrphanBackQuestion } from "../../../../src/core/commands/scan-import/cards.js";
import { splitCardContent } from "../../../../src/exports/cards.js";
import { createCardSchemaMap } from "../../../../src/schemas.js";
import type { ScanPageAnalysis } from "../../../../src/core/describe-images/gemini.js";

function analysis(index: number, overrides?: Partial<ScanPageAnalysis>): ScanPageAnalysis {
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
  const sessionAttachRelDir = "_content/inbox/scan-20260801T0900-abcd1234.attach";
  const sessionAttachAbsDir = path.join(boxRoot, sessionAttachRelDir);
  await fs.mkdir(sessionAttachAbsDir, { recursive: true });
  const pageDir = path.join(boxRoot, "tmp", "pages");
  await fs.mkdir(pageDir, { recursive: true });
  const archivePages: string[] = [];
  for (let i = 0; i < 2; i++) {
    const p = path.join(pageDir, `page-${i}.jpg`);
    await fs.writeFile(p, "jpeg-bytes");
    archivePages.push(p);
  }
  return { boxRoot, sessionAttachRelDir, sessionAttachAbsDir, archivePages };
}

async function readQuestionFields(boxRoot: string, questionRelPath: string | undefined) {
  assert.ok(questionRelPath !== undefined);
  const raw = await fs.readFile(path.join(boxRoot, questionRelPath), "utf-8");
  return parseYaml(splitCardContent(raw).frontmatterText);
}

// ## A flagged bundle emits a review question with a scan-guide learning block
void test("A flagged bundle emits a review question with a scan-guide learning block", async (t) => {
  const session = await makeSession();
  const filesToStage: string[] = [];
  const imageRefs: string[] = [];
  const questionPaths: string[] = [];
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
  t.check(questionPaths, [
    "_bookkeeping/questions/scan-20260801T0900-abcd1234-photo-001.review.question.card",
  ]);

  const fields = await readQuestionFields(session.boxRoot, questionPaths[0]);
  t.check(fields, {
    title: "Check scanned photo 001",
    memo: `Photo 001 (page 1) needs review:
- Name on back is ambiguous`,
    prompt: "Review photo-001: confirm description and back-of-photo text are accurate.",
    input: { type: "text" },
    learning: {
      sink: "guide",
      ref: "_config/scan.guide.card",
      proposal:
        "If the answer settles a DURABLE identification or pattern (a recurring person, place, vendor, or handwriting convention — not a one-off fix to this photo), record it as a triage-rule belief in the scan guide, creating the guide first via `bbx create guide --name scan` if it does not exist. Skip recording for one-off corrections.",
    },
    directive: "Open _content/inbox/scan-20260801T0900-abcd1234.attach/photo-001.image.card and adjust description or text blocks.",
    context: [{ ref: "_content/inbox/scan-20260801T0900-abcd1234.attach/photo-001.image.card" }],
    "asked-at": "2026-08-01T09:00:00Z",
  });

  await fs.rm(session.boxRoot, { recursive: true, force: true });
});

// ## Orphan-back questions carry no learning block
void test("Orphan-back questions carry no learning block", async (t) => {
  const session = await makeSession();
  const filesToStage: string[] = [];
  const questionPaths: string[] = [];
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
  t.check(fields, {
    memo: `Found a back-of-photo with no matching photo (page 2).

Transcribed text:
May 72`,
    prompt: "Which photo does orphan-back-001.jpg belong with, or should it be discarded?",
    input: { type: "text" },
    directive:
      "If it belongs with a photo in this session, attach by appending text blocks to that image card. Otherwise delete _content/inbox/scan-20260801T0900-abcd1234.attach/orphan-back-001.jpg.",
    context: [{ ref: "_content/inbox/scan-20260801T0900-abcd1234.attach/orphan-back-001.jpg" }],
    "asked-at": "2026-08-01T09:00:00Z",
  });

  await fs.rm(session.boxRoot, { recursive: true, force: true });
});
