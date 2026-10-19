// # Debug log argument formatting
//
// `describeArg` (`lib/debug-log-format.ts`) turns one `console.*` argument into
// the line the debug log keeps and ships to the server.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { describeArg } from "../../src/lib/debug-log-format.js";

class ImageProcessingError extends Error {
  constructor(detail: string) { super(detail); this.name = "ImageProcessingError"; }
}

const circular: Record<string, unknown> = { name: "loop" };
circular["self"] = circular;

// ## An Error keeps its reason
//
// This is the whole point of the module. `message` and `stack` are non-enumerable,
// so `JSON.stringify(new Error("boom"))` is `{}` — and a subclass that sets `name`
// logs as `{"name":"..."}`, the class and nothing else. That is what the debug log
// used to record: a journey walker read one, wrote "a name, not a reason", and had
// to guess the cause. So did the engineer reading the log afterwards.
void test("This is the whole point of the module.", async (t) => {
  await t.checkText(JSON.stringify(new Error("Failed to decode image")), "{}");

  t.check(describeArg(new Error("Failed to decode image")), "Error: Failed to decode image");
});

// A named subclass — the shape that actually appeared — reads as both.
void test("A named subclass — the shape that actually appeared — reads as both.", async (t) => {
  t.check(describeArg(new ImageProcessingError("Failed to decode image")), "ImageProcessingError: Failed to decode image");
});

// ## Strings pass through; other values serialize
void test("Strings pass through; other values serialize", async (t) => {
  await t.checkText(describeArg("[chat] Failed to process pasted image:"), "[chat] Failed to process pasted image:");

  await t.checkText(describeArg({ boxSlug: "journey-b", count: 2 }), "{\"boxSlug\":\"journey-b\",\"count\":2}");
});

// ## Values `JSON.stringify` cannot represent
//
// `undefined` stringifies to `undefined` rather than to a string, and a circular
// object throws — inside a patched `console` that would take out the log call
// itself, so neither may escape.
void test("undefined stringifies to undefined rather than to a string, and a circular ob...", async (t) => {
  await t.checkText(describeArg(undefined), "undefined");

  await t.checkText(describeArg(circular), "[object Object]");
});
