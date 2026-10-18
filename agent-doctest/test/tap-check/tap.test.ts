// t.check and friends on a promise: the test stays open until the check has
// run, even when the caller forgot to await it.

import { test } from "tap";
import "../../src/tap-check/tap.js";

const later = async <T>(value: T): Promise<T> => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return value;
};

void test("an un-awaited check still runs before its test ends", async (t) => {
  const ran: string[] = [];
  await t.test("check", async (tt) => {
    void tt.check(later("a").then((v) => (ran.push("check"), v)), "a");
  });
  await t.test("checkText", async (tt) => {
    void tt.checkText(later("b").then((v) => (ran.push("checkText"), v)), "b");
  });
  await t.test("checkThrows", async (tt) => {
    void tt.checkThrows(() => later(null).then(() => {
      ran.push("checkThrows");
      throw new TypeError("late");
    }), "TypeError");
  });
  t.check(ran, ["check", "checkText", "checkThrows"]);
});
