# Triage evidence

Preparation reads admitted files, records their exact bytes and explicitly reports
missing preparation. It neither changes sources nor writes extracted box assets.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prepareItem, verifyEvidence } from "../../../src/core/triage/evidence/core.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { serializeTriageRequest } from "../../../src/core/triage/request.js";
import { JEV_MAX_REQUEST_CHARS } from "../../../src/services/jev-wire.js";
import { createFakeDocling } from "../../../src/services/docling/core.js";
import { createFakeScanVision } from "../../../src/services/scan-vision.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
const fixture = path.resolve("test/fixtures/triage-evaluation/documents/raw");
```

Complete scope enumeration includes unsupported bytes. HTML preserves block and
link structure, but does not fetch links. A later attachment invalidates evidence.

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/staged/House.doc.card", "---\ntitle: Household\n---\nRead attachments.");
await box.write("_content/inbox/staged/House.attach/notice.html", '<h1>Notice</h1><p>Boundary hearing</p><a href="https://example.invalid/case">Case details</a><script>not evidence</script>');
await box.write("_content/inbox/staged/House.attach/data.bin", "opaque bytes");
const prepared = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/House.doc.card" });
JSON.stringify(prepared.parts.map((part) => [path.basename(part.ref), part.status]))
=> [["House.doc.card","ready"],["data.bin","unavailable"],["notice.html","partial"]]

prepared.status
=> partial

prepared.parts[2].text
=> Notice
Boundary hearing
Case details (https://example.invalid/case)

await verifyEvidence(box.root, prepared);
await box.write("_content/inbox/staged/House.attach/new.txt", "New evidence");
await verifyEvidence(box.root, prepared)
=> throws InvariantError: stale-decision: attachment scope changed; prepare again

await box.write("_content/inbox/staged/House.doc.card", "Changed content");
await verifyEvidence(box.root, prepared)
=> throws InvariantError: stale-decision: changed evidence /_content/inbox/staged/House.doc.card; prepare again
```

```ts cleanup
await box.cleanup();
```

An analyzed PDF card owns its generated direct page renders. When its body is
retained, all twelve page digests (old AVIF and new WebP) remain in evidence while vision reads the
figure and the serialized request stays under the wire cap.

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/staged/Rendered.doc.card", "Capture session");
await box.write("_content/inbox/staged/Rendered.attach/source.pdf.card", "---\nstatus: analyzed\nfilename:\n  ref: attach/source.pdf\n---\n" + "S".repeat(48_000));
const innerAttach = path.join(box.root, "_content/inbox/staged/Rendered.attach/source.attach");
await fs.mkdir(innerAttach, { recursive: true });
await fs.copyFile(path.join(fixture, "digital-property.pdf"), path.join(innerAttach, "source.pdf"));
const pageNames = Array.from({ length: 12 }, (_, index) => `page-${String(index + 1).padStart(3, "0")}.${index < 6 ? "avif" : "webp"}`);
for (const name of pageNames) await fs.writeFile(path.join(innerAttach, name), `page bytes ${name}`);
await fs.writeFile(path.join(innerAttach, "figure-001.avif"), "figure bytes");
const pageVision = createFakeScanVision();
const pageInstructions = await compileInstructionSnapshot(box.root);
const pageEvidence = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Rendered.doc.card", vision: pageVision, instructions: pageInstructions });
const pageParts = pageEvidence.parts.filter((part) => /\/page-\d{3,}\.(?:avif|webp)$/u.test(part.ref));
const figurePart = pageEvidence.parts.find((part) => part.ref.endsWith("/figure-001.avif"));
const submittedImages = pageVision.calls.flatMap((call) => call.imagePaths.map((file) => path.basename(file))).toSorted();
JSON.stringify([pageEvidence.status, pageParts.length, pageParts.every((part) => part.method === "representation-selected" && part.duplicateOf === "/_content/inbox/staged/Rendered.attach/source.pdf.card"), figurePart?.method, submittedImages, serializeTriageRequest({ evidence: pageEvidence, instructions: pageInstructions }).length <= JEV_MAX_REQUEST_CHARS])
=> ["ready",12,true,"scan-vision",["figure-001.avif"],true]

JSON.stringify([...new Set(pageParts.map((part) => part.mediaType))].sort())
=> ["image/avif","image/webp"]

await fs.writeFile(path.join(innerAttach, "page-012.webp"), "changed page bytes");
let stalePage = "";
await (async () => { try { await verifyEvidence(box.root, pageEvidence); } catch (error) { stalePage = String(error); } })();
stalePage.includes("stale-decision: changed evidence /_content/inbox/staged/Rendered.attach/source.attach/page-012.webp; prepare again")
=> true
```

```ts cleanup
await box.cleanup();
```

Missing usable structured text or a body excluded by the text budget sends its
page render through vision. Unrelated page renders and figures always do so.

```ts
const box = await makeTmpBox();
const attach = path.join(box.root, "_content/inbox/staged");
await box.write("_content/inbox/staged/Empty.pdf.card", "---\nstatus: analyzed\nfilename:\n  ref: attach/source.pdf\n---\n");
await fs.mkdir(path.join(attach, "Empty.attach"), { recursive: true });
await fs.copyFile(path.join(fixture, "digital-property.pdf"), path.join(attach, "Empty.attach/source.pdf"));
await fs.writeFile(path.join(attach, "Empty.attach/page-001.avif"), "empty-owner page");
const emptyVision = createFakeScanVision();
const emptyOwner = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Empty.pdf.card", vision: emptyVision });
JSON.stringify([emptyOwner.parts.find((part) => part.ref.endsWith("Empty.attach/page-001.avif"))?.method, emptyVision.calls.length, path.basename(emptyVision.calls[0]?.imagePaths[0] ?? "")])
=> ["scan-vision",1,"page-001.avif"]

await box.write("_content/inbox/staged/Oversized.pdf.card", "---\nstatus: analyzed\nfilename:\n  ref: attach/source.pdf\n---\n" + "O".repeat(1_000));
await fs.mkdir(path.join(attach, "Oversized.attach"), { recursive: true });
await fs.copyFile(path.join(fixture, "digital-property.pdf"), path.join(attach, "Oversized.attach/source.pdf"));
await fs.writeFile(path.join(attach, "Oversized.attach/page-001.webp"), "excluded-owner page");
const oversizedVision = createFakeScanVision();
const oversizedOwner = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Oversized.pdf.card", maxTextChars: 100, vision: oversizedVision });
JSON.stringify([oversizedOwner.parts.find((part) => part.ref.endsWith("Oversized.pdf.card"))?.status, oversizedOwner.parts.find((part) => part.ref.endsWith("Oversized.attach/page-001.webp"))?.method, oversizedVision.calls.length])
=> ["unavailable","scan-vision",1]

await box.write("_content/inbox/staged/Unrelated.doc.card", "Ordinary document");
await box.write("_content/inbox/staged/Unrelated.attach/page-001.avif", "unowned page");
await box.write("_content/inbox/staged/Unrelated.attach/page-002.webp", "unowned WebP page");
await box.write("_content/inbox/staged/Unrelated.attach/figure-001.avif", "unowned figure");
const unrelatedVision = createFakeScanVision();
const unrelated = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Unrelated.doc.card", vision: unrelatedVision });
JSON.stringify(unrelatedVision.calls.flatMap((call) => call.imagePaths.map((file) => path.basename(file))).toSorted())
=> ["figure-001.avif","page-001.avif","page-002.webp"]
```

```ts cleanup
await box.cleanup();
```

Native text is read directly; junk and absent layers go through different OCR
modes. All extraction workspaces are deleted on success and failure.

```ts
const box = await makeTmpBox();
await fs.copyFile(path.join(fixture, "digital-property.pdf"), path.join(box.root, "_content/inbox/staged/native.pdf"));
const native = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/native.pdf" });
native.parts[0].method
=> pdf-native-text

native.parts[0].text.includes("property")
=> true

const fake = createFakeDocling({ markdown: "Recovered household statement" });
const workspaces: string[] = [];
const docling = { extract: async (source, opts) => { workspaces.push(opts.workDir); return fake.extract(source, opts); } };
await fs.copyFile(path.join(fixture, "junk-layer-legal.pdf"), path.join(box.root, "_content/inbox/staged/junk.pdf"));
await fs.copyFile(path.join(fixture, "scan-financial.pdf"), path.join(box.root, "_content/inbox/staged/scan.pdf"));
const junk = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/junk.pdf", docling });
const scanned = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/scan.pdf", docling });
JSON.stringify(fake.calls.map((call) => call.ocr))
=> ["replace","regions"]

JSON.stringify([junk.status, scanned.status])
=> ["ready","ready"]

JSON.stringify(await Promise.all(workspaces.map(async (dir) => fs.access(dir).then(() => true, () => false))))
=> [false,false]

const reused = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/junk.pdf", docling, previousEvidence: junk });
fake.calls.length
=> 2

reused.parts[0].text
=> Recovered household statement

const failing = createFakeDocling({ failWith: "OCR unavailable" });
const failureDirs: string[] = [];
const failure = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/scan.pdf", docling: { extract: async (source, opts) => { failureDirs.push(opts.workDir); return failing.extract(source, opts); } } });
failure.status
=> unavailable

failure.parts[0].omissions.includes("OCR unavailable")
=> true

JSON.stringify(await Promise.all(failureDirs.map(async (dir) => fs.access(dir).then(() => true, () => false))))
=> [false]
```

```ts cleanup
await box.cleanup();
```

Image analysis supplies objects and text, using the existing injectable service.
A whole part beyond budget is explicitly excluded, never silently clipped.

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/staged/photo.png", "fake image bytes");
const vision = createFakeScanVision();
const image = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/photo.png", vision });
JSON.stringify([image.status, image.parts[0].method, image.parts[0].text, vision.calls.length])
=> ["ready","scan-vision","Fake photo 0",1]

const blankVision = createFakeScanVision({ analyze: () => [{ index: 0, paired_with_index: null, description: "", title: "", rotation: 0, subject_bbox: null, has_text: false, text_blocks: [], date_hint: null, flag_for_review: false, flag_reason: null }] });
const emptyImage = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/photo.png", vision: blankVision });
JSON.stringify([emptyImage.status, emptyImage.parts[0].omissions.includes("Vision returned no semantic description or text")])
=> ["unavailable",true]

await box.write("_content/inbox/staged/mail.eml", "From: =?UTF-8?Q?Jos=C3=A9?= <jose@example.invalid>\r\nContent-Type: multipart/alternative; boundary=abc\r\n\r\n--abc\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHello=2C household notice\r\n--abc\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello household notice</p>\r\n--abc\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=\"bill.pdf\"\r\n\r\nnot decoded\r\n--abc--\r\n");
const mail = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/mail.eml" });
JSON.stringify([mail.parts[0].method, mail.parts[0].text, mail.status, mail.parts[0].omissions.some((item) => item.includes("Raw MIME is not decoded"))])
=> ["mime-unparsed","","unavailable",true]

await box.write("_content/inbox/staged/long.txt", "Early irrelevant information. Later important qualification.");
const bounded = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/long.txt", maxTextChars: 10 });
JSON.stringify([bounded.status, bounded.parts[0].text, bounded.parts[0].omissions[0].startsWith("Text budget excluded all")])
=> ["unavailable","",true]

// Capture-session scan scope: admit the structured PDF card before its raw
// derivatives, retain every digest; non-generated page images stay visual evidence.
await box.write("_content/inbox/staged/capture-session.card", "Capture bundle");
await box.write("_content/inbox/staged/capture-session.attach/source.pdf.card", "---\ntitle: Source\nstatus: analyzed\nfilename:\n  ref: attach/source.pdf\ndocling:\n  ref: attach/docling.json.gz\n---\n" + "S".repeat(48_000));
const sourcePdfPath = path.join(box.root, "_content/inbox/staged/capture-session.attach/source.attach/source.pdf");
await fs.mkdir(path.dirname(sourcePdfPath), { recursive: true });
await fs.copyFile(path.join(fixture, "scan-financial.pdf"), sourcePdfPath);
await box.write("_content/inbox/staged/capture-session.attach/source.attach/text-layer.txt", "T".repeat(42_000));
await box.write("_content/inbox/staged/capture-session.attach/source.attach/docling.json.gz", "internal sidecar bytes");
await box.write("_content/inbox/staged/capture-session.attach/source.attach/page-001.png", "page image bytes");
const docling = createFakeDocling({ markdown: "Should not re-extract analyzed card" });
const structuredInstructions = await compileInstructionSnapshot(box.root);
const structured = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/capture-session.card", vision: createFakeScanVision(), docling, instructions: structuredInstructions });
JSON.stringify(structured.parts.map((part) => [path.basename(part.ref), part.method]))
=> [["capture-session.card","utf8"],["source.pdf.card","utf8"],["text-layer.txt","representation-selected"],["docling.json.gz","provenance-only"],["page-001.png","scan-vision"],["source.pdf","representation-selected"]]

JSON.stringify([structured.status, structured.parts.find((part) => part.ref.endsWith("source.pdf.card"))?.text.length > 48_000, structured.parts.filter((part) => part.method === "representation-selected").map((part) => part.duplicateOf)])
=> ["ready",true,["/_content/inbox/staged/capture-session.attach/source.pdf.card","/_content/inbox/staged/capture-session.attach/source.pdf.card"]]

const serializedTriageRequest = serializeTriageRequest({ evidence: structured, instructions: structuredInstructions });
JSON.stringify([serializedTriageRequest.length <= JEV_MAX_REQUEST_CHARS, serializedTriageRequest.length, structured.recipe.steps.length === structured.parts.length && structured.recipe.steps.every((step, index) => step === `${structured.parts[index]?.ref}: ${structured.parts[index]?.method}`)])
=> [true,«int»,true]

const recognizedSidecar = structured.parts.find((part) => part.ref.endsWith("docling.json.gz"));
JSON.stringify([structured.status, recognizedSidecar?.method, recognizedSidecar?.status, recognizedSidecar?.text, recognizedSidecar?.omissions.length])
=> ["ready","provenance-only","ready","",0]

docling.calls.length
=> 0

// An unreferenced gzip is unsupported evidence, so its omission stays visible.
await box.write("_content/inbox/staged/Unknown.doc.card", "Readable source");
await box.write("_content/inbox/staged/Unknown.attach/stray.json.gz", "unreferenced sidecar bytes");
const unknownGzip = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Unknown.doc.card", instructions: structuredInstructions });
const stray = unknownGzip.parts.find((part) => part.ref.endsWith("stray.json.gz"));
JSON.stringify([unknownGzip.status, stray?.method, stray?.status, stray?.omissions.includes("Unsupported media: .gz")])
=> ["partial","unsupported","unavailable",true]

// Distinct cards preserve distinct frontmatter even when their bodies match.
await box.write("_content/inbox/staged/CardPair.doc.card", "Pair");
await box.write("_content/inbox/staged/CardPair.attach/a.doc.card", "---\ntitle: First\n---\nSame useful body");
await box.write("_content/inbox/staged/CardPair.attach/b.doc.card", "---\ntitle: Second\n---\nSame useful body");
const cardPair = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/CardPair.doc.card", instructions: structuredInstructions });
JSON.stringify(cardPair.parts.filter((part) => part.ref.endsWith(".doc.card")).map((part) => [part.method, part.duplicateOf ?? null, part.text.includes("Same useful body")]))
=> [["utf8",null,false],["utf8",null,true],["utf8",null,true]]

// Identical plain text keeps each digest while only the first part carries text.
await box.write("_content/inbox/staged/TextPair.doc.card", "Pair");
await box.write("_content/inbox/staged/TextPair.attach/a.txt", "One retained passage");
await box.write("_content/inbox/staged/TextPair.attach/b.txt", "One retained passage");
const textPair = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/TextPair.doc.card", instructions: structuredInstructions });
const textCopies = textPair.parts.filter((part) => part.ref.endsWith(".txt"));
JSON.stringify([textCopies.map((part) => [part.digest.length, part.method, part.duplicateOf ?? null, part.text]), textCopies[0]?.digest === textCopies[1]?.digest, textCopies[1]?.duplicateOf === textCopies[0]?.ref])
=> [[[64,"utf8",null,"One retained passage"],[64,"duplicate-text","/_content/inbox/staged/TextPair.attach/a.txt",""]],true,true]

// Empty analyzed body is not authoritative: use the 42k text-layer.
await box.write("_content/inbox/staged/Empty.pdf.card", "---\nstatus: analyzed\nfilename:\n  ref: attach/source.pdf\n---\n");
await fs.mkdir(path.join(box.root, "_content/inbox/staged/Empty.attach"), { recursive: true });
await fs.copyFile(path.join(fixture, "digital-property.pdf"), path.join(box.root, "_content/inbox/staged/Empty.attach/source.pdf"));
await box.write("_content/inbox/staged/Empty.attach/text-layer.txt", "L".repeat(42_000));
const emptyPdf = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Empty.pdf.card", maxTextChars: 43_000, docling: createFakeDocling({ markdown: "Should not replace available text layer" }), instructions: structuredInstructions });
JSON.stringify([emptyPdf.status, emptyPdf.parts.find((part) => part.ref.endsWith("Empty.attach/text-layer.txt"))?.text.length, emptyPdf.parts.find((part) => part.ref.endsWith("Empty.attach/source.pdf"))?.duplicateOf, emptyPdf.parts.find((part) => part.ref.endsWith("Empty.pdf.card"))?.text.includes("status: analyzed")])
=> ["ready",42000,"/_content/inbox/staged/Empty.attach/text-layer.txt",true]

const fallback = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/capture-session.card", maxTextChars: 43_000, vision: createFakeScanVision(), docling });
JSON.stringify([fallback.status, fallback.parts.find((part) => part.ref.endsWith("source.pdf.card"))?.status, fallback.parts.find((part) => part.ref.endsWith("text-layer.txt"))?.text.length, fallback.parts.find((part) => part.ref.endsWith("/source.pdf"))?.duplicateOf])
=> ["partial","unavailable",42000,"/_content/inbox/staged/capture-session.attach/source.attach/text-layer.txt"]

docling.calls.length
=> 0

// If neither existing representation fits, the deferred PDF is extracted once.
await fs.rm(path.join(box.root, "_content/inbox/staged/capture-session.attach/source.attach/text-layer.txt"));
const extractedFallback = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/capture-session.card", maxTextChars: 43_000, vision: createFakeScanVision(), docling });
JSON.stringify([docling.calls.length, extractedFallback.parts.find((part) => part.ref.endsWith("/source.pdf"))?.method, extractedFallback.parts.find((part) => part.ref.endsWith("/source.pdf"))?.text])
=> [1,"docling-regions","Should not re-extract analyzed card"]

await box.write("_content/inbox/staged/budget.txt", "Readable content");
const escapedInstructions = { version: 1, compilerVersion: 1, policy: '"'.repeat(40_000), trial: true, sources: [], destinations: [] };
let requestBudgetError = "";
await (async () => { try { await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/budget.txt", instructions: escapedInstructions }); } catch (error) { requestBudgetError = String(error); } })();
requestBudgetError.includes("Serialized Jev request exceeds request budget")
=> true

await box.write("_content/inbox/staged/Missing.pdf.card", "---\nfile: attach/missing.pdf\n---\nDocument title only");
const missing = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Missing.pdf.card" });
missing.status
=> partial

missing.parts[0].omissions.includes("Missing referenced attachment: attach/missing.pdf")
=> true

await box.write("_content/inbox/staged/Lost.doc.card", "Body");
await box.write("_content/inbox/intake/Lost.attach/source.txt", "Stranded");
let stranded = "";
try { await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Lost.doc.card" }); } catch (error) { stranded = String(error); };
stranded.includes("Stranded attachment scope")
=> true

await box.write("_content/inbox/staged/Shared.doc.card", "Shared");
await fs.mkdir(path.join(box.root, "_content/inbox/staged/Shared.attach"), { recursive: true });
await fs.symlink("/etc/hosts", path.join(box.root, "_content/inbox/staged/Shared.attach/external.txt"));
let escapedBox = "";
try { await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Shared.doc.card" }); } catch (error) { escapedBox = String(error); };
escapedBox.includes("Evidence escapes box")
=> true

await fs.rm(path.join(box.root, "_content/inbox/staged/Shared.attach/external.txt"));
await fs.mkdir(path.join(box.root, ".git/annex/objects/test-key"), { recursive: true });
await fs.writeFile(path.join(box.root, ".git/annex/objects/test-key/content.txt"), "Annexed evidence text");
await fs.symlink(path.join(box.root, ".git/annex/objects/test-key/content.txt"), path.join(box.root, "_content/inbox/staged/Shared.attach/annexed.txt"));
const annexed = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Shared.doc.card" });
annexed.parts[1]?.text
=> Annexed evidence text

await prepareItem({ boxRoot: box.root, sourceRef: "/../../etc/passwd" })
=> throws InvariantError: Invalid evidence ref: /../../etc/passwd
```

```ts cleanup
await box.cleanup();
```
