// # Exact-duplicate inbox items
//
// An item is a duplicate when every original file's SHA-256 matches a filed
// tracked file (annex key or plain bytes) or an earlier item in the same check.
// Derivatives, cards and tiny files never count. Only bare files and unedited
// scan-upload sessions are removable; the rest is for review and never moves.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { simpleGit } from "simple-git";
import { applyDuplicateRemovals, findExactDuplicates } from "../../../src/core/triage/duplicates.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

type TmpBox = Awaited<ReturnType<typeof makeTmpBox>>;
const staged = "_content/inbox/staged";
const bytes = (seed: string): Buffer => Buffer.from(`%PDF-1.4 ${seed}\n${seed.repeat(2048 / seed.length)}`);
const sha = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

async function scanSession(box: TmpBox, options: { name: string; source: Buffer; uploader?: string; derivative: string }): Promise<void> {
  const uploader = options.uploader === undefined ? "" : `uploader: ${options.uploader}\n`;
  await box.write(`${staged}/${options.name}.capture-session.card`, `---\nsession-id: ${options.name}\nfiles:\n  - source.pdf.card\n${uploader}---\n`);
  await box.write(`${staged}/${options.name}.attach/source.pdf.card`, "---\nstatus: analyzed\nfilename:\n  ref: attach/source.pdf\n---\nScanned text.");
  await box.write(`${staged}/${options.name}.attach/source.attach/source.pdf`, options.source);
  await box.write(`${staged}/${options.name}.attach/source.attach/page-001.webp`, bytes(options.derivative));
  await box.write(`${staged}/${options.name}.attach/source.attach/text-layer.txt`, options.derivative.repeat(1100));
}

async function fixture(): Promise<TmpBox> {
  const box = await makeTmpBox();
  const git = simpleGit(box.root);
  const annexed = bytes("annexed");
  await box.write("_content/archive/Filed.pdf", `/annex/objects/SHA256E-s${String(annexed.length)}--${sha(annexed)}.pdf\n`);
  await box.write("_content/archive/Plain.pdf", bytes("plain"));
  await box.write("_content/archive/tiny.txt", "hello");
  await git.add(".");
  await git.commit("File originals");

  await box.write(`${staged}/A-copy.pdf`, annexed);
  await box.write(`${staged}/B-copy.pdf`, bytes("plain"));
  await box.write(`${staged}/C1.pdf`, bytes("twice"));
  await box.write(`${staged}/C2.pdf`, bytes("twice"));
  await box.write(`${staged}/Tiny.txt`, "hello");
  await box.write(`${staged}/Note.doc.card`, "---\ntitle: Note\n---\nNo attachments.");
  await box.write(`${staged}/Doc.doc.card`, "---\ntitle: Letter\n---\nThe boxholder's notes.");
  await box.write(`${staged}/Doc.attach/letter.pdf`, bytes("plain"));
  await box.write(`${staged}/Chat.capture-session.card`, "---\nsession-id: chat\nimages:\n  - photo.image.card\n---\nSpoken notes.");
  await box.write(`${staged}/Chat.attach/photo.image.card`, "---\nfilename:\n  ref: attach/photo.jpg\n---\n");
  await box.write(`${staged}/Chat.attach/photo.attach/photo.jpg`, annexed);
  await scanSession(box, { name: "Scan1", source: bytes("scanned"), uploader: "scan-upload/laptop", derivative: "one" });
  await scanSession(box, { name: "Scan2", source: bytes("scanned"), uploader: "scan-upload/laptop", derivative: "two" });
  await scanSession(box, { name: "Rescan", source: bytes("scanned-again"), uploader: "scan-upload/laptop", derivative: "three" });
  await scanSession(box, { name: "Edited", source: annexed, uploader: "scan-upload/laptop", derivative: "four" });
  await git.add(".");
  await git.commit("Promote staged items");
  await box.write(`${staged}/Edited.capture-session.card`, "---\nsession-id: Edited\nfiles:\n  - source.pdf.card\nuploader: scan-upload/laptop\n---\nA note added later.");
  await git.add(".");
  await git.commit("Edit a scan session");
  return box;
}

async function stagedRefs(box: TmpBox): Promise<string[]> {
  return (await fs.readdir(box.path(staged), { withFileTypes: true })).filter((entry) => entry.isFile() && !entry.name.startsWith(".")).map((entry) => `/${staged}/${entry.name}`);
}

void test("Every exact duplicate is found once, with its disposition and copy.", async (t) => {
  const box = await fixture();
  t.teardown(() => box.cleanup());
  const findings = await findExactDuplicates(box.root, await stagedRefs(box));
  t.check(findings.map((finding) => [finding.sourceRef.slice(staged.length + 2), finding.disposition, finding.originals.map((original) => [original.ref, original.copyOf])]), [
    ["A-copy.pdf", "removable", [["/_content/inbox/staged/A-copy.pdf", "/_content/archive/Filed.pdf"]]],
    ["B-copy.pdf", "removable", [["/_content/inbox/staged/B-copy.pdf", "/_content/archive/Plain.pdf"]]],
    ["C2.pdf", "removable", [["/_content/inbox/staged/C2.pdf", "/_content/inbox/staged/C1.pdf"]]],
    ["Chat.capture-session.card", "review", [["/_content/inbox/staged/Chat.attach/photo.attach/photo.jpg", "/_content/archive/Filed.pdf"]]],
    ["Doc.doc.card", "review", [["/_content/inbox/staged/Doc.attach/letter.pdf", "/_content/archive/Plain.pdf"]]],
    ["Edited.capture-session.card", "review", [["/_content/inbox/staged/Edited.attach/source.attach/source.pdf", "/_content/archive/Filed.pdf"]]],
    ["Scan2.capture-session.card", "removable", [["/_content/inbox/staged/Scan2.attach/source.attach/source.pdf", "/_content/inbox/staged/Scan1.attach/source.attach/source.pdf"]]],
  ]);

  // The annex key's digest is the copy's own SHA-256.
  t.check(findings[0]?.originals[0]?.sha256, sha(bytes("annexed")));
});

// An uncommitted edit to a scan session also makes it a review item.
void test("An uncommitted edit makes a scan session a review item.", async (t) => {
  const box = await fixture();
  t.teardown(() => box.cleanup());
  await box.write(`${staged}/Scan2.attach/source.pdf.card`, "---\nstatus: analyzed\nfilename:\n  ref: attach/source.pdf\n---\nCorrected text.");
  t.check((await findExactDuplicates(box.root, [`/${staged}/Scan1.capture-session.card`, `/${staged}/Scan2.capture-session.card`])).map((finding) => finding.disposition), ["review"]);
});

void test("Apply trashes only removable items, each with a Triage-Duplicate-Of commit.", async (t) => {
  const box = await fixture();
  t.teardown(() => box.cleanup());
  const findings = await findExactDuplicates(box.root, await stagedRefs(box));
  const removals = await applyDuplicateRemovals(box.root, { findings });
  t.check(removals.map((removal) => [removal.sourceRef, removal.trashRefs]), [
    ["/_content/inbox/staged/A-copy.pdf", ["/_bookkeeping/trash/A-copy.pdf"]],
    ["/_content/inbox/staged/B-copy.pdf", ["/_bookkeeping/trash/B-copy.pdf"]],
    ["/_content/inbox/staged/C2.pdf", ["/_bookkeeping/trash/C2.pdf"]],
    ["/_content/inbox/staged/Scan2.capture-session.card", ["/_bookkeeping/trash/Scan2.capture-session.card"]],
  ]);
  t.check((await fs.readdir(box.path("_bookkeeping/trash"))).toSorted(), [".gitkeep", "A-copy.pdf", "B-copy.pdf", "C2.pdf", "Scan2.attach", "Scan2.capture-session.card"]);
  t.check((await fs.readdir(box.path(staged))).toSorted(), [
    ".gitkeep", "C1.pdf", "Chat.attach", "Chat.capture-session.card", "Doc.attach", "Doc.doc.card", "Edited.attach", "Edited.capture-session.card",
    "Note.doc.card", "Rescan.attach", "Rescan.capture-session.card", "Scan1.attach", "Scan1.capture-session.card", "Tiny.txt",
  ]);
  const log = await simpleGit(box.root).raw(["log", "-4", "--format=%s%n%(trailers:key=Triage-Duplicate-Of,valueonly)"]);
  t.check(log.split("\n").filter(Boolean), [
    "Trash card: Scan2.capture-session.card: exact duplicate of /_content/inbox/staged/Scan1.attach/source.attach/source.pdf",
    "/_content/inbox/staged/Scan1.attach/source.attach/source.pdf",
    "Trash file: C2.pdf: exact duplicate of /_content/inbox/staged/C1.pdf",
    "/_content/inbox/staged/C1.pdf",
    "Trash file: B-copy.pdf: exact duplicate of /_content/archive/Plain.pdf",
    "/_content/archive/Plain.pdf",
    "Trash file: A-copy.pdf: exact duplicate of /_content/archive/Filed.pdf",
    "/_content/archive/Filed.pdf",
  ]);
  t.check((await simpleGit(box.root).status()).files, []);
});

// Apply re-verifies bytes; a finding stale since the check moves nothing.
void test("Apply refuses a finding whose bytes changed since the check.", async (t) => {
  const box = await fixture();
  t.teardown(() => box.cleanup());
  const findings = await findExactDuplicates(box.root, [`/${staged}/A-copy.pdf`, `/${staged}/B-copy.pdf`]);
  await box.write(`${staged}/B-copy.pdf`, bytes("changed"));
  await t.checkThrows(() => applyDuplicateRemovals(box.root, { findings }), "StaleDuplicateFindingError: Stale duplicate finding: /_content/inbox/staged/B-copy.pdf changed; check again");
  t.check((await fs.readdir(box.path(staged))).filter((name) => name.endsWith("-copy.pdf")), ["A-copy.pdf", "B-copy.pdf"]);
});
