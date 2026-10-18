// t.check's types: each line marked @ts-expect-error must be a type error,
// and every other line must compile. The typecheck (`pnpm typecheck`) runs
// this file; running it under tap also checks the expected values pass.

import { test } from "tap";
import "../../src/tap-check/tap.js";
import { any, capture, containing, isoDate, oneOf, optional, others, str, unordered, uuid } from "../../src/exports/check.js";

const ID = "0b9c6f0e-6c43-4c8e-9a52-0d6a7c1d2e3f";

interface Session {
  deviceId: string;
  createdBy: string | null;
  exp: number;
  status: "open" | "closed";
  note?: string;
}

const session: Session = { deviceId: ID, createdBy: null, exp: 1, status: "open" };

void test("expected values that compile", async (t) => {
  t.check(session, { deviceId: uuid(), createdBy: null, exp: any(Number).int(), status: "open" });
  t.check({ ...session, createdBy: "x@example.com" }, { deviceId: str`${uuid()}`, createdBy: capture(any(String).startsWith("x")), exp: 1, status: oneOf("open", "closed"), note: optional(any(String)) });
  t.check(session, { deviceId: ID, createdBy: null, exp: 1, status: "open", [others]: any(String) });
  t.check([session], unordered([{ deviceId: ID, createdBy: null, exp: 1, status: "open" }]));
  t.check([session], containing([{ deviceId: ID, createdBy: null, exp: 1, status: "open" }]));
  t.check({ at: new Date(0) }, { at: isoDate() });
  t.check({ at: new Date(0) }, { at: "1970-01-01T00:00:00.000Z" });
});

// Type-only: these checks would fail at run time, so the test is skipped.
void test("expected values that must not compile", { skip: "type errors only" }, async (t) => {
  // An item key the element type does not have.
  // @ts-expect-error -- 'extra' does not exist
  t.check([session], containing([{ deviceId: ID, createdBy: null, exp: 1, status: "open", extra: 1 }]));
  // @ts-expect-error -- 'extra' does not exist
  t.check([session], unordered([{ deviceId: ID, createdBy: null, exp: 1, status: "open", extra: 1 }]));
  // @ts-expect-error -- a number where the element is a string
  t.check(["a"], unordered([1]));
  // A misspelled key.
  // @ts-expect-error 'deviceID' does not exist
  t.check(session, { deviceID: ID, createdBy: null, exp: 1, status: "open" });
  // A missing required key.
  // @ts-expect-error Property 'exp' is missing
  t.check(session, { deviceId: ID, createdBy: null, status: "open" });
  // A wrong leaf type.
  // @ts-expect-error Type 'number' is not assignable to type 'string | Pattern<string>'
  t.check(session, { deviceId: 7, createdBy: null, exp: 1, status: "open" });
  // A string pattern in a number position.
  // @ts-expect-error StringPattern is not assignable to number | Pattern<number>
  t.check(session, { deviceId: ID, createdBy: null, exp: any(String), status: "open" });
  // A literal outside the declared union.
  // @ts-expect-error "draft" is not "open" | "closed"
  t.check(session, { deviceId: ID, createdBy: null, exp: 1, status: "draft" });
  // An extra key inside an array element.
  // @ts-expect-error 'extra' does not exist
  t.check([session], [{ deviceId: ID, createdBy: null, exp: 1, status: "open", extra: 1 }]);
  // optional() on a required key.
  // @ts-expect-error Optional is accepted only on an optional property
  t.check(session, { deviceId: optional(any(String)), createdBy: null, exp: 1, status: "open" });
  // A tuple keeps its length.
  // @ts-expect-error readonly [1] is not readonly [1, 2]
  t.check([1, 2] as const, [1]);
  // [others] is typed by the object's values.
  // @ts-expect-error StringPattern is not Pattern<number>
  t.check({ x: 1 } as Record<string, number>, { [others]: any(String) });
  // An extra key inside a nested object.
  // @ts-expect-error 'z' does not exist
  t.check({ a: { b: 1 } }, { a: { b: 1, z: 2 } });
});

void test("a capture's value is typed by its pattern", async (t) => {
  const id = capture(uuid());
  const exp = capture(any(Number));
  t.check(session, { deviceId: id, createdBy: null, exp, status: "open" });
  const idValue: string = id.value;
  const expValue: number = exp.value;
  t.check({ idValue, expValue }, { idValue: ID, expValue: 1 });
});

void test("a capture in the wrong position is a type error", { skip: "type errors only" }, async (t) => {
  const id = capture(uuid());
  // @ts-expect-error Capture<string> is not assignable to number | Pattern<number>
  t.check(session, { deviceId: ID, createdBy: null, exp: id, status: "open" });
});
