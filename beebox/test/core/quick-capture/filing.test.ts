// # Filing captures that arrive with no words
//
// A phone capture with no words used to be saved and never read. Now the worker
// requests filing, and a sweep queues the capture's doc on the intake job once
// the person's burst of captures settles, then starts a box cycle whose agent
// titles and files it (`docs/implemented-plans/file-wordless-captures.md`).
//
// `filingPlan` makes every decision from the records, the docs the sweep read,
// and the refs pending jobs hold, so these examples call it directly.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { filingPlan, isWordless, nextKickAt, FILING_WAITING_ERROR, type FilingDoc } from "../../../src/core/quick-capture/filing.js";
import { invariant } from "../../../src/shared/invariant.js";
import type { CaptureRecord } from "../../../src/core/quick-capture/store.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { acceptQuickCapture } from "../../../src/core/quick-capture/acceptance.js";
import { processCapture } from "../../../src/core/quick-capture/worker.js";
import { readCapture } from "../../../src/core/quick-capture/store.js";
import { runFilingSweep } from "../../../src/core/quick-capture/filing-sweep.js";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { parseFrontmatterObject } from "../../../src/exports/cards.js";

const T0 = Date.parse("2026-10-17T12:00:00Z");
const at = (minutes: number): string => new Date(T0 + minutes * 60000).toISOString();
function capture(id: string, over?: Partial<CaptureRecord>): CaptureRecord {
  return { id: `00000000-0000-4000-8000-00000000000${id}`, owner: "priya@example.com", digest: "d", acceptedAt: at(0), state: "saved", attempts: 0, filingRequested: true,
    declaration: { version: 1, capturedAt: at(0), source: "apple-share-extension", material: { kind: "url", url: "https://example.com/recipe" } }, ...over };
}
const ref = (id: string): string => `_content/captures/00000000-0000-4000-8000-00000000000${id}.doc.card`;
const placeholder = (id: string): [string, FilingDoc] => [`00000000-0000-4000-8000-00000000000${id}`, { ref: ref(id), title: "Saved capture" }];
const docs = (...entries: [string, FilingDoc][]): Map<string, FilingDoc> => new Map(entries);
const none = new Set<string>();

// ## The worker and the sweep on a box
//
// The worker requests filing when it saves a word-less capture. The sweep then
// queues the doc on the unscoped intake job and asks for one box cycle, counted
// before the caller starts it.
const captureId = "11111111-1111-4111-8111-111111111111";
const shared = { version: 1 as const, capturedAt: "2026-10-17T12:00:00Z", source: "apple-share-extension" as const, material: { kind: "url" as const, url: "https://example.com/recipe" } };

// Only saved material with no words of its own is filed. A capture with words
// goes to chat; a recording keeps its transcription retry instead.
void test("Only saved material with no words of its own is filed.", async (t) => {
  const words = capture("1", { declaration: { version: 1, capturedAt: at(0), source: "apple-share-extension", input: "compare this", material: { kind: "url", url: "https://example.com" } } });
  const recording = capture("2", { declaration: { version: 1, capturedAt: at(0), source: "apple-voice-recording", material: { kind: "audio", id: "00000000-0000-4000-8000-000000000002", mimeType: "audio/mp4", byteLength: 1, sha256: "a".repeat(64), fileName: "r.m4a" } } });
  t.check([isWordless(capture("3")), isWordless(words), isWordless(recording)], [
    true,
    false,
    false,
  ]);
});

// Nothing is queued until two minutes pass with no new word-less capture from
// that person, so a burst reaches the agent together.
void test("Nothing is queued until two minutes pass with no new word-less capture from t...", async (t) => {
  t.check(filingPlan({ records: [capture("1")], docs: docs(placeholder("1")), queued: none, now: T0 + 60000 }), {
    clear: [],
    dequeue: [],
    queue: [],
    kick: [],
    exhausted: [],
  });

  t.check(filingPlan({ records: [capture("1")], docs: docs(placeholder("1")), queued: none, now: T0 + 120000 }), {
    clear: [],
    dequeue: [],
    queue: [
      "_content/captures/00000000-0000-4000-8000-000000000001.doc.card",
    ],
    kick: [
      "00000000-0000-4000-8000-000000000001",
    ],
    exhausted: [],
  });
});

// A newer capture holds back the person's older ones. Another person's captures
// settle on their own clock.
void test("A newer capture holds back the person's older ones.", async (t) => {
  const records = [capture("1"), capture("2", { acceptedAt: at(1.5) }), capture("3", { owner: "james@example.com" })];
  t.check(filingPlan({ records, docs: docs(placeholder("1"), placeholder("2"), placeholder("3")), queued: none, now: T0 + 150000 }), {
    clear: [],
    dequeue: [],
    queue: [
      "_content/captures/00000000-0000-4000-8000-000000000003.doc.card",
    ],
    kick: [
      "00000000-0000-4000-8000-000000000003",
    ],
    exhausted: [],
  });
});

// A capture still being prepared holds the burst open too, before its own
// filing request exists.
void test("A capture still being prepared holds the burst open too, before its own filin...", async (t) => {
  const preparing = capture("2", { state: "preparing", filingRequested: undefined, acceptedAt: at(1.9) });
  t.check(filingPlan({ records: [capture("1"), preparing], docs: docs(placeholder("1")), queued: none, now: T0 + 120000 }).queue, []);
});

// Done is read from the doc: retitled, moved out of `_content/captures/`, or
// deleted. The job disappearing proves nothing, because `bbx finish` deletes a
// whole job card, items appended after the agent read it included.
void test("Done is read from the doc:", async (t) => {
  const moved: [string, FilingDoc] = ["00000000-0000-4000-8000-000000000002", { ref: "_content/Recipes/00000000-0000-4000-8000-000000000002.doc.card", title: "Saved capture" }];
  const retitled: [string, FilingDoc] = ["00000000-0000-4000-8000-000000000001", { ref: ref("1"), title: "Lemon pasta recipe" }];
  const gone: [string, FilingDoc] = ["00000000-0000-4000-8000-000000000003", null];
  t.check(filingPlan({ records: [capture("1"), capture("2"), capture("3")], docs: docs(retitled, moved, gone), queued: none, now: T0 + 600000 }).clear, [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ]);
});

// A ref already in a pending job is not appended again, so a crash between the
// append and the record update cannot queue it twice. The wakeup is still due.
void test("A ref already in a pending job is not appended again, so a crash between the...", async (t) => {
  t.check(filingPlan({ records: [capture("1")], docs: docs(placeholder("1")), queued: new Set([ref("1")]), now: T0 + 600000 }), {
    clear: [],
    dequeue: [],
    queue: [],
    kick: [
      "00000000-0000-4000-8000-000000000001",
    ],
    exhausted: [],
  });
});

// Words win. Context added to a waiting capture takes it out of the job at
// once; the words route to chat as before. The capture leaves filing for good
// when the words are delivered, and until then it only waits.
void test("Words win.", async (t) => {
  const words = { version: 1 as const, capturedAt: at(1), source: "apple-native-input" as const, input: "compare this with ours", parentCaptureId: "00000000-0000-4000-8000-000000000001" };
  const sending = capture("9", { state: "sending", filingRequested: undefined, declaration: words });
  t.check(filingPlan({ records: [capture("1"), sending], docs: docs(placeholder("1")), queued: new Set([ref("1")]), now: T0 + 600000 }), {
    clear: [],
    dequeue: [
      "_content/captures/00000000-0000-4000-8000-000000000001.doc.card",
    ],
    queue: [],
    kick: [],
    exhausted: [],
  });

  const sent = capture("9", { state: "sent", filingRequested: undefined, declaration: words });
  t.check(filingPlan({ records: [capture("1"), sent], docs: docs(placeholder("1")), queued: none, now: T0 + 600000 }).clear, [
    "00000000-0000-4000-8000-000000000001",
  ]);
});

// A deleted context event does not take the capture out of filing, and a
// capture caught mid-Retry, briefly "preparing", keeps its request.
void test("A deleted context event does not take the capture out of filing, and a captur...", async (t) => {
  const deletedContext = capture("9", { state: "gone", filingRequested: undefined, declaration: { version: 1, capturedAt: at(1), source: "apple-native-input", input: "never sent", parentCaptureId: "00000000-0000-4000-8000-000000000001" } });
  t.check(filingPlan({ records: [capture("1"), deletedContext], docs: docs(placeholder("1")), queued: none, now: T0 + 600000 }).queue, [
    "_content/captures/00000000-0000-4000-8000-000000000001.doc.card",
  ]);

  t.check(filingPlan({ records: [capture("1", { state: "preparing" })], docs: docs(placeholder("1")), queued: none, now: T0 + 600000 }), {
    clear: [],
    dequeue: [],
    queue: [],
    kick: [],
    exhausted: [],
  });
});

// Wakeups back off: 2, 4 and 8 minutes, then every 15. A capture waits for its
// next allowed time.
void test("Wakeups back off:", async (t) => {
  t.check([1, 2, 3, 4, 5].map(kicks => (Date.parse(nextKickAt(T0, kicks)) - T0) / 60000), [
    2,
    4,
    8,
    15,
    15,
  ]);

  t.check(filingPlan({ records: [capture("1", { filingKicks: 1, filingKickAt: at(12) })], docs: docs(placeholder("1")), queued: new Set([ref("1")]), now: T0 + 600000 }).kick, []);
});

// After six wakeups the sweep stops starting cycles and shows the person why,
// once. A later cycle that files the capture clears the message with the rest.
void test("After six wakeups the sweep stops starting cycles and shows the person why, o...", async (t) => {
  t.check(filingPlan({ records: [capture("1", { filingKicks: 6 })], docs: docs(placeholder("1")), queued: new Set([ref("1")]), now: T0 + 600000 }), {
    clear: [],
    dequeue: [],
    queue: [],
    kick: [],
    exhausted: [
      "00000000-0000-4000-8000-000000000001",
    ],
  });

  t.check(filingPlan({ records: [capture("1", { filingKicks: 6, error: FILING_WAITING_ERROR })], docs: docs(placeholder("1")), queued: new Set([ref("1")]), now: T0 + 600000 }).exhausted, []);
});

// An exhausted capture does not hold back a newer one: the newer one gets its
// own wakeups.
void test("An exhausted capture does not hold back a newer one:", async (t) => {
  const tired = capture("1", { filingKicks: 6, error: FILING_WAITING_ERROR });
  const fresh = capture("2", { acceptedAt: at(5) });
  t.check(filingPlan({ records: [tired, fresh], docs: docs(placeholder("1"), placeholder("2")), queued: new Set([ref("1")]), now: T0 + 600000 }).kick, [
    "00000000-0000-4000-8000-000000000002",
  ]);
});

void test("The worker and the sweep on a box", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_TIME;
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  process.env.BBX_TIME = "2026-10-17T12:00:00Z";
  const box = await makeTmpBox({ git: true });
  await acceptQuickCapture({ boxRoot: box.root, id: captureId, owner: null, declaration: shared });
  const saved = await processCapture({ boxRoot: box.root, jev: undefined, chat: undefined }, captureId);
  t.check([saved?.state, saved?.filingRequested], [
    "saved",
    true,
  ]);

  t.check(await runFilingSweep({ boxRoot: box.root, wakeupRunning: false }), false);

  // Two minutes later the doc is on the job, the sweep asks for a box cycle, and
  // the record says when the next one may start.

  process.env.BBX_TIME = "2026-10-17T12:02:00Z";
  const wake = await runFilingSweep({ boxRoot: box.root, wakeupRunning: false });
  const jobFile = (await readdir(box.path("_bookkeeping/jobs"))).find(name => name.endsWith(".intake.job.card"));
  invariant(jobFile !== undefined, "expected an intake job");
  const job = parseFrontmatterObject(await readFile(box.path(`_bookkeeping/jobs/${jobFile}`), "utf8"));
  const record = await readCapture(box.root, captureId);
  t.check([wake, job?.items, record?.filingKicks, record?.filingKickAt], [
    true,
    [
      {
        ref: "_content/captures/11111111-1111-4111-8111-111111111111.doc.card",
      },
    ],
    1,
    "2026-10-17T12:04:00.000Z",
  ]);

  // A sweep before that time appends nothing and starts nothing.

  process.env.BBX_TIME = "2026-10-17T12:03:00Z";
  const wakeAgain = await runFilingSweep({ boxRoot: box.root, wakeupRunning: false });
  const again = parseFrontmatterObject(await readFile(box.path(`_bookkeeping/jobs/${jobFile}`), "utf8"));
  t.check([wakeAgain, again?.items], [
    false,
    [
      {
        ref: "_content/captures/11111111-1111-4111-8111-111111111111.doc.card",
      },
    ],
  ]);

  // When the agent retitles the doc, the next sweep clears the request.

  const docPath = box.path("_content/captures/11111111-1111-4111-8111-111111111111.doc.card");
  await writeFile(docPath, (await readFile(docPath, "utf8")).replace("title: Saved capture", "title: Lemon pasta recipe"));
  const wakeFiled = await runFilingSweep({ boxRoot: box.root, wakeupRunning: false });
  const filed = await readCapture(box.root, captureId);
  t.check([filed?.filingRequested ?? "cleared", filed?.filingKicks ?? "cleared", wakeFiled], [
    "cleared",
    "cleared",
    false,
  ]);
});

// Retry on a saved word-less capture starts a fresh set of wakeups and drops
// the waiting message.
void test("Retry on a saved word-less capture starts a fresh set of wakeups and drops th...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_TIME;
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  process.env.BBX_TIME = "2026-10-17T12:00:00Z";
  const box = await makeTmpBox({ git: true });
  await acceptQuickCapture({ boxRoot: box.root, id: captureId, owner: null, declaration: shared });
  await processCapture({ boxRoot: box.root, jev: undefined, chat: undefined }, captureId);
  const recordPath = box.path(`.beebox/quick-capture/${captureId}/record.json`);
  await writeFile(recordPath, JSON.stringify({ ...JSON.parse(await readFile(recordPath, "utf8")), filingKicks: 6, error: FILING_WAITING_ERROR }));
  const retried = await processCapture({ boxRoot: box.root, jev: undefined, chat: undefined, manualRetry: true }, captureId);
  t.check([retried?.state, retried?.filingRequested, retried?.filingKicks ?? "reset", retried?.error ?? "none"], [
    "saved",
    true,
    "reset",
    "none",
  ]);
});
