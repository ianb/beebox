// # The trigger runner
//
// Activity settles (1 s after the latest batch, 3 s at most after the first),
// then every armed activation of the session is evaluated in turn. Admission,
// the fire and the state write happen under one hold of the session's
// trigger lock, so a disarm during an evaluation drops the result as stale.
// Delivery failure is terminal; a failed activation that returns normally is
// armed again; a result inside the fire floor is suppressed. Timers, the
// child, delivery, presence and the clock are injected.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { recordActivity } from "../../../src/core/activity/log.js";
import { armActivation, disarmActivations, listActivations } from "../../../src/core/triggers/activation.js";
import type { EvalJob } from "../../../src/core/triggers/eval-child/core.js";
import type { EvalOutput } from "../../../src/core/triggers/eval.js";
import { TriggerRunner, type RunnerTimers } from "../../../src/core/triggers/runner/core.js";
import { readTrace } from "../../../src/core/triggers/trace.js";
import { UserMessageDeliveryError } from "../../../src/core/chat/session/deliver-user-message.js";

/** Manual time: `after` queues; `advance` runs what is due, in order, and moves the clock. */
class FakeTimers implements RunnerTimers {
  nowMs = Date.parse("2026-11-14T10:00:00.000Z");
  /** Set once the runner exists: awaited after every fired timer so its work lands before the clock moves on. */
  idle: () => Promise<void> = () => Promise.resolve();
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private next = 0;
  now = (): Date => new Date(this.nowMs);
  after = (ms: number, fn: () => void): (() => void) => {
    const id = this.next++;
    this.queue.push({ at: this.nowMs + ms, fn, id });
    return () => { this.queue = this.queue.filter((q) => q.id !== id); };
  };
  /** Move forward `ms`, firing due timers and letting their async work settle. */
  async advance(ms: number): Promise<void> {
    const target = this.nowMs + ms;
    for (;;) {
      const due = this.queue.filter((q) => q.at <= target).toSorted((a, b) => a.at - b.at).at(0);
      if (due === undefined) break;
      this.queue = this.queue.filter((q) => q.id !== due.id);
      this.nowMs = due.at;
      due.fn();
      await this.idle();
    }
    this.nowMs = target;
    await this.idle();
  }
}

const at = (s: string): string => `2026-11-14T10:00:${s}.000Z`;

/** A fake child: answers from a script keyed by call order; records what it was given. */
function fakeChild(script: ((job: EvalJob) => EvalOutput["final"])[]): { evaluate: (job: EvalJob) => Promise<EvalOutput>; jobs: EvalJob[]; release: () => void; hold: boolean } {
  const jobs: EvalJob[] = [];
  let resolveHold: (() => void) | null = null;
  const self = {
    jobs,
    hold: false,
    release: (): void => { resolveHold?.(); resolveHold = null; },
    evaluate: async (job: EvalJob): Promise<EvalOutput> => {
      jobs.push(job);
      if (self.hold) await new Promise<void>((r) => { resolveHold = r; });
      const final = (script[jobs.length - 1] ?? (() => ({ kind: "none" as const, at: at("00") })))(job);
      return { records: [final], final, ms: 7 };
    },
  };
  return self;
}

async function act(root: string, entry: string | { detail: string; chat: string }): Promise<void> {
  const { detail, chat } = typeof entry === "string" ? { detail: entry, chat: "s1" } : entry;
  await recordActivity(root, { user: null, entries: [{ kind: "modified", card: "Lab.figure.card", detail, chat }] });
}

void test("Activity settles into one evaluation; the fire is delivered and done ends the activation.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const timers = new FakeTimers();
  const delivered: string[] = [];
  const emitted: string[] = [];
  const child = fakeChild([
    () => ({ kind: "none", at: at("01") }),
    () => ({ kind: "result", at: at("02"), text: "That's water.", note: "n", done: true }),
  ]);
  const runner = new TriggerRunner({ boxRoot: box.root, evaluate: child.evaluate, deliver: async ({ message }) => { delivered.push(message); }, presence: async () => 1, emit: (s) => emitted.push(s), timers, now: timers.now });
  timers.idle = () => runner.idle();
  t.teardown(() => { runner.stop(); });

  await act(box.root, "before arming");
  await armActivation(box.root, { sessionId: "s1", file: "src/triggers/water.ts", config: { target: "H2O" }, label: "Water check", now: timers.now() });
  await runner.reload("s1");

  // No activation for s2: nothing is scheduled for it.
  await act(box.root, { detail: "elsewhere", chat: "s2" });
  await act(box.root, "add O");
  await runner.onActivity(["s1", "s2"]);
  await timers.advance(500);
  await act(box.root, "add H");
  await runner.onActivity(["s1"]);
  // The settle restarted at the second batch: 1 s after it, not after the first.
  await timers.advance(900);
  t.check(child.jobs, []);
  await timers.advance(200);
  t.check(child.jobs.map((j) => ({ reason: j.reason, entries: j.entries.map((e) => e.detail), history: j.history.map((e) => e.detail), fires: j.fires })),
    [{ reason: "activity", entries: ["add O", "add H"], history: ["add O", "add H"], fires: 0 }]);
  t.check(delivered, []);
  t.check((await listActivations({ boxRoot: box.root, sessionId: "s1" }, { now: timers.now() })).map((a) => [a.state, a.lastEvalSeq]), [["armed", 4]]);

  await act(box.root, "bond");
  await runner.onActivity(["s1"]);
  await timers.advance(1000);
  t.check(child.jobs.at(1)?.entries.map((e) => e.detail), ["bond"]);
  // The notice links to the card the latest entry came from.
  t.check(delivered, ["<trigger label=\"Water check\" file=\"src/triggers/water.ts\" card=\"Lab.figure.card\" fire=\"1\" entries=\"1\" done=\"1\">\n<text>That's water.</text>\n<note>n</note>\n</trigger>"]);
  t.check((await listActivations({ boxRoot: box.root, sessionId: "s1" }, { now: timers.now() })).map((a) => [a.state, a.fires, a.lastFireAt]), [["done", 1, "2026-11-14T10:00:02.600Z"]]);
  t.check(emitted, ["s1"]);
  t.check((await readTrace(box.root)).map((l) => [l.reason, l.entries, l.outcome]), [["activity", 2, "none"], ["activity", 1, "fired"]]);

  // Done: more activity schedules nothing.
  await act(box.root, "after done");
  await runner.onActivity(["s1"]);
  await timers.advance(5000);
  t.check(child.jobs.map((j) => j.entries.length), [2, 1]);
});

void test("A result with done and no text ends the activation quietly: nothing delivered, traced as done.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const timers = new FakeTimers();
  const delivered: string[] = [];
  const emitted: string[] = [];
  const child = fakeChild([() => ({ kind: "result", at: at("01"), done: true })]);
  const runner = new TriggerRunner({ boxRoot: box.root, evaluate: child.evaluate, deliver: async ({ message }) => { delivered.push(message); }, presence: async () => 1, emit: (s) => emitted.push(s), timers, now: timers.now });
  timers.idle = () => runner.idle();
  t.teardown(() => { runner.stop(); });
  await armActivation(box.root, { sessionId: "s1", file: "stuck.ts", config: null, label: "Stuck watch", expires: "never", now: timers.now() });
  await runner.reload("s1");
  await act(box.root, "solved it");
  await runner.onActivity(["s1"]);
  await timers.advance(1000);
  t.check(delivered, []);
  t.check((await listActivations({ boxRoot: box.root, sessionId: "s1" }, { now: timers.now() })).map((a) => [a.state, a.fires, a.noticed]), [["done", 0, false]]);
  t.check((await readTrace(box.root)).map((l) => l.outcome), ["done"]);
  t.check(emitted, ["s1"]);
});

void test("Continuous batches evaluate within the settle cap, and a batch during an evaluation re-arms it.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const timers = new FakeTimers();
  const child = fakeChild([]);
  const runner = new TriggerRunner({ boxRoot: box.root, evaluate: child.evaluate, deliver: async () => {}, presence: async () => 1, emit: () => {}, timers, now: timers.now });
  timers.idle = () => runner.idle();
  t.teardown(() => { runner.stop(); });
  await armActivation(box.root, { sessionId: "s1", file: "t.ts", config: null, label: "T", now: timers.now() });

  // A batch every 500 ms for 4 s: the cap fires an evaluation at 3 s after the first.
  const fired: number[] = [];
  for (let i = 0; i < 8; i++) {
    await act(box.root, `b${String(i)}`);
    await runner.onActivity(["s1"]);
    await timers.advance(500);
    if (child.jobs.length > fired.length) fired.push(timers.nowMs - Date.parse("2026-11-14T10:00:00.000Z"));
  }
  t.check(fired, [3000]);
  t.check(child.jobs.at(0)?.entries.map((e) => e.detail), ["b0", "b1", "b2", "b3", "b4", "b5"]);

  // A batch landing mid-evaluation sets the re-arm flag; the next evaluation sees only what the first did not.
  // While the child is held, the clock must not wait for the runner (it would wait forever).
  child.hold = true;
  timers.idle = () => Promise.resolve();
  await timers.advance(1000);
  await new Promise((r) => setTimeout(r, 50));
  t.check(child.jobs.map((j) => j.entries.map((e) => e.detail)), [["b0", "b1", "b2", "b3", "b4", "b5"], ["b6", "b7"]]);
  await act(box.root, "late");
  await runner.onActivity(["s1"]);
  await timers.advance(2000);
  t.check(child.jobs.map((j) => j.entries.map((e) => e.detail)), [["b0", "b1", "b2", "b3", "b4", "b5"], ["b6", "b7"]]);
  child.hold = false;
  child.release();
  timers.idle = () => runner.idle();
  await runner.idle();
  await timers.advance(1000);
  t.check(child.jobs.map((j) => j.entries.map((e) => e.detail)), [["b0", "b1", "b2", "b3", "b4", "b5"], ["b6", "b7"], ["late"]]);
});

void test("A disarm during an evaluation drops the result as stale; delivery failure is terminal; a failed activation recovers.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const timers = new FakeTimers();
  const delivered: string[] = [];
  let refuse: "ok" | "refuse" | "throw" = "ok";
  const child = fakeChild([
    () => ({ kind: "result", at: at("01"), text: "stale one" }),
    () => ({ kind: "error", at: at("02"), message: "trigger() threw: nope" }),
    () => ({ kind: "none", at: at("03") }),
    () => ({ kind: "result", at: at("04"), text: "first" }),
    () => ({ kind: "result", at: at("05"), text: "too soon" }),
    () => ({ kind: "result", at: at("06"), text: "undeliverable" }),
  ]);
  const emitted: string[] = [];
  const runner = new TriggerRunner({
    boxRoot: box.root,
    evaluate: child.evaluate,
    deliver: async ({ message }) => {
      if (refuse === "refuse") throw new UserMessageDeliveryError();
      if (refuse === "throw") throw new Error("socket closed");
      delivered.push(message);
    },
    presence: async () => 1,
    emit: (s) => emitted.push(s),
    timers,
    now: timers.now,
  });
  timers.idle = () => runner.idle();
  t.teardown(() => { runner.stop(); });
  const who = { boxRoot: box.root, sessionId: "s1" };
  const a = await armActivation(box.root, { sessionId: "s1", file: "t.ts", config: null, label: "T", expires: "never", now: timers.now() });
  const states = async (): Promise<[string, string | undefined][]> => (await listActivations(who, { now: timers.now() })).map((x) => [x.state, x.error]);
  const run = async (detail: string): Promise<void> => { await act(box.root, detail); await runner.onActivity(["s1"]); await timers.advance(1000); };

  // 1: disarm while the child runs; the result is stale and nothing is delivered. Then re-arm for the rest.
  child.hold = true;
  timers.idle = () => Promise.resolve();
  await act(box.root, "x");
  await runner.onActivity(["s1"]);
  await timers.advance(1000);
  await new Promise((r) => setTimeout(r, 50));
  await disarmActivations(who, { id: a.id, now: timers.now() });
  child.hold = false;
  child.release();
  timers.idle = () => runner.idle();
  await runner.idle();
  t.check(delivered, []);
  t.check(await states(), [["disarmed", undefined]]);
  const b = await armActivation(box.root, { sessionId: "s1", file: "t.ts", config: null, label: "T", expires: "never", now: timers.now() });
  await runner.reload("s1");

  // 2: the child errors: failed, with the error; 3: a normal return restores armed.
  await run("y");
  t.check(await states(), [["disarmed", undefined], ["failed", "trigger() threw: nope"]]);
  await run("z");
  t.check(await states(), [["disarmed", undefined], ["armed", undefined]]);

  // 4: a fire; 5: another inside 5 s is suppressed; 6: the send is refused: terminal, no retry, no more evaluations.
  await run("w");
  await run("v");
  t.check(delivered.map((m) => /<text>(.*)<\/text>/.exec(m)?.at(1)), ["first"]);
  refuse = "refuse";
  await timers.advance(5000);
  await run("u");
  t.check(await states(), [["disarmed", undefined], ["delivery-failed", "the chat refused the message"]]);
  await run("t");
  t.check(child.jobs.map((j) => j.entries.map((e) => e.detail)), [["x"], ["y"], ["z"], ["w"], ["v"], ["u"]]);
  t.check((await readTrace(box.root, { session: "s1" })).map((l) => l.outcome), ["stale", "error", "none", "fired", "suppressed", "delivery-failed"]);
  t.check(emitted, ["s1", "s1", "s1", "s1"]);
  t.check((await listActivations(who, { now: timers.now() })).map((x) => x.id), [a.id, b.id]);
});

void test("Ticks run while someone is present and the deadline ends an activation on time.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const timers = new FakeTimers();
  let present = 0;
  const child = fakeChild([]);
  const emitted: string[] = [];
  const runner = new TriggerRunner({ boxRoot: box.root, evaluate: child.evaluate, deliver: async () => {}, presence: async () => present, emit: (s) => emitted.push(s), timers, now: timers.now });
  timers.idle = () => runner.idle();
  t.teardown(() => { runner.stop(); });
  await act(box.root, "earlier");
  await armActivation(box.root, { sessionId: "s1", file: "stuck.ts", config: null, label: "Stuck check", tick: 60, expires: { minutes: 4 }, now: timers.now() });
  await runner.boot();

  // Nobody present at the first two ticks: skipped, said once.
  await timers.advance(60_000);
  await timers.advance(60_000);
  t.check(child.jobs, []);
  t.check((await readTrace(box.root)).map((l) => [l.reason, l.outcome, l.error]), [["tick", "skipped", "nobody is present"]]);

  // Someone arrives and moves an atom: the third tick evaluates with the new entry and the history since arming.
  present = 1;
  await act(box.root, "moved");
  await timers.advance(60_000);
  t.check(child.jobs.map((j) => ({ reason: j.reason, entries: j.entries.length, history: j.history.map((e) => e.detail) })), [{ reason: "tick", entries: 1, history: ["moved"] }]);
  t.check(emitted, []);
  // The deadline (4 min) lands with the fourth tick: expired, announced, and the tick finds nothing to run.
  await timers.advance(60_000);
  t.check((await listActivations({ boxRoot: box.root, sessionId: "s1" }, { now: timers.now() })).map((a) => [a.state, a.error]), [["expired", "reached its deadline"]]);
  t.check(emitted, ["s1"]);
  await timers.advance(120_000);
  t.check(child.jobs.map((j) => j.reason), ["tick"]);
});
