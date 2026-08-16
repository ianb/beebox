// Tests for the story-extraction ingest core (buildRunFile): strict zod
// validation, verbatim span verification (fabrication = hard error, duplicate =
// ambiguous flag), and docText embedding. Run with:
//   node --import tsx --test site/story/ingest.test.ts   (or `pnpm --dir site test`)

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRunFile, IngestError, type RawNugget } from "./ingest.js";

const DOC = "callback-box/docs/example.md";

// A valid raw nugget whose span is a substring of `sampleDoc` below.
function nugget(overrides?: Partial<RawNugget>): RawNugget {
  return {
    slug: "unconventional-choice",
    span: "the filesystem is the database",
    gloss: "cb stores state as files, not rows.",
    tags: ["filesystem", "storage"],
    criteria: [1, 3],
    confidence: "strong",
    ...overrides,
  };
}

const sampleDoc = "Callback box is unusual: the filesystem is the database, and git is history.\n";

function ingest(rawJson: unknown, docText?: string): ReturnType<typeof buildRunFile> {
  return buildRunFile({
    run: "run-test",
    variant: "v1",
    doc: DOC,
    docText: docText ?? sampleDoc,
    fileName: "v1-example.json",
    rawJson,
  });
}

test("valid ingest: nugget passes and its span is marked ok", () => {
  const result = ingest({ nuggets: [nugget()] });
  assert.equal(result.run, "run-test");
  assert.equal(result.variant, "v1");
  assert.equal(result.doc, DOC);
  assert.equal(result.nuggets.length, 1);
  assert.equal(result.nuggets[0]?.spanCheck, "ok");
});

test("docText is embedded verbatim on the run file", () => {
  const result = ingest({ nuggets: [nugget()] });
  assert.equal(result.docText, sampleDoc);
});

test("fabricated span is a hard error naming the nugget", () => {
  assert.throws(
    () => ingest({ nuggets: [nugget({ slug: "made-up-beat", span: "this text is nowhere in the source" })] }),
    (e: unknown) => {
      assert.ok(e instanceof IngestError);
      assert.match(e.message, /made-up-beat/);
      assert.match(e.message, /span not found in|fabricated span/);
      return true;
    },
  );
});

test("span appearing more than once is kept and flagged ambiguous", () => {
  const doc = "git is history. git is history.\n";
  const result = ingest({ nuggets: [nugget({ span: "git is history" })] }, doc);
  assert.equal(result.nuggets[0]?.spanCheck, "ambiguous");
});

test("criterion 12 is rejected (the rubric has 8) naming the field", () => {
  assert.throws(
    () => ingest({ nuggets: [nugget({ criteria: [12] })] }),
    (e: unknown) => {
      assert.ok(e instanceof IngestError);
      assert.match(e.message, /nuggets\[0]\.criteria\[0]/);
      return true;
    },
  );
});

test("non-kebab tag is rejected naming the field", () => {
  assert.throws(
    () => ingest({ nuggets: [nugget({ tags: ["Not Kebab"] })] }),
    (e: unknown) => {
      assert.ok(e instanceof IngestError);
      assert.match(e.message, /nuggets\[0]\.tags\[0]/);
      assert.match(e.message, /kebab-case/);
      return true;
    },
  );
});

test("an unknown top-level key is rejected (strict schema)", () => {
  assert.throws(() => ingest({ nuggets: [nugget()], extra: true }), IngestError);
});
