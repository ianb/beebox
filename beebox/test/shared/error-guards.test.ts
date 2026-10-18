// # Error guards
//
// Typed access to `unknown` caught values — the blessed replacement for
// `(e as NodeJS.ErrnoException).code` and `(e as Error).message` casts in catch
// blocks. See `src/shared/error-guards.ts`. The frontend imports the same
// implementation through the `@shared/error-guards` alias; there is no separate
// frontend copy.

import { test } from "tap";
import "agent-doctest/tap";
import { instanceOf, is } from "agent-doctest/check";
import {
  errnoCode,
  isErrnoException,
  toError,
  errorMessage,
} from "../../src/shared/error-guards.js";

// ## errnoCode
//
// Returns the string `.code` of an errno-style throwable — a real fs error, or
// any object duck-typed with a string `code`:
void test("Returns the string .code of an errno-style throwable — a real fs error, or an...", async (t) => {
  // doctest:L25
  const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
  t.check(errnoCode(enoent), "ENOENT");

  // doctest:L29
  t.check(errnoCode({ code: "EEXIST" }), "EEXIST");
});

// Returns `undefined` for anything without a string `code` — a plain Error, a
// non-object throwable, `null`/`undefined`, or a non-string `code`:
void test("Returns undefined for anything without a string code — a plain Error, a non-o...", async (t) => {
  // doctest:L37
  t.check(errnoCode(new Error("boom")), undefined);

  // doctest:L40
  t.check(errnoCode("just a string"), undefined);

  // doctest:L43
  t.check(errnoCode(null), undefined);

  // doctest:L46
  t.check(errnoCode({ code: 42 }), undefined);
});

// ## isErrnoException
//
// A type guard for callers that need the fuller `ErrnoException` shape
// (`.syscall`, `.path`, `.errno`), not just `.code`. Requires an actual `Error`
// with a string `code` — a bare object with a `code` is not one:
void test("A type guard for callers that need the fuller ErrnoException shape (.syscall,...", async (t) => {
  // doctest:L57
  const err = Object.assign(new Error("nope"), { code: "EACCES", syscall: "open" });
  t.check(isErrnoException(err), true);

  // doctest:L61
  t.check(isErrnoException(new Error("boom")), false);

  // doctest:L64
  t.check(isErrnoException({ code: "ENOENT" }), false);
});

// ## toError
//
// An `Error` passes through unchanged — same identity, so a caller can rethrow it
// or branch on `instanceof`:
void test("An Error passes through unchanged — same identity, so a caller can rethrow it...", async (t) => {
  // doctest:L74
  const original = new TypeError("bad type");
  t.check(toError(original), is(original));
});

// A non-Error throwable is wrapped in a `NonError`, with the original preserved as
// `.cause`:
void test("A non-Error throwable is wrapped in a NonError, with the original preserved a...", async (t) => {
  // doctest:L83
  const wrapped = toError("plain string throw");
  t.check(wrapped, instanceOf(Error));

  // doctest:L87
  t.check(wrapped, { name: "NonError", message: "plain string throw" });

  // doctest:L93
  t.check(wrapped.cause, "plain string throw");
});

// Non-string throwables render best-effort — an error-shaped object (a plain
// object carrying a string `message`, as some libraries throw) reads like the old
// `(e as Error).message` cast did; other objects serialize as JSON; `undefined`
// stringifies:
void test("Non-string throwables render best-effort — an error-shaped object (a plain ob...", async (t) => {
  // doctest:L103
  t.check(toError({ message: "boom", status: 500 }), {
    name: "NonError",
    message: "boom",
  });

  // doctest:L106
  t.check(toError({ code: "ENOENT", path: "/x" }), {
    name: "NonError",
    message: "{\"code\":\"ENOENT\",\"path\":\"/x\"}",
  });

  // doctest:L109
  t.check(toError(undefined), {
    name: "NonError",
    message: "undefined",
  });
});

// The `.message` is a best-effort string, but `.cause` is the live original
// throwable — a rethrow or a downstream `instanceof`/property check still sees the
// exact value that was thrown:
void test("The .message is a best-effort string, but .cause is the live original throwab...", async (t) => {
  // doctest:L118
  const objThrow = { code: "EEXIST" };
  t.check(toError(objThrow).cause, is(objThrow));
});

// ## errorMessage
//
// The one-liner for message access. An `Error`'s message comes through directly;
// a non-Error throwable renders the same way `toError` would:
void test("The one-liner for message access.", async (t) => {
  // doctest:L129
  t.check(errorMessage(new Error("something failed")), "something failed");

  // doctest:L132
  t.check(errorMessage("thrown string"), "thrown string");

  // doctest:L135
  await t.checkText(errorMessage({ reason: "nope" }), "{\"reason\":\"nope\"}");

  // doctest:L138
  await t.checkText(errorMessage(undefined), "undefined");
});
