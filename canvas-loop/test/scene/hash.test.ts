// Structural keys: equal data gives equal keys, even when hashing re-enters.
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyOf } from "../../src/scene/hash.js";

test("a getter that hashes other data does not change the outer key", () => {
  const plain = { x: 2, y: 3 };
  const reentrant = {
    x: 2,
    get y(): number {
      keyOf({ z: 9 });
      return 3;
    },
  };
  assert.equal(keyOf(reentrant), keyOf(plain));
});
