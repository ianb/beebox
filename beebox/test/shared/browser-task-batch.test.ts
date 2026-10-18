// # Browser-task batch validation
//
// A batch is a manifest (`{ coverage, records }`) plus the files uploaded beside
// it. `validateBatch` checks the whole thing against the task's own JSON Schema
// for one record and refuses the batch as a unit, reporting every issue it found.

import { test } from "tap";
import "agent-doctest/tap";
import { validateBatch, isValidBatchFileName } from "../../src/shared/browser-task-batch.js";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "date", "permalink"],
  properties: {
    name: { type: "string", minLength: 1 },
    date: { type: "string", format: "date" },
    permalink: { type: "string" },
    poster: { type: "string", format: "attachment" },
    photos: { type: "array", items: { type: "string", format: "attachment" } },
  },
};
const coverage = { scanned: 12, stoppedAt: "https://example.test/p/9", reason: "reached-limit" };
const good = { name: "Spring Show", date: "2026-10-03", permalink: "https://example.test/p/9", poster: "p9.jpg", photos: ["p9-a.jpg"] };
const kinds = (r: ReturnType<typeof validateBatch>) => (r.ok ? [] : r.issues.map((i) => i.kind));

// ## A clean batch
//
// Every record parses, every attachment is uploaded, every upload is referenced.
void test("Every record parses, every attachment is uploaded, every upload is referenced.", async (t) => {
  // doctest:L32
  const ok = validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg"] });
  t.check(ok.ok ? { count: ok.count, reason: ok.coverage.reason } : ok.issues, {
    count: 1,
    reason: "reached-limit",
  });
});

// ## Each issue kind, one input each
//
// A record that fails the schema reports the field path and zod's message:
void test("A record that fails the schema reports the field path and zod's message:", async (t) => {
  // doctest:L42
  const bad = validateBatch({ schemaJson: schema, manifest: { coverage, records: [{ ...good, name: "", date: "soon" }] }, fileNames: ["p9.jpg", "p9-a.jpg"] });
  t.check(bad.ok ? [] : bad.issues.map((i) => `${i.path}: ${i.message}`), [
    "records[0].name: Too small: expected string to have >=1 characters",
    "records[0].date: Invalid ISO date",
  ]);
});

// An invented field is an error because the schema says `additionalProperties: false`:
void test("An invented field is an error because the schema says additionalProperties:", async (t) => {
  // doctest:L50
  t.check(kinds(validateBatch({ schemaJson: schema, manifest: { coverage, records: [{ ...good, venue: "Barn" }] }, fileNames: ["p9.jpg", "p9-a.jpg"] })), [
    "record",
  ]);
});

// A referenced file that was not uploaded, with the record index and the name:
void test("A referenced file that was not uploaded, with the record index and the name:", async (t) => {
  // doctest:L57
  const missing = validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg"] });
  t.check(missing.ok ? [] : missing.issues, [
    {
      kind: "missing-file",
      path: "records[0].photos[0]",
      index: 0,
      name: "p9-a.jpg",
      message: "references \"p9-a.jpg\", which was not uploaded",
    },
  ]);
});

// An uploaded file nothing references:
void test("An uploaded file nothing references:", async (t) => {
  // doctest:L65
  t.check(kinds(validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg", "stray.png"] })), [
    "unreferenced-file",
  ]);
});

// Bad file names: a path, a leading dot, or a reserved name. A bad name is never
// also reported as unreferenced.
void test("Bad file names:", async (t) => {
  // doctest:L73
  t.check(kinds(validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg", "../x.png", ".hidden", "records.json"] })), [
    "bad-filename",
    "bad-filename",
    "bad-filename",
  ]);

  // doctest:L76
  t.check(["a.jpg", "A_b-c.9.PNG", "../a", ".a", "records.json", "filed.json", "a/b.jpg", ""].map(isValidBatchFileName), [
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
});

// Missing or malformed coverage refuses the batch before records are looked at:
void test("Missing or malformed coverage refuses the batch before records are looked at:", async (t) => {
  // doctest:L83
  const noCoverage = validateBatch({ schemaJson: schema, manifest: { records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg"] });
  t.check(noCoverage.ok ? [] : noCoverage.issues.map((i) => `${i.kind} ${i.path}`), [
    "coverage manifest.coverage",
    "coverage manifest",
  ]);

  // doctest:L87
  const badReason = validateBatch({ schemaJson: schema, manifest: { coverage: { ...coverage, reason: "bored" }, records: [] }, fileNames: [] });
  t.check(badReason.ok ? [] : badReason.issues.map((i) => i.path), [
    "manifest.coverage.reason",
    "manifest",
  ]);

  // The last issue on any envelope failure states the whole expected shape, so
  // the executor never has to reverse-engineer it:

  // doctest:L96
  await t.checkText((badReason.ok ? "" : badReason.issues.at(-1)?.message ?? "").startsWith('records.json is { "coverage": { "scanned"'), "true");
});

// A bare array is not a manifest:
void test("A bare array is not a manifest:", async (t) => {
  // doctest:L103
  t.check(kinds(validateBatch({ schemaJson: schema, manifest: [good], fileNames: [] })), [
    "coverage",
    "coverage",
  ]);
});

// A schema that uses a keyword the attachment walk cannot follow is refused by
// name, so the author knows what to remove:
void test("A schema that uses a keyword the attachment walk cannot follow is refused by...", async (t) => {
  // doctest:L111
  const withRef = validateBatch({ schemaJson: { ...schema, properties: { ...schema.properties, venue: { $ref: "#/$defs/venue" } } }, manifest: { coverage, records: [] }, fileNames: [] });
  t.check(withRef.ok ? [] : withRef.issues.map((i) => `${i.kind}: ${i.message}`), [
    "schema: schema.json uses \"properties.venue.$ref\", which the attachment walk does not support; write a flat schema",
  ]);
});

// A schema that is not a schema at all reports the conversion error:
void test("A schema that is not a schema at all reports the conversion error:", async (t) => {
  // doctest:L119
  t.check(kinds(validateBatch({ schemaJson: { type: "spaceship" }, manifest: { coverage, records: [] }, fileNames: [] })), [
    "schema",
  ]);
});

// A composition that mixes an attachment branch with another string branch is
// ambiguous (is the value a file name or a URL?) and is refused by path:
void test("A composition that mixes an attachment branch with another string branch is a...", async (t) => {
  // doctest:L127
  const mixed = { type: "object", properties: { media: { anyOf: [{ type: "string", format: "attachment" }, { type: "string", format: "uri" }] } } };
  const amb = validateBatch({ schemaJson: mixed, manifest: { coverage, records: [] }, fileNames: [] });
  t.check(amb.ok ? [] : amb.issues.map((i) => `${i.kind}: ${i.message}`), [
    "schema: schema.json \"properties.media.anyOf\" mixes an attachment branch with another string branch; an attachment field must be the only string alternative",
  ]);
});

// ## Attachments inside composition keywords
//
// `anyOf` branches are tried against the same value, so an attachment reached
// through a branch is still required.
void test("anyOf branches are tried against the same value, so an attachment reached thr...", async (t) => {
  // doctest:L139
  const branched = { type: "object", properties: { media: { anyOf: [{ type: "string", format: "attachment" }, { type: "null" }] } } };
  t.check(kinds(validateBatch({ schemaJson: branched, manifest: { coverage, records: [{ media: "m.jpg" }, { media: null }] }, fileNames: [] })), [
    "missing-file",
  ]);

  // doctest:L143
  t.check(kinds(validateBatch({ schemaJson: branched, manifest: { coverage, records: [{ media: "m.jpg" }, { media: null }] }, fileNames: ["m.jpg"] })), []);
});

// ## Zero records is a valid batch
//
// A scan that hit a login wall reports that, with nothing to file.
void test("A scan that hit a login wall reports that, with nothing to file.", async (t) => {
  // doctest:L152
  const wall = validateBatch({ schemaJson: schema, manifest: { coverage: { scanned: 0, stoppedAt: "", reason: "login-wall" }, records: [] }, fileNames: [] });
  t.check(wall.ok ? [wall.count, wall.coverage.reason] : wall.issues, [
    0,
    "login-wall",
  ]);
});
