// # Result
//
// `Result<T, E>` (`src/shared/result.ts`) is the one Result convention: a two-arm
// discriminated union keyed on `ok`, with `value` on success and `error` on
// failure. It's for failures the caller branches on; broken invariants and infra
// failures throw instead (see `shared/invariant.ts`).

import { test } from "tap";
import "agent-doctest/tap";
import { ok, err, okVoid, type Result } from "../../src/shared/result.js";

// A tagged error arm — the pattern for a function whose caller acts on the cause.
type LookupError =
  | { cause: "not-found"; key: string }
  | { cause: "parse"; detail: string };

function lookup(store: Record<string, string>, key: string): Result<string, LookupError> {
  if (!(key in store)) return err({ cause: "not-found", key });
  const raw = store[key]!;
  if (raw === "") return err({ cause: "parse", detail: `empty value for ${key}` });
  return ok(raw.toUpperCase());
}

const store = { greeting: "hello", blank: "" };

// ## Constructing and branching
//
// `ok(value)` and `err(error)` build the two arms; branching on `.ok` narrows the
// union so `value`/`error` are only reachable on the matching arm.
void test("ok(value) and err(error) build the two arms; branching on .ok narrows the uni...", async (t) => {
  // doctest:L32
  const found = lookup(store, "greeting");
  t.check(found.ok ? found.value : found.error.cause, "HELLO");
});

// The failure arm carries the tagged error; the caller dispatches on `cause`.
void test("The failure arm carries the tagged error; the caller dispatches on cause.", async (t) => {
  // doctest:L40
  const missing = lookup(store, "absent");
  t.check(missing.ok, false);

  // doctest:L44
  t.check(missing.ok ? "n/a" : `${missing.error.cause}:${missing.error.cause === "not-found" ? missing.error.key : ""}`, "not-found:absent");

  // doctest:L47
  const bad = lookup(store, "blank");
  t.check(bad.ok ? "n/a" : bad.error.cause, "parse");
});

// ## Void success
//
// A function with nothing to return on success uses `Result<void>` and the shared
// `okVoid` marker.
void test("A function with nothing to return on success uses Result<void> and the shared...", async (t) => {
  // doctest:L58
  function ensure(flag: boolean): Result<void> {
    return flag ? okVoid : err("flag was false");
  }

  // doctest:L62
  t.check(ensure(true).ok, true);

  // doctest:L65
  const r = ensure(false);
  t.check(r.ok ? "ok" : r.error, "flag was false");
});
