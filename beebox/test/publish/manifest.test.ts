// # Publication ids
//
// A pub-id names one publication across its `publication` card, its
// R2 keys under `pubs/<pub-id>/`, and the Worker routes. For the `secret` tier the
// id is the capability token, so its shape and entropy are part of the contract.

import { test } from "tap";
import "agent-doctest/tap";
import { generatePubId, pubIdSchema } from "../../src/publish/manifest.js";

// ## `generatePubId` produces a value the schema accepts
//
// The id is 26 base32 characters, and two calls differ (128 bits of entropy make a
// collision cryptographically impossible). We assert shape, not the random value.
void test("The id is 26 base32 characters, and two calls differ (128 bits of entropy mak...", async (t) => {
  // doctest:L17
  const id = generatePubId();
  await t.checkText(id.length, "26");

  // doctest:L21
  t.check(pubIdSchema.safeParse(id).success, true);

  // doctest:L24
  await t.checkText(generatePubId() === generatePubId(), "false");
});

// A malformed id is rejected: too short with uppercase and a hyphen, uppercase at
// the right length, and the right length with `1`, which is outside the alphabet.
void test("A malformed id is rejected:", async (t) => {
  // doctest:L32
  t.check(["TOO-SHORT", "ABCDEFGHIJKLMNOP2345672345", "abcdefghijklmnop2345672341"].map((id) => pubIdSchema.safeParse(id).success), [
    false,
    false,
    false,
  ]);
});
