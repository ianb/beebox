// # Stored boolean flags
//
// A flag is kept as "1" / "0". Absent storage, a throwing getter and a throwing
// store all read as off; a failed write is dropped.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readStoredFlag, writeStoredFlag, type FlagStorage, type StoredFlag } from "../../src/lib/stored-flag.js";

function memoryStorage(): FlagStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

const throwing: FlagStorage = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
};

const flagOn = (storage: () => FlagStorage | null): StoredFlag => ({ storage, key: "k" });

void test("A flag round-trips as 1 and 0", async (t) => {
  const storage = memoryStorage();
  const flag = flagOn(() => storage);
  t.check(readStoredFlag(flag), false);
  writeStoredFlag(flag, true);
  t.check([storage.values.get("k"), readStoredFlag(flag)], ["1", true]);
  writeStoredFlag(flag, false);
  t.check([storage.values.get("k"), readStoredFlag(flag)], ["0", false]);
});

void test("Values other than 1 read as off", async (t) => {
  const storage = memoryStorage();
  storage.values.set("k", "true");
  t.check(readStoredFlag(flagOn(() => storage)), false);
});

void test("Absent or failing storage reads as off and drops writes", async (t) => {
  const failing = [
    flagOn(() => null),
    flagOn(() => throwing),
    flagOn(() => { throw new Error("no access"); }),
  ];
  t.check(failing.map(readStoredFlag), [false, false, false]);
  t.check(failing.map((flag) => { writeStoredFlag(flag, true); return "ok"; }), ["ok", "ok", "ok"]);
});
