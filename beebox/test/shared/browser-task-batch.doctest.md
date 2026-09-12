# Browser-task batch validation

A batch is a manifest (`{ coverage, records }`) plus the files uploaded beside
it. `validateBatch` checks the whole thing against the task's own JSON Schema
for one record and refuses the batch as a unit, reporting every issue it found.

```ts setup
import { validateBatch, isValidBatchFileName, COVERAGE_REASONS } from "../../src/shared/browser-task-batch.js";

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
```

## A clean batch

Every record parses, every attachment is uploaded, every upload is referenced.

```ts
const ok = validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg"] });
JSON.stringify(ok.ok ? { count: ok.count, reason: ok.coverage.reason } : ok.issues)
=> {"count":1,"reason":"reached-limit"}
```

## Each issue kind, one input each

A record that fails the schema reports the field path and zod's message:

```ts
const bad = validateBatch({ schemaJson: schema, manifest: { coverage, records: [{ ...good, name: "", date: "soon" }] }, fileNames: ["p9.jpg", "p9-a.jpg"] });
JSON.stringify(bad.ok ? [] : bad.issues.map((i) => `${i.path}: ${i.message}`))
=> ["records[0].name: Too small: expected string to have >=1 characters","records[0].date: Invalid ISO date"]
```

An invented field is an error because the schema says `additionalProperties: false`:

```ts
JSON.stringify(kinds(validateBatch({ schemaJson: schema, manifest: { coverage, records: [{ ...good, venue: "Barn" }] }, fileNames: ["p9.jpg", "p9-a.jpg"] })))
=> ["record"]
```

A referenced file that was not uploaded, with the record index and the name:

```ts
const missing = validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg"] });
JSON.stringify(missing.ok ? [] : missing.issues)
=> [{"kind":"missing-file","path":"records[0].photos[0]","index":0,"name":"p9-a.jpg","message":"references \"p9-a.jpg\", which was not uploaded"}]
```

An uploaded file nothing references:

```ts
JSON.stringify(kinds(validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg", "stray.png"] })))
=> ["unreferenced-file"]
```

Bad file names: a path, a leading dot, or a reserved name. A bad name is never
also reported as unreferenced.

```ts
JSON.stringify(kinds(validateBatch({ schemaJson: schema, manifest: { coverage, records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg", "../x.png", ".hidden", "records.json"] })))
=> ["bad-filename","bad-filename","bad-filename"]

JSON.stringify(["a.jpg", "A_b-c.9.PNG", "../a", ".a", "records.json", "filed.json", "a/b.jpg", ""].map(isValidBatchFileName))
=> [true,true,false,false,false,false,false,false]
```

Missing or malformed coverage refuses the batch before records are looked at:

```ts
const noCoverage = validateBatch({ schemaJson: schema, manifest: { records: [good] }, fileNames: ["p9.jpg", "p9-a.jpg"] });
JSON.stringify(noCoverage.ok ? [] : noCoverage.issues.map((i) => `${i.kind} ${i.path}`))
=> ["coverage manifest.coverage"]

const badReason = validateBatch({ schemaJson: schema, manifest: { coverage: { ...coverage, reason: "bored" }, records: [] }, fileNames: [] });
JSON.stringify(badReason.ok ? [] : badReason.issues.map((i) => i.path))
=> ["manifest.coverage.reason"]

JSON.stringify(COVERAGE_REASONS)
=> ["reached-watermark","reached-limit","end-of-feed","login-wall","rate-limited","error"]
```

A bare array is not a manifest:

```ts
JSON.stringify(kinds(validateBatch({ schemaJson: schema, manifest: [good], fileNames: [] })))
=> ["coverage"]
```

A schema that uses a keyword the attachment walk cannot follow is refused by
name, so the author knows what to remove:

```ts
const withRef = validateBatch({ schemaJson: { ...schema, properties: { ...schema.properties, venue: { $ref: "#/$defs/venue" } } }, manifest: { coverage, records: [] }, fileNames: [] });
JSON.stringify(withRef.ok ? [] : withRef.issues.map((i) => `${i.kind}: ${i.message}`))
=> ["schema: schema.json uses \"properties.venue.$ref\", which the attachment walk does not support; write a flat schema"]
```

A schema that is not a schema at all reports the conversion error:

```ts
JSON.stringify(kinds(validateBatch({ schemaJson: { type: "spaceship" }, manifest: { coverage, records: [] }, fileNames: [] })))
=> ["schema"]
```

## Attachments inside composition keywords

`anyOf` branches are tried against the same value, so an attachment reached
through a branch is still required.

```ts
const branched = { type: "object", properties: { media: { anyOf: [{ type: "string", format: "attachment" }, { type: "null" }] } } };
JSON.stringify(kinds(validateBatch({ schemaJson: branched, manifest: { coverage, records: [{ media: "m.jpg" }, { media: null }] }, fileNames: [] })))
=> ["missing-file"]

JSON.stringify(kinds(validateBatch({ schemaJson: branched, manifest: { coverage, records: [{ media: "m.jpg" }, { media: null }] }, fileNames: ["m.jpg"] })))
=> []
```

## Zero records is a valid batch

A scan that hit a login wall reports that, with nothing to file.

```ts
const wall = validateBatch({ schemaJson: schema, manifest: { coverage: { scanned: 0, stoppedAt: "", reason: "login-wall" }, records: [] }, fileNames: [] });
JSON.stringify(wall.ok ? [wall.count, wall.coverage.reason] : wall.issues)
=> [0,"login-wall"]
```
