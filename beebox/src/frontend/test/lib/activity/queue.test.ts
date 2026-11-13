// The page's activity queue: entries leave in order, one request at a time, in
// batches of at most 200; a failing server is retried for a minute and then
// the batch is dropped with one warning; the queue holds at most 500; flush
// waits for the queue to empty but never longer than its timeout; nothing the
// transport does reaches the caller.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ActivityEntryInput } from "@core/activity/entry.js";
import { ActivityQueue, type ActivityTransport } from "../../../src/lib/activity/queue.js";
import { manualClock } from "./manual-clock.js";

const entry = (n: number): ActivityEntryInput => ({ card: "Molecules.figure.card", kind: "explored", detail: String(n) });
const details = (batch: readonly ActivityEntryInput[]): string[] => batch.map((e) => e.detail ?? "");

function captureWarnings(t: Test): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  t.teardown(() => { console.warn = original; });
  return warnings;
}

/** A transport whose requests the test settles by hand; records each batch and the most in flight at once. */
function slowTransport() {
  const sent: string[][] = [];
  const waiting: Array<{ ok: () => void; fail: () => void }> = [];
  let inFlight = 0;
  let mostInFlight = 0;
  const transport: ActivityTransport = (batch) => {
    sent.push(details(batch));
    inFlight++;
    mostInFlight = Math.max(mostInFlight, inFlight);
    return new Promise((resolve, reject) => {
      waiting.push({ ok: () => { inFlight--; resolve(undefined); }, fail: () => { inFlight--; reject(new Error("down")); } });
    });
  };
  return { transport, sent, waiting, mostInFlight: () => mostInFlight };
}

void test("entries go out in order, one request in flight", async (t) => {
  const clock = manualClock();
  const fake = slowTransport();
  const queue = new ActivityQueue({ transport: fake.transport, timers: clock });
  queue.push(entry(1));
  await clock.advance(250);
  queue.push(entry(2));
  queue.push(entry(3));
  await clock.advance(5_000);
  // The second request waits for the first to finish.
  t.check(fake.sent, [["1"]]);
  fake.waiting[0]?.ok();
  await clock.advance(1);
  fake.waiting[1]?.ok();
  await clock.advance(1);
  t.check({ sent: fake.sent, most: fake.mostInFlight() }, { sent: [["1"], ["2", "3"]], most: 1 });
});

void test("a request carries at most 200 entries", async (t) => {
  const clock = manualClock();
  const sent: number[] = [];
  const queue = new ActivityQueue({ transport: (batch) => { sent.push(batch.length); return Promise.resolve(); }, timers: clock });
  for (let n = 0; n < 450; n++) queue.push(entry(n));
  await clock.advance(250);
  t.check(sent, [200, 200, 50]);
});

void test("a failed batch is retried with backoff, in order, until it goes through", async (t) => {
  const warnings = captureWarnings(t);
  const clock = manualClock();
  const sent: string[][] = [];
  let failures = 2;
  const queue = new ActivityQueue({
    transport: (batch) => { sent.push(details(batch)); return failures-- > 0 ? Promise.reject(new Error("down")) : Promise.resolve(); },
    timers: clock,
  });
  queue.push(entry(1));
  queue.push(entry(2));
  await clock.advance(30_000);
  t.check({ sent, warnings }, { sent: [["1", "2"], ["1", "2"], ["1", "2"]], warnings: [] });
});

void test("a batch that keeps failing is dropped after a minute with one warning, and later entries still go", async (t) => {
  const warnings = captureWarnings(t);
  const clock = manualClock();
  const sent: string[][] = [];
  let down = true;
  const queue = new ActivityQueue({
    transport: (batch) => { sent.push(details(batch)); return down ? Promise.reject(new Error("down")) : Promise.resolve(); },
    timers: clock,
  });
  queue.push(entry(1));
  queue.push(entry(2));
  await clock.advance(50_000);
  t.check(warnings, []);
  await clock.advance(20_000);
  t.check(warnings, ["activity: gave up on 2 entries after 60s of failures"]);
  const attempts = sent.length;
  down = false;
  queue.push(entry(3));
  await clock.advance(1_000);
  t.check(sent.slice(attempts), [["3"]]);
});

void test("above 500 queued entries the oldest are dropped with a warning", async (t) => {
  const warnings = captureWarnings(t);
  const clock = manualClock();
  const sent: string[][] = [];
  const queue = new ActivityQueue({ transport: (batch) => { sent.push(details(batch)); return Promise.resolve(); }, timers: clock });
  for (let n = 0; n < 505; n++) queue.push(entry(n));
  await clock.advance(250);
  t.check({ warnings: warnings.length, first: sent[0]?.[0], total: sent.flat().length, last: sent.flat().at(-1) }, { warnings: 5, first: "5", total: 500, last: "504" });
  t.check(warnings[0], "activity: queue full, dropped the 1 oldest entry");
});

void test("flush resolves when the queue is empty, or at its timeout", async (t) => {
  const clock = manualClock();
  const fake = slowTransport();
  const queue = new ActivityQueue({ transport: fake.transport, timers: clock });
  let emptyDone = false;
  void queue.flush(1_000).then(() => { emptyDone = true; });
  await clock.advance(0);
  t.check(emptyDone, true);

  // Flushing sends at once, without the batching delay.
  queue.push(entry(1));
  let done = false;
  void queue.flush(1_000).then(() => { done = true; });
  await clock.advance(0);
  t.check({ sent: fake.sent, done }, { sent: [["1"]], done: false });
  await clock.advance(999);
  t.check(done, false);
  await clock.advance(1);
  t.check(done, true);

  // A flush that sees the queue drain resolves before its timeout.
  queue.push(entry(2));
  let drained = false;
  void queue.flush(60_000).then(() => { drained = true; });
  fake.waiting[0]?.ok();
  await clock.advance(1);
  fake.waiting[1]?.ok();
  await clock.advance(1);
  t.check(drained, true);
});

void test("a transport that throws or rejects never reaches the caller", async (t) => {
  captureWarnings(t);
  const clock = manualClock();
  let calls = 0;
  const queue = new ActivityQueue({
    transport: () => { calls++; if (calls % 2 === 0) throw new Error("sync"); return Promise.reject(new Error("async")); },
    timers: clock,
  });
  queue.push(entry(1));
  let flushed = false;
  void queue.flush(100).then(() => { flushed = true; });
  await clock.advance(100_000);
  t.check({ flushed, retried: calls > 1 }, { flushed: true, retried: true });
});
