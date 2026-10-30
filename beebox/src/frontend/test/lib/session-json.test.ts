// Per-tab JSON in sessionStorage: a stored value the schema accepts reads back;
// a missing key, bad JSON, a rejected shape, or no sessionStorage at all reads
// as the fallback without throwing.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { z } from "zod";
import { readSessionJson, writeSessionJson } from "../../src/lib/session-json.js";

void test("reads what it wrote, else the fallback", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  t.teardown(() => {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
  const values = new Map<string, string>([["bad-json", "{"], ["wrong-shape", "[1]"]]);
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  const read = (key: string) => readSessionJson({ key, schema: z.array(z.string()), fallback: ["none"], what: "Test" });
  writeSessionJson({ key: "good", value: ["a", "b"], what: "Test" });
  const warn = console.warn;
  console.warn = () => {};
  t.teardown(() => { console.warn = warn; });
  const present = ["good", "missing", "bad-json", "wrong-shape"].map(read);
  Reflect.deleteProperty(globalThis, "sessionStorage");
  t.check({ present, absent: read("good") }, {
    present: [["a", "b"], ["none"], ["none"], ["none"]],
    absent: ["none"],
  });
});
