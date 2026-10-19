// eventually(): the timeout message names the last error the way the old
// Markdown-test runtime's built-in did, since converted tests check that text.

import { test } from "tap";
import { eventually } from "../../src/exports/check.js";

void test("a rejected non-Error object is named by its message", async (t) => {
  await t.checkThrows(
    // eslint-disable-next-line prefer-promise-reject-errors -- the subject: eventually() must name a rejected non-Error by its message
    async () => eventually(() => Promise.reject({ message: "boom" }), { timeoutMs: 0 }),
    "EventuallyTimeout: condition was not true after 0ms; last error: boom",
  );
});

void test("a falsy value times out naming the value", async (t) => {
  await t.checkThrows(async () => eventually(() => false, { timeoutMs: 0, label: "ready" }), "EventuallyTimeout: ready was not true after 0ms; last value: false");
});

void test("a truthy value is returned", async (t) => {
  t.check(await eventually(() => ({ id: 1 })), { id: 1 });
});
