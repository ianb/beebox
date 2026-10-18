// # Upload Helpers
//
// Helpers for the `upload` command: content-hash dedup ledger and streaming
// SHA-256.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import {
  emptyLedger,
  findEntry,
  addEntry,
  loadLedger,
  saveLedger,
  updateLedger,
  sha256File,
  groupScanFiles,
  LEDGER_REL_PATH,
  type UploadLedgerEntry,
} from "../../src/core/upload-helpers.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { toError } from "../../src/shared/error-guards.js";

function entry(hash: string, opts?: Partial<UploadLedgerEntry>): UploadLedgerEntry {
  return {
    hash,
    originalName: `${hash.slice(0, 6)}.pdf`,
    originalPath: `/tmp/${hash.slice(0, 6)}.pdf`,
    uploadedAt: "2026-04-29T03:20:00.000Z",
    kind: "scan",
    ...opts,
  };
}

async function caught<T>(fn: () => Promise<T>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return toError(e);
  }
}

// ## addEntry and findEntry
void test("addEntry and findEntry", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L45
  const l = emptyLedger();
  addEntry(l, entry("aaa"));
  addEntry(l, entry("bbb", { sessionRelDir: "_content/inbox/scan-x" }));
  print(`count=${l.entries.length}`);
  print(`found bbb session: ${findEntry(l, "bbb")!.sessionRelDir}`);
  await t.checkText(out.with(print(`found ccc: ${findEntry(l, "ccc") === undefined}`)), `count=2
found bbb session: _content/inbox/scan-x
found ccc: true`);
});

// ## loadLedger returns empty when the file is absent
void test("loadLedger returns empty when the file is absent", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L60
  const box = await makeTmpBox();
  const l = await loadLedger(box.root);
  t.check(l, {
    version: 1,
    entries: [],
  });
});

// ## Roundtrip save then load
void test("Roundtrip save then load", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L73
  const box2 = await makeTmpBox();
  const l2 = emptyLedger();
  addEntry(l2, entry("deadbeef", { kind: "scan", sessionRelDir: "_content/inbox/scan-y" }));
  await saveLedger(box2.root, l2);
  const reloaded = await loadLedger(box2.root);
  print(`entries=${reloaded.entries.length}`);
  print(`hash=${reloaded.entries[0]?.hash}`);
  await t.checkText(out.with(print(`session=${reloaded.entries[0]?.sessionRelDir}`)), `entries=1
hash=deadbeef
session=_content/inbox/scan-y`);
});

// ## Bad ledger format is rejected loudly
//
// If somebody hand-edits the file into something other than the expected shape,
// we'd rather error than silently treat the box as never having uploaded
// anything (which would re-import everything).
void test("If somebody hand-edits the file into something other than the expected shape,...", async (t) => {
  t.teardown(async () => {
    try {
      await box3.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L98
  const box3 = await makeTmpBox();
  await box3.write(LEDGER_REL_PATH, JSON.stringify({ version: 999, entries: [] }));
  const err = await caught(() => loadLedger(box3.root));
  await t.checkText(err !== null && err.message.includes("not in the expected format"), "true");
});

// ## sha256File computes a known digest
//
// The SHA-256 of the three-byte string `abc` is documented in FIPS 180-4.
void test("The SHA-256 of the three-byte string abc is documented in FIPS 180-4.", async (t) => {
  t.teardown(async () => {
    try {
      await box4.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L114
  const box4 = await makeTmpBox();
  await box4.write("sample.txt", "abc");
  t.check(await sha256File(box4.path("sample.txt")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

// ## groupScanFiles: scanner-prefix grouping
//
// JPEGs from a flatbed scanner come out as `<prefix>_NNN.jpg`. We group by
// prefix so a single upload invocation produces one session per scanner run.
void test("JPEGs from a flatbed scanner come out as <prefix>NNN.jpg.", async (t) => {
  // doctest:L130
  const groups = groupScanFiles([
    "/in/Scan2026-04-29_153807_000.jpg",
    "/in/Scan2026-04-29_153807_001.jpg",
    "/in/Scan2026-04-29_153807_002.webp",
    "/in/Scan2026-04-29_153807_003.avif",
    "/in/Scan2026-04-29_154704_000.jpg",
    "/in/Scan2026-04-29_154704_001.jpg",
    "/in/Scan2026-04-29_154704_002.jpg",
  ]);
  t.check(groups.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | "), "image-batch:Scan2026-04-29_153807=4 | image-batch:Scan2026-04-29_154704=3");
});

// ## groupScanFiles: each PDF is its own group
void test("groupScanFiles: each PDF is its own group", async (t) => {
  // doctest:L146
  const groups2 = groupScanFiles([
    "/in/letter.pdf",
    "/in/will.pdf",
    "/in/photos_000.jpg",
    "/in/photos_001.jpg",
  ]);
  t.check(groups2.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | "), "pdf:letter=1 | pdf:will=1 | image-batch:photos=2");
});

// ## groupScanFiles: unmatched images bundle together
//
// Image filenames without a `_NNN.ext` tail (no underscore-digits suffix) bundle
// into one fallback group — the caller's invocation defines the batch.
void test("Image filenames without a NNN.ext tail (no underscore-digits suffix) bundle i...", async (t) => {
  // doctest:L162
  const groups3 = groupScanFiles([
    "/in/holiday.jpg",
    "/in/random.png",
    "/in/Scan2026-04-29_154947_000.jpg",
    "/in/Scan2026-04-29_154947_001.jpg",
  ]);
  t.check(groups3.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | "), "image-batch:Scan2026-04-29_154947=2 | image-batch:(loose images)=2");
});

// The separator before the digit suffix can be either `_` or `-` —
// `photo-0001.jpg` clusters by the `photo` prefix the same way
// `Scan_001.jpg` clusters by `Scan`.
void test("The separator before the digit suffix can be either  or - — photo-0001.jpg cl...", async (t) => {
  // doctest:L177
  const groups5 = groupScanFiles([
    "/in/photo-0001.jpg",
    "/in/photo-0002.jpg",
    "/in/photo-0003.jpg",
  ]);
  t.check(groups5.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | "), "image-batch:photo=3");
});

// ## groupScanFiles: rejects unsupported types
void test("groupScanFiles: rejects unsupported types", async (t) => {
  // doctest:L189
  const err = await caught(async () => groupScanFiles(["/in/notes.txt"]));
  await t.checkText(err !== null && err.message.startsWith("Unsupported file type(s):"), "true");
});

// ## Concurrent ledger writers don't lose each other's entries
//
// The ledger is a read-modify-write, and two writers genuinely race: the scan
// promote worker runs inside `bbx serve` while the boxholder may run `bbx upload` by
// hand. `updateLedger` re-reads inside a cross-process lock, so the loser of the
// race appends to the winner's ledger rather than overwriting it — the unlocked
// load-mutate-save it replaced would keep exactly one of these ten entries.
void test("The ledger is a read-modify-write, and two writers genuinely race:", async (t) => {
  t.teardown(async () => {
    try {
      await boxL.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L203
  const boxL = await makeTmpBox();
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      updateLedger(boxL.root, (ledger) => addEntry(ledger, entry(`hash-${String(i)}`)))
    )
  );
  const after = await loadLedger(boxL.root);
  t.check({ count: after.entries.length, sample: findEntry(after, "hash-7")?.hash }, {
    count: 10,
    sample: "hash-7",
  });

  // The mutation runs against the ledger as it is on disk *now*, never a caller's
  // stale copy — so a dedup check inside the mutation sees the other writers' work:

  // doctest:L218
  await updateLedger(boxL.root, (ledger) => {
    if (findEntry(ledger, "hash-3") === undefined) addEntry(ledger, entry("hash-3"));
  });
  await t.checkText((await loadLedger(boxL.root)).entries.length, "10");
});
