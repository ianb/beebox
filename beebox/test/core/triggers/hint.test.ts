// # The <triggers> hint
//
// A turn's `<triggers armed failed expired/>` child reports current counts;
// `expired` counts only expiries the agent has not been told of, and they are
// marked noticed only when the turn is dispatched, so a turn that fails to
// start carries them again.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { armActivation, listActivations, patchActivation } from "../../../src/core/triggers/activation.js";
import { renderTriggersHint, triggersHint } from "../../../src/core/triggers/hint.js";

const T0 = new Date("2026-11-14T10:00:00.000Z");

void test("The hint counts states and marks expiries noticed only on dispatch.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const who = { boxRoot: box.root, sessionId: "s1" };
  t.check(await triggersHint(box.root, "s1"), { element: "" });

  await armActivation(box.root, { sessionId: "s1", file: "a.ts", config: null, label: "A", expires: "never", now: T0 });
  const b = await armActivation(box.root, { sessionId: "s1", file: "b.ts", config: null, label: "B", expires: "never", now: T0 });
  await patchActivation({ ...who, id: b.id }, { fn: (x) => ({ ...x, state: "delivery-failed", error: "refused" }) });
  // Expired long ago: the plain deadline, applied at read.
  const c = await armActivation(box.root, { sessionId: "s1", file: "c.ts", config: null, label: "C", expires: { minutes: 1 }, now: T0 });
  // D ended with a fire (noticed at the fire), E ended quietly (the hint tells the agent once).
  const d = await armActivation(box.root, { sessionId: "s1", file: "d.ts", config: null, label: "D", expires: "never", now: T0 });
  await patchActivation({ ...who, id: d.id }, { fn: (x) => ({ ...x, state: "done", fires: 1, noticed: true }) });
  const e = await armActivation(box.root, { sessionId: "s1", file: "e.ts", config: null, label: "E", expires: "never", now: T0 });
  await patchActivation({ ...who, id: e.id }, { fn: (x) => ({ ...x, state: "done" }) });

  const first = await triggersHint(box.root, "s1");
  t.check(first.element, "<triggers armed=\"1\" failed=\"1\" expired=\"1\" done=\"1\"/>");
  // Not dispatched: the next turn says it again.
  t.check((await triggersHint(box.root, "s1")).element, "<triggers armed=\"1\" failed=\"1\" expired=\"1\" done=\"1\"/>");
  await first.noticed();
  t.check((await triggersHint(box.root, "s1")).element, "<triggers armed=\"1\" failed=\"1\" expired=\"0\" done=\"0\"/>");
  t.check((await listActivations(who)).filter((a) => a.id === c.id).map((a) => [a.state, a.noticed]), [["expired", true]]);
  t.check(renderTriggersHint([]), "");
});
