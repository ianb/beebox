// # Browser-task batch validation
//
// A batch is a manifest (`{ coverage, records }`) plus the files uploaded beside
// it. `validateBatch` checks the whole thing against the task's own JSON Schema
// for one record and refuses the batch as a unit, reporting every issue it found.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
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
// The last issue on any envelope failure states the whole expected shape, so
// the executor never has to reverse-engineer it.
const ENVELOPE_SHAPE = "records.json is { \"coverage\": { \"scanned\": <int, items looked at>, \"stoppedAt\": \"<permalink or date where the scan stopped>\", \"reason\": \"<one of reached-watermark | reached-limit | reached-date | end-of-feed | login-wall | rate-limited | error>\", \"notes\": \"<optional: what you could not do>\" }, \"records\": [ ...one object per record... ] }";
const coverage = { scanned: 12, stoppedAt: "https://example.test/p/9", reason: "reached-limit" };
const good = { name: "Spring Show", date: "2026-10-03", permalink: "https://example.test/p/9", poster: "p9.jpg", photos: ["p9-a.jpg"] };

// ## A clean batch
//
// Every record parses, every attachment is uploaded, every upload is referenced.
void test("Every record parses, every attachment is uploaded, every upload is referenced.", async (t) => {
  // doctest:L32
  const ok = validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg"] });
  t.check(ok, {
    ok: true,
    count: 1,
    coverage: {
      scanned: 12,
      stoppedAt: "https://example.test/p/9",
      reason: "reached-limit",
    },
    records: [
      {
        name: "Spring Show",
        date: "2026-10-03",
        permalink: "https://example.test/p/9",
        poster: "p9.jpg",
        photos: [
          "p9-a.jpg",
        ],
      },
    ],
  });
});

// ## Each issue kind, one input each
//
// A record that fails the schema reports the field path and zod's message:
void test("A record that fails the schema reports the field path and zod's message:", async (t) => {
  // doctest:L42
  const bad = validateBatch({ schemaJson: schema, manifest: { coverage, records: [{ ...good, name: "", date: "soon" }] }, fileNames: ["p9.jpg", "p9-a.jpg"] });
  t.check(bad, {
    ok: false,
    issues: [
      {
        kind: "record",
        path: "records[0].name",
        index: 0,
        message: "Too small: expected string to have >=1 characters",
      },
      {
        kind: "record",
        path: "records[0].date",
        index: 0,
        message: "Invalid ISO date",
      },
    ],
  });
});

// An invented field is an error because the schema says `additionalProperties: false`:
void test("An invented field is an error because the schema says additionalProperties:", async (t) => {
  // doctest:L50
  t.check(validateBatch({ schemaJson: schema, manifest: { coverage, records: [{ ...good, venue: "Barn" }] }, fileNames: ["p9.jpg", "p9-a.jpg"] }), {
    ok: false,
    issues: [
      {
        kind: "record",
        path: "records[0]",
        index: 0,
        message: "Unrecognized key: \"venue\"",
      },
    ],
  });
});

// A referenced file that was not uploaded, with the record index and the name:
void test("A referenced file that was not uploaded, with the record index and the name:", async (t) => {
  // doctest:L57
  const missing = validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg"] });
  t.check(missing, {
    ok: false,
    issues: [
      {
        kind: "missing-file",
        path: "records[0].photos[0]",
        index: 0,
        name: "p9-a.jpg",
        message: "references \"p9-a.jpg\", which was not uploaded",
      },
    ],
  });
});

// An uploaded file nothing references:
void test("An uploaded file nothing references:", async (t) => {
  // doctest:L65
  t.check(validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg", "stray.png"] }), {
    ok: false,
    issues: [
      {
        kind: "unreferenced-file",
        path: "files/stray.png",
        name: "stray.png",
        message: "\"stray.png\" is not referenced by any record",
      },
    ],
  });
});

// Bad file names: a path, a leading dot, or a reserved name. A bad name is never
// also reported as unreferenced.
void test("Bad file names:", async (t) => {
  // doctest:L73
  t.check(validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg", "../x.png", ".hidden", "records.json"] }), {
    ok: false,
    issues: [
      {
        kind: "bad-filename",
        path: "files/../x.png",
        name: "../x.png",
        message: "\"../x.png\" must be a bare name of letters, digits, dot, dash, underscore (no leading dot), at most 200 chars",
      },
      {
        kind: "bad-filename",
        path: "files/.hidden",
        name: ".hidden",
        message: "\".hidden\" must be a bare name of letters, digits, dot, dash, underscore (no leading dot), at most 200 chars",
      },
      {
        kind: "bad-filename",
        path: "files/records.json",
        name: "records.json",
        message: "\"records.json\" is reserved by the batch layout",
      },
    ],
  });

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
  t.check(noCoverage, {
    ok: false,
    issues: [
      {
        kind: "coverage",
        path: "manifest.coverage",
        message: "Invalid input: expected object, received undefined",
      },
      {
        kind: "coverage",
        path: "manifest",
        message: ENVELOPE_SHAPE,
      },
    ],
  });

  // doctest:L87
  const badReason = validateBatch({ schemaJson: schema, manifest: { coverage: { ...coverage, reason: "bored" }, records: [] }, fileNames: [] });
  t.check(badReason, {
    ok: false,
    issues: [
      {
        kind: "coverage",
        path: "manifest.coverage.reason",
        message: "Invalid option: expected one of \"reached-watermark\"|\"reached-limit\"|\"reached-date\"|\"end-of-feed\"|\"login-wall\"|\"rate-limited\"|\"error\"",
      },
      {
        kind: "coverage",
        path: "manifest",
        message: ENVELOPE_SHAPE,
      },
    ],
  });

});

// A bare array is not a manifest:
void test("A bare array is not a manifest:", async (t) => {
  // doctest:L103
  t.check(validateBatch({ schemaJson: schema, manifest: [good], fileNames: [] }), {
    ok: false,
    issues: [
      {
        kind: "coverage",
        path: "manifest",
        message: "Invalid input: expected object, received array",
      },
      {
        kind: "coverage",
        path: "manifest",
        message: ENVELOPE_SHAPE,
      },
    ],
  });
});

// A schema that uses a keyword the attachment walk cannot follow is refused by
// name, so the author knows what to remove:
void test("A schema that uses a keyword the attachment walk cannot follow is refused by...", async (t) => {
  // doctest:L111
  const withRef = validateBatch({ schemaJson: { ...schema, properties: { ...schema.properties, venue: { $ref: "#/$defs/venue" } } }, manifest: { coverage, records: [] }, fileNames: [] });
  t.check(withRef, {
    ok: false,
    issues: [
      {
        kind: "schema",
        path: "schema",
        message: "schema.json uses \"properties.venue.$ref\", which the attachment walk does not support; write a flat schema",
      },
    ],
  });
});

// A schema that is not a schema at all reports the conversion error:
void test("A schema that is not a schema at all reports the conversion error:", async (t) => {
  // doctest:L119
  t.check(validateBatch({ schemaJson: { type: "spaceship" }, manifest: { coverage, records: [] }, fileNames: [] }), {
    ok: false,
    issues: [
      {
        kind: "schema",
        path: "schema",
        message: "schema.json could not be converted: Unsupported type: spaceship",
      },
    ],
  });
});

// A composition that mixes an attachment branch with another string branch is
// ambiguous (is the value a file name or a URL?) and is refused by path:
void test("A composition that mixes an attachment branch with another string branch is a...", async (t) => {
  // doctest:L127
  const mixed = { type: "object", properties: { media: { anyOf: [{ type: "string", format: "attachment" }, { type: "string", format: "uri" }] } } };
  const amb = validateBatch({ schemaJson: mixed, manifest: { coverage, records: [] }, fileNames: [] });
  t.check(amb, {
    ok: false,
    issues: [
      {
        kind: "schema",
        path: "schema",
        message: "schema.json \"properties.media.anyOf\" mixes an attachment branch with another string branch; an attachment field must be the only string alternative",
      },
    ],
  });
});

// ## Attachments inside composition keywords
//
// `anyOf` branches are tried against the same value, so an attachment reached
// through a branch is still required.
void test("anyOf branches are tried against the same value, so an attachment reached thr...", async (t) => {
  // doctest:L139
  const branched = { type: "object", properties: { media: { anyOf: [{ type: "string", format: "attachment" }, { type: "null" }] } } };
  t.check(validateBatch({ schemaJson: branched, manifest: { coverage, records: [{ media: "m.jpg" }, { media: null }] }, fileNames: [] }), {
    ok: false,
    issues: [
      {
        kind: "missing-file",
        path: "records[0].media",
        index: 0,
        name: "m.jpg",
        message: "references \"m.jpg\", which was not uploaded",
      },
    ],
  });

  // doctest:L143
  t.check(validateBatch({ schemaJson: branched, manifest: { coverage, records: [{ media: "m.jpg" }, { media: null }] }, fileNames: ["m.jpg"] }), {
    ok: true,
    count: 2,
    coverage: {
      scanned: 12,
      stoppedAt: "https://example.test/p/9",
      reason: "reached-limit",
    },
    records: [
      {
        media: "m.jpg",
      },
      {
        media: null,
      },
    ],
  });
});

// ## Zero records is a valid batch
//
// A scan that hit a login wall reports that, with nothing to file.
void test("A scan that hit a login wall reports that, with nothing to file.", async (t) => {
  // doctest:L152
  const wall = validateBatch({ schemaJson: schema, manifest: { coverage: { scanned: 0, stoppedAt: "", reason: "login-wall" }, records: [] }, fileNames: [] });
  t.check(wall, {
    ok: true,
    count: 0,
    coverage: {
      scanned: 0,
      stoppedAt: "",
      reason: "login-wall",
    },
    records: [],
  });
});
