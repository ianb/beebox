// # Trigger activations
//
// An activation is one armed trigger in one chat. Expiry is first-class: the
// default is 20 person turns or 2 hours, `{}` is refused, and unlimited is
// only the explicit string "never". `expiryOf` is applied at read, so a
// deadline that passed while nothing ran still reads as expired.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { recordActivity } from "../../../src/core/activity/log.js";
import {
  armActivation,
  countPersonTurn,
  describeExpires,
  disarmActivations,
  expiresSchema,
  expiryOf,
  listActivations,
  listAllActivations,
  patchActivation,
  readActivationFile,
  removeActivationFile,
} from "../../../src/core/triggers/activation.js";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

const T0 = new Date("2026-11-14T10:00:00.000Z");
const later = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

// ## The expires validator
void test("The expires validator needs a positive finite limit or the word never.", (t) => {
  t.check(expiresSchema.safeParse({}).success, false);
  t.check(expiresSchema.safeParse({ turns: 0 }).success, false);
  t.check(expiresSchema.safeParse({ minutes: -5 }).success, false);
  t.check(expiresSchema.safeParse({ turns: 2.5 }).success, false);
  t.check(expiresSchema.safeParse({ turns: 20, extra: 1 }).success, false);
  t.check(expiresSchema.safeParse("forever").success, false);
  t.check(expiresSchema.safeParse("never").success, true);
  t.check(expiresSchema.safeParse({ turns: 3 }).success, true);
  t.check(expiresSchema.safeParse({ minutes: 0.5 }).success, true);
  t.check(describeExpires({ turns: 20, minutes: 120 }), "20 turns or 2 hours");
  t.check(describeExpires({ turns: 1, minutes: 90 }), "1 turn or 90 minutes");
  t.check(describeExpires("never"), "never");
  t.end();
});

// ## expiryOf
void test("expiryOf names the limit that was reached and never re-judges a terminal activation.", (t) => {
  const base = { expires: { turns: 2, minutes: 10 }, turnsSeen: 0, deadline: later(10).toISOString(), state: "armed" as const };
  t.check(expiryOf(base, T0), null);
  t.check(expiryOf({ ...base, turnsSeen: 2 }, T0), "turns");
  t.check(expiryOf(base, later(10)), "time");
  // Turns win when both are reached: the person's own turn is the nearer cause.
  t.check(expiryOf({ ...base, turnsSeen: 5 }, later(11)), "turns");
  t.check(expiryOf({ ...base, expires: { turns: 2 }, deadline: null, turnsSeen: 1 }, later(999)), null);
  t.check(expiryOf({ ...base, expires: "never", deadline: null, turnsSeen: 999 }, later(999)), null);
  t.check(expiryOf({ ...base, state: "done", turnsSeen: 9 }, later(99)), null);
  t.end();
});

// ## Arm, list, and the default expiry
void test("Arming records the log position and the default deadline; a passed deadline reads as expired.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const who = { boxRoot: box.root, sessionId: "s1" };
  await recordActivity(box.root, { user: null, entries: [{ kind: "explored", card: "Lab.figure.card", detail: "add C", chat: "s1" }] });

  const armed = await armActivation(box.root, { sessionId: "s1", file: "src/triggers/water.ts", config: { target: "H2O" }, label: "Water check", tick: 60, now: T0 });
  t.check(armed, {
    id: any(String),
    file: "src/triggers/water.ts",
    config: { target: "H2O" },
    label: "Water check",
    tick: 60,
    armedAt: "2026-11-14T10:00:00.000Z",
    armedAtSeq: 1,
    deadline: "2026-11-14T12:00:00.000Z",
    lastEvalSeq: 1,
    turnsSeen: 0,
    fires: 0,
    expires: { turns: 20, minutes: 120 },
    state: "armed",
    noticed: false,
  });
  t.check((await listActivations(who, { now: later(119) })).map((a) => a.state), ["armed"]);
  t.check((await listActivations(who, { now: later(120) })).map((a) => [a.state, a.error]), [["expired", "reached its deadline"]]);
  // The file itself is untouched by a read.
  t.check((await readActivationFile(who)).activations.map((a) => a.state), ["armed"]);

  // A turns-only limit has no deadline; "never" neither.
  const turnsOnly = await armActivation(box.root, { sessionId: "s1", file: "src/triggers/stuck.ts", config: null, label: "Stuck check", expires: { turns: 3 }, now: T0 });
  t.check(turnsOnly.deadline, null);
  const forever = await armActivation(box.root, { sessionId: "s1", file: "src/triggers/forever.ts", config: null, label: "Forever", expires: "never", now: T0 });
  t.check([forever.deadline, forever.expires], [null, "never"]);
  await t.checkThrows(() => armActivation(box.root, { sessionId: "s1", file: "x.ts", config: null, label: "Bad", expires: expiresSchema.parse({}), now: T0 }), "ZodError");

  const all = await listAllActivations(box.root, { now: T0 });
  t.check([...all.entries()].map(([session, list]) => [session, list.map((a) => a.label)]), [["s1", ["Water check", "Stuck check", "Forever"]]]);
});

// ## Person turns count against armed and failed activations only
void test("Counting a person turn expires an activation at its turn limit and leaves terminal ones alone.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const who = { boxRoot: box.root, sessionId: "s1" };
  // No file yet: nothing to count, and no file is created.
  t.check(await countPersonTurn(who, { now: T0 }), { expired: [] });
  t.check((await readActivationFile(who)).activations, []);

  const a = await armActivation(box.root, { sessionId: "s1", file: "a.ts", config: null, label: "A", expires: { turns: 2 }, now: T0 });
  const b = await armActivation(box.root, { sessionId: "s1", file: "b.ts", config: null, label: "B", expires: { turns: 5 }, now: T0 });
  await patchActivation({ ...who, id: b.id }, { fn: (x) => ({ ...x, state: "failed", error: "boom" }), now: T0 });
  const done = await armActivation(box.root, { sessionId: "s1", file: "c.ts", config: null, label: "C", expires: { turns: 1 }, now: T0 });
  await patchActivation({ ...who, id: done.id }, { fn: (x) => ({ ...x, state: "done" }), now: T0 });

  t.check((await countPersonTurn(who, { now: T0 })).expired, []);
  const second = await countPersonTurn(who, { now: T0 });
  t.check(second.expired.map((x) => [x.id, x.state, x.error, x.turnsSeen]), [[a.id, "expired", "reached its turn limit", 2]]);
  t.check((await listActivations(who, { now: T0 })).map((x) => [x.label, x.state, x.turnsSeen]), [["A", "expired", 2], ["B", "failed", 2], ["C", "done", 0]]);
});

// ## Disarm
void test("Disarm changes armed and failed activations and leaves terminal ones as they were.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const who = { boxRoot: box.root, sessionId: "s1" };
  const a = await armActivation(box.root, { sessionId: "s1", file: "a.ts", config: null, label: "Water check", now: T0 });
  const b = await armActivation(box.root, { sessionId: "s1", file: "b.ts", config: null, label: "Water check", now: T0 });
  await patchActivation({ ...who, id: b.id }, { fn: (x) => ({ ...x, state: "failed", error: "boom" }), now: T0 });
  const c = await armActivation(box.root, { sessionId: "s1", file: "c.ts", config: null, label: "Done one", now: T0 });
  await patchActivation({ ...who, id: c.id }, { fn: (x) => ({ ...x, state: "done" }), now: T0 });

  t.check(await disarmActivations(who, { id: "nope", now: T0 }), []);
  // Disarming clears a failed activation's error: it is no longer "not working", it is off.
  t.check((await disarmActivations(who, { label: "Water check", now: T0 })).map((x) => [x.id, x.state, x.error]), [[a.id, "disarmed", undefined], [b.id, "disarmed", undefined]]);
  t.check(await disarmActivations(who, { all: true, now: T0 }), []);
  t.check((await listActivations(who, { now: T0 })).map((x) => x.state), ["disarmed", "disarmed", "done"]);

  await removeActivationFile(who);
  t.check(await readActivationFile(who), { activations: [], invalid: false });
});

// ## A hand-edited file that fails the schema is ignored, not trusted
void test("An invalid activation file reads as empty and refuses writes.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const who = { boxRoot: box.root, sessionId: "s1" };
  const dir = path.join(box.root, ".beebox", "triggers");
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "s1.json"), JSON.stringify({ activations: [{ id: "x" }] }));
  t.check(await readActivationFile(who), { activations: [], invalid: true });
  t.check(await listActivations(who, { now: T0 }), []);
  await t.checkThrows(() => disarmActivations(who, { all: true }), "TriggerFileInvalidError");
  await t.checkThrows(() => readActivationFile({ boxRoot: box.root, sessionId: "../etc" }), "TriggerSessionIdError");
});
