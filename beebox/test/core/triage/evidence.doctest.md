# Triage evidence

Preparation reads admitted files, records their exact bytes and explicitly reports
missing preparation. It neither changes sources nor writes extracted box assets.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prepareItem, verifyEvidence } from "../../../src/core/triage/evidence.js";
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
