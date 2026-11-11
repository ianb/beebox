// # ensureTemporal — the polyfill loads only where Temporal is missing
//
// `boot()` awaits `ensureTemporal()` before the first render
// (`src/lib/temporal.ts`). A browser with native Temporal must not download
// the polyfill; one without it (Safari 18) must have `globalThis.Temporal`
// once the promise settles. Node 24 has no Temporal, so this file starts
// without it: it does not import `test/helpers/temporal-global.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ensureTemporal, ensureTemporalWith } from "../../src/lib/temporal.js";

void test("Without Temporal, the loader runs; the real one installs the global", async (t) => {
  t.check(typeof Reflect.get(globalThis, "Temporal"), "undefined");
  const calls: string[] = [];
  await ensureTemporalWith(async () => { calls.push("load"); });
  t.check(calls, ["load"]);

  await ensureTemporal();
  t.check(Temporal.PlainDate.from("2026-08-14").add({ days: 1 }).toString(), "2026-08-15");
});

void test("With Temporal present, the loader is not called", async (t) => {
  t.check(typeof Reflect.get(globalThis, "Temporal"), "object");
  const calls: string[] = [];
  await ensureTemporalWith(async () => { calls.push("load"); });
  t.check(calls, []);
});
