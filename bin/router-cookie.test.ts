// Tests for the Set-Cookie Path rewrite (bin/router-cookie.ts) — Track B, chunk
// 2b of callback-box/docs/plans/expose-dev-router.md (iOS session continuity).
//
// Run with:
//   node --import tsx --test bin/router-cookie.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteMobileCookiePath } from "./router-cookie.js";

const WT = { worktree: "main", boxSlug: "test1" };

test("cb_mobile: Path=/<slug> is rewritten to /<worktree>/<slug>, other attrs intact", () => {
  const input = "cb_mobile=abc.def; Path=/test1; HttpOnly; Secure; SameSite=Lax; Max-Age=3600";
  const [out] = rewriteMobileCookiePath(input, WT)!;
  assert.equal(out, "cb_mobile=abc.def; Path=/main/test1; HttpOnly; Secure; SameSite=Lax; Max-Age=3600");
});

test("cb_session with host-wide Path=/ is left untouched (already works behind any prefix)", () => {
  const input = "cb_session=xyz; Path=/; HttpOnly; SameSite=Lax";
  const [out] = rewriteMobileCookiePath(input, WT)!;
  assert.equal(out, input, "Path=/ is not /test1, so the exact-match guard skips it");
});

test("cb_session with a non-root Path=/<slug> WOULD be rewritten (future-proofing)", () => {
  const [out] = rewriteMobileCookiePath("cb_session=xyz; Path=/test1; HttpOnly", WT)!;
  assert.equal(out, "cb_session=xyz; Path=/main/test1; HttpOnly");
});

test("an unrelated cookie is never touched, even with Path=/<slug>", () => {
  const input = "othercookie=v; Path=/test1; HttpOnly";
  const [out] = rewriteMobileCookiePath(input, WT)!;
  assert.equal(out, input);
});

test("only the box's OWN Path is rewritten — a different Path is left alone", () => {
  const input = "cb_mobile=abc; Path=/other; HttpOnly";
  const [out] = rewriteMobileCookiePath(input, WT)!;
  assert.equal(out, input, "Path=/other is not /test1");
});

test("Path attribute is matched case- and space-insensitively", () => {
  assert.equal(
    rewriteMobileCookiePath("cb_mobile=abc; path=/test1; HttpOnly", WT)![0],
    "cb_mobile=abc; Path=/main/test1; HttpOnly",
  );
  assert.equal(
    rewriteMobileCookiePath("cb_mobile=abc;PATH = /test1;HttpOnly", WT)![0],
    "cb_mobile=abc;Path=/main/test1;HttpOnly",
  );
});

test("an array of Set-Cookie headers is rewritten per-entry; a plain string is normalized to an array", () => {
  const out = rewriteMobileCookiePath(
    ["cb_mobile=a; Path=/test1; HttpOnly", "cb_session=b; Path=/; HttpOnly", "other=c; Path=/test1"],
    WT,
  );
  assert.deepEqual(out, [
    "cb_mobile=a; Path=/main/test1; HttpOnly",
    "cb_session=b; Path=/; HttpOnly",
    "other=c; Path=/test1",
  ]);
  assert.deepEqual(rewriteMobileCookiePath("cb_mobile=a; Path=/test1", WT), ["cb_mobile=a; Path=/main/test1"]);
});

test("a cb_mobile with no Path attribute is left unchanged", () => {
  const input = "cb_mobile=abc; HttpOnly; SameSite=Lax";
  assert.equal(rewriteMobileCookiePath(input, WT)![0], input);
});

test("undefined Set-Cookie stays undefined", () => {
  assert.equal(rewriteMobileCookiePath(undefined, WT), undefined);
});
