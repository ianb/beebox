# Document mode — Docling extraction, and what happens when it fails

`cb scan-import`'s document flow runs a text-layer PDF through Docling and
files a `document.card` in the session's attach scope: the rendered markdown as
the body, the gzipped `DoclingDocument` JSON, page renders and figures as AVIF.

The property that matters most is the failure one: **extraction failure never
blocks intake.** When Docling cannot run, the card is still written — with
`status: new`, an `error:` field, and the original PDF as its only asset, which
is exactly what this flow did before Docling existed.

Docling itself is faked here (the services pattern); the real binary is
exercised by `document-extract-integration.doctest.md`.

```ts setup
import { runDocumentMode } from "../../../src/core/commands/scan-import-document.js";
import { runDocumentReanalyze } from "../../../src/core/commands/document-reanalyze.js";
import { createFakeDocling, MAX_EXTRACTION_ARTIFACTS } from "../../../src/services/docling.js";
import { extractDocument } from "../../../src/core/commands/document-extract.js";
import { createCollectorContext } from "../../../src/core/commands/index.js";
import { createCardSchemaMap } from "../../../src/schemas/registry.js";
import { parseCardText } from "../../../src/core/card-io.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { textPdf } from "../../helpers/pdf-fixtures.js";
import { writeFile, readdir, readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const schemas = await createCardSchemaMap();

// Seed a box with a text-layer PDF sitting outside it, and run document mode.
async function importPdf(box, docling, source) {
  const pdfPath = join(box.packageRoot, "incoming.pdf");
  await writeFile(pdfPath, textPdf());
  const { ctx } = createCollectorContext(box.root);
  return runDocumentMode(ctx, { pdfPath, docling, source });
}

// The session attach dir of the one session this box has.
async function sessionDir(box) {
  const entries = await readdir(join(box.root, "box/inbox"));
  return entries.find((e) => e.endsWith(".attach"));
}

// Everything in the document card's attach scope, sorted.
async function attachContents(box) {
  const dir = await sessionDir(box);
  return (await readdir(join(box.root, "box/inbox", dir, "source.attach"))).sort().join("\n");
}

async function readDocumentCard(box) {
  const dir = await sessionDir(box);
  const rel = `box/inbox/${dir}/source.document.card`;
  return { rel, content: await box.read(rel) };
}
```

## A successful extraction lands an `analyzed` document card

```ts
const box = await makeTmpBox({ git: true });
const docling = createFakeDocling({
  markdown: "## Invoice 2026-04\n\n![Image](out/source_artifacts/image_000000_fake.png)\n",
  pageCount: 2,
  figureCount: 1,
});
const result = await importPdf(box, docling);
result.success
=> true

result.data.mode
=> document

result.data.status
=> analyzed
```

The fake was asked for a no-OCR extraction — `do_ocr=False` is the default, not
an option the caller has to remember:

```ts continue
docling.describe()
=>
docling fake (succeeds), 1 call(s)
  source.pdf force-ocr=false languages=-
```

The attach scope holds the original, the canonical JSON, one AVIF per page, and
one per figure. Every image is a real AVIF — the fake emits real PNG bytes and
`sharp` re-encodes them for real:

```ts continue
await attachContents(box)
=>
docling.json.gz
figure-001.avif
page-001.avif
page-002.avif
source.pdf

const dir = await sessionDir(box);
const avif = await readFile(join(box.root, "box/inbox", dir, "source.attach/page-001.avif"));
avif.subarray(4, 12).toString("latin1")
=> ftypavif

const json = gunzipSync(await readFile(join(box.root, "box/inbox", dir, "source.attach/docling.json.gz")));
JSON.parse(json.toString()).schema_name
=> DoclingDocument
```

The card itself validates against the `document` schema, carries provenance as
a superset of `file.card`, and has the rendered markdown as its body — with the
figure reference rewritten into the attach scope, not left pointing at Docling's
scratch directory:

```ts continue
const { rel, content } = await readDocumentCard(box);
const card = parseCardText(content, { source: rel, schemas });
JSON.stringify([card.fields.status, card.fields.format, card.fields.filename.ref, card.fields.filename["mime-type"]])
=> ["analyzed","pdf","attach/source.pdf","application/pdf"]

card.fields.docling.ref
=> attach/docling.json.gz

card.fields.error
=> undefined

card.rawBody.trim()
=>
## Invoice 2026-04
«blankline»
![Image](attach/figure-001.avif)
```

`metadata.pages` comes from the PDF itself (poppler), falling back to the
extraction's page count on a host without poppler — either way it is a number:

```ts continue
typeof card.fields.metadata.pages
=> number
```

The session card points at the document card, and the intake job exists:

```ts continue
const sessionCard = await box.read(result.data.sessionCardPath);
sessionCard.includes("- attach/source.document.card")
=> true

result.data.intakeJobPath.startsWith("box/jobs/")
=> true
```

```ts cleanup
await box.cleanup();
```

## Provenance from the caller lands on both cards

A scan that arrived through the upload route carries the credential that sent
it. The promote worker passes `scan-upload/<token-name>` down through
`cb upload --source`, and it ends up on the document card's `source` (replacing
the generic `scan-import`) and on the session card — so a batch that looks wrong
identifies the device that produced it.

```ts
const box = await makeTmpBox({ git: true });
const result = await importPdf(box, createFakeDocling({ markdown: "billed", pageCount: 1 }), "scan-upload/laptop-scansnap");
const { rel, content } = await readDocumentCard(box);
const card = parseCardText(content, { source: rel, schemas });
card.fields.filename.source
=> scan-upload/laptop-scansnap

const sessionCard = await box.read(result.data.sessionCardPath);
sessionCard.includes("source: scan-upload/laptop-scansnap")
=> true
```

Without it the document card keeps saying `scan-import` and the session card
carries no `source` at all — the field means "came from somewhere identifiable",
so an absent one is the honest answer:

```ts continue
const plain = await makeTmpBox({ git: true });
const plainResult = await importPdf(plain, createFakeDocling({ markdown: "billed", pageCount: 1 }));
const plainDoc = await readDocumentCard(plain);
JSON.stringify([
  parseCardText(plainDoc.content, { source: plainDoc.rel, schemas }).fields.filename.source,
  (await plain.read(plainResult.data.sessionCardPath)).includes("source:"),
])
=> ["scan-import",false]

await plain.cleanup();
```

```ts cleanup
await box.cleanup();
```

## An extraction failure still files the card — `status: new` plus `error:`

Nothing is lost: the original PDF is the card's only asset, the reason is on the
card rather than only in a log, and intake proceeds.

```ts
const box = await makeTmpBox({ git: true });
const docling = createFakeDocling({ failWith: "Docling exited 1: killed by the OOM killer" });
const result = await importPdf(box, docling);
result.success
=> true

result.data.status
=> new

await attachContents(box)
=> source.pdf

const { rel, content } = await readDocumentCard(box);
const card = parseCardText(content, { source: rel, schemas });
JSON.stringify([card.fields.status, card.fields.error])
=> ["new","Docling exited 1: killed by the OOM killer"]

card.fields.docling
=> undefined

JSON.stringify(card.rawBody.trim())
=> ""
```

Intake still completed — a Docling problem is not an intake problem:

```ts continue
result.data.intakeJobPath.startsWith("box/jobs/")
=> true
```

```ts cleanup
await box.cleanup();
```

## Empty markdown is `analyzed` with an empty body, not a failure

A document with no readable text is a real answer. The card says `analyzed`
(extraction worked) with nothing in the body, and the page renders are still
there to look at.

```ts
const box = await makeTmpBox({ git: true });
const result = await importPdf(box, createFakeDocling({ markdown: "", pageCount: 1 }));
result.data.status
=> analyzed

const { rel, content } = await readDocumentCard(box);
const card = parseCardText(content, { source: rel, schemas });
JSON.stringify([card.fields.status, card.rawBody.trim(), card.fields.error])
=> ["analyzed","",null]

await attachContents(box)
=>
docling.json.gz
page-001.avif
source.pdf
```

```ts cleanup
await box.cleanup();
```

## `cb document reanalyze` re-extracts and preserves authored fields

The card is re-extracted in place. `description` (and anything else an agent
wrote) survives; the body, `docling`, and the page assets are replaced.

```ts
const box = await makeTmpBox({ git: true });
await importPdf(box, createFakeDocling({ markdown: "first pass", pageCount: 3 }));
const dir = await sessionDir(box);
const cardRel = `box/inbox/${dir}/source.document.card`;

// Stand in for an agent's downstream processing pass.
await box.write(cardRel, (await box.read(cardRel)).replace("format: pdf", "format: pdf\ndescription: A utility bill"));

const docling = createFakeDocling({ markdown: "second pass", pageCount: 1 });
const { ctx } = createCollectorContext(box.root);
const result = await runDocumentReanalyze(ctx, {
  args: { card: cardRel, "force-ocr": true, languages: "en,de" },
  docling,
});
result.success
=> true
```

The flags reached the extractor:

```ts continue
docling.describe()
=>
docling fake (succeeds), 1 call(s)
  source.pdf force-ocr=true languages=en,de
```

The body and page count are the new run's; the description is the old card's:

```ts continue
const card = parseCardText(await box.read(cardRel), { source: cardRel, schemas });
JSON.stringify([card.fields.status, card.fields.description, card.rawBody.trim(), card.fields.metadata.pages])
=> ["analyzed","A utility bill","second pass",1]
```

Three pages became one, and the two stale page assets are gone rather than
sitting beside the new one:

```ts continue
await attachContents(box)
=>
docling.json.gz
page-001.avif
source.pdf
```

```ts cleanup
await box.cleanup();
```

## Reanalyze refuses clearly on a card it cannot work with

```ts
const box = await makeTmpBox({ git: true });
const { ctx } = createCollectorContext(box.root);
const missing = await runDocumentReanalyze(ctx, { args: { card: "box/inbox/Nope.document.card" } });
JSON.stringify([missing.success, missing.error])
=> [false,"Card not found: box/inbox/Nope.document.card"]

const wrongType = await runDocumentReanalyze(ctx, { args: { card: "box/inbox/Nope.memo.card" } });
wrongType.error
=> Not a document card: box/inbox/Nope.memo.card
```

The `card` argument is user-supplied, so it resolves through `shared/ref-path.ts`
like every other box path: a `..` that climbs out of the box, or an absolute
path naming somewhere else entirely, is a clean refusal rather than a file read
outside the box. Fail-closed — nothing is clamped back to the root.

```ts continue
const outside = ["../outside/Secret.document.card", "box/../../outside/Secret.document.card", "/etc/Secret.document.card", "/tmp/Secret.document.card"];
const escapes = await Promise.all(outside.map((card) => runDocumentReanalyze(ctx, { args: { card } })));
escapes.map((r) => `${String(r.success)} ${r.error}`).join("\n")
=>
false Card path is not inside the box: ../outside/Secret.document.card
false Card path is not inside the box: box/../../outside/Secret.document.card
false Card path is not inside the box: /etc/Secret.document.card
false Card path is not inside the box: /tmp/Secret.document.card
```

A `..` that stays inside the box is fine — it just normalizes, and the refusal
that follows is about the card, not the path:

```ts continue
const inside = await runDocumentReanalyze(ctx, { args: { card: "box/inbox/../inbox/Nope.document.card" } });
inside.error
=> Card not found: box/inbox/Nope.document.card
```

```ts cleanup
await box.cleanup();
```

## Extraction output is bounded before anything re-encodes it

Docling decides how many artifacts it writes; the caps (D16) sit between
extraction and the AVIF re-encode, so a pathological run is an extraction
failure rather than unbounded work. Over the cap behaves like every other
extraction failure — which is the property that matters: intake never blocks.

```ts
const scratch = await mkdtemp(join(tmpdir(), "cb-doc-bounds-"));
const workDir = join(scratch, "work");
const attachAbsDir = join(scratch, "attach");
await mkdir(workDir, { recursive: true });
await mkdir(attachAbsDir, { recursive: true });

const tooMany = await extractDocument({
  docling: createFakeDocling({ pageCount: MAX_EXTRACTION_ARTIFACTS + 1 }),
  sourcePath: join(scratch, "source.pdf"),
  attachAbsDir,
  workDir,
  forceOcr: false,
  languages: null,
});
JSON.stringify([tooMany.ok, tooMany.error])
=> [false,"Docling produced 501 page/figure artifacts, over the limit of 500"]
```

Nothing was written into the attach scope — the refusal happens before the
re-encode, not halfway through it:

```ts continue
(await readdir(attachAbsDir)).length
=> 0
```

Right at the cap is still a normal extraction:

```ts continue
const atCap = await extractDocument({
  docling: createFakeDocling({ pageCount: 3, figureCount: 2 }),
  sourcePath: join(scratch, "source.pdf"),
  attachAbsDir,
  workDir,
  forceOcr: false,
  languages: null,
});
JSON.stringify([atCap.ok, atCap.value.assetNames.length])
=> [true,6]
```

```ts cleanup
await rm(scratch, { recursive: true, force: true });
```
