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

/** An error with a fixed stack, so the expected line does not depend on where the test runs. */
function thrown<E extends Error>(error: E, stack?: string): E {
  error.stack = stack;
  return error;
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

  t.check(describeArg(thrown(new Error("Failed to decode image"))), "Error: Failed to decode image");
});

// A named subclass — the shape that actually appeared — reads as both.
void test("A named subclass — the shape that actually appeared — reads as both.", async (t) => {
  t.check(describeArg(thrown(new ImageProcessingError("Failed to decode image"))), "ImageProcessingError: Failed to decode image");
});

// ## An Error keeps where it was thrown
//
// A production "Route error: TypeError: Cannot read properties of undefined
// (reading 'length')" could not be traced: the line named no place. The first
// frames follow the reason, without the origin; the bundle's sourcemap maps
// them back to source.
void test("An Error keeps its first stack frames", (t) => {
  const v8 = [
    "TypeError: Cannot read properties of undefined (reading 'length') for a@b",
    "    at Strip (https://box.example/assets/index-abc.js:12:345)",
    "    at renderWithHooks (https://box.example/assets/index-abc.js:1:2)",
    "    at a (https://box.example/assets/index-abc.js:1:3)",
    "    at b (https://box.example/assets/index-abc.js:1:4)",
    "    at c (https://box.example/assets/index-abc.js:1:5)",
    "    at d (https://box.example/assets/index-abc.js:1:6)",
  ].join("\n");
  const safari = "Strip@https://box.example/assets/index-abc.js:12:345\nrenderWithHooks@https://box.example/assets/index-abc.js:1:2";
  t.check({
    // The header is the message again; an "@" in it is not a frame.
    v8: describeArg(thrown(new TypeError("Cannot read properties of undefined (reading 'length') for a@b"), v8)),
    safari: describeArg(thrown(new TypeError("undefined is not an object (evaluating 'a.length')"), safari)),
  }, {
    v8: "TypeError: Cannot read properties of undefined (reading 'length') for a@b | at Strip (/assets/index-abc.js:12:345) | at renderWithHooks (/assets/index-abc.js:1:2) | at a (/assets/index-abc.js:1:3) | at b (/assets/index-abc.js:1:4) | at c (/assets/index-abc.js:1:5)",
    safari: "TypeError: undefined is not an object (evaluating 'a.length') | Strip@/assets/index-abc.js:12:345 | renderWithHooks@/assets/index-abc.js:1:2",
  });
  t.end();
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
