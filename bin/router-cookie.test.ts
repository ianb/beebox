// Tests for the Set-Cookie Path rewrite (bin/router-cookie.ts) — Track B, chunk
// 2b of beebox/docs/implemented-plans/expose-dev-router.md (iOS session continuity).
//
// Run with:
//   node --import tsx --test bin/router-cookie.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteMobileCookiePath } from "./router-cookie.js";

const WT = { worktree: "main", boxSlug: "test1" };

test("bbx_mobile: Path=/<slug> is rewritten to the worktree base /<worktree> (covers dev assets), other attrs intact", () => {
  const input = "bbx_mobile=abc.def; Path=/test1; HttpOnly; Secure; SameSite=Lax; Max-Age=3600";
  const [out] = rewriteMobileCookiePath(input, WT)!;
  assert.equal(out, "bbx_mobile=abc.def; Path=/main; HttpOnly; Secure; SameSite=Lax; Max-Age=3600");
});

test("bbx_session with host-wide Path=/ is left untouched (already works behind any prefix)", () => {
  const input = "bbx_session=xyz; Path=/; HttpOnly; SameSite=Lax";
  const [out] = rewriteMobileCookiePath(input, WT)!;
  assert.equal(out, input, "Path=/ is not /test1, so the exact-match guard skips it");
});

test("bbx_session with a non-root Path=/<slug> WOULD be rewritten (future-proofing)", () => {
  const [out] = rewriteMobileCookiePath("bbx_session=xyz; Path=/test1; HttpOnly", WT)!;
  assert.equal(out, "bbx_session=xyz; Path=/main; HttpOnly");
});

test("an unrelated cookie is never touched, even with Path=/<slug>", () => {
  const input = "othercookie=v; Path=/test1; HttpOnly";
  const [out] = rewriteMobileCookiePath(input, WT)!;
  assert.equal(out, input);
});

test("only the box's OWN Path is rewritten — a different Path is left alone", () => {
  const input = "bbx_mobile=abc; Path=/other; HttpOnly";
  const [out] = rewriteMobileCookiePath(input, WT)!;
  assert.equal(out, input, "Path=/other is not /test1");
});

test("Path attribute is matched case- and space-insensitively", () => {
  assert.equal(
    rewriteMobileCookiePath("bbx_mobile=abc; path=/test1; HttpOnly", WT)![0],
    "bbx_mobile=abc; Path=/main; HttpOnly",
  );
  assert.equal(
    rewriteMobileCookiePath("bbx_mobile=abc;PATH = /test1;HttpOnly", WT)![0],
    "bbx_mobile=abc;Path=/main;HttpOnly",
  );
});

test("an array of Set-Cookie headers is rewritten per-entry; a plain string is normalized to an array", () => {
  const out = rewriteMobileCookiePath(
    ["bbx_mobile=a; Path=/test1; HttpOnly", "bbx_session=b; Path=/; HttpOnly", "other=c; Path=/test1"],
    WT,
  );
  assert.deepEqual(out, [
    "bbx_mobile=a; Path=/main; HttpOnly",
    "bbx_session=b; Path=/; HttpOnly",
    "other=c; Path=/test1",
  ]);
  assert.deepEqual(rewriteMobileCookiePath("bbx_mobile=a; Path=/test1", WT), ["bbx_mobile=a; Path=/main"]);
});

test("a bbx_mobile with no Path attribute is left unchanged", () => {
  const input = "bbx_mobile=abc; HttpOnly; SameSite=Lax";
  assert.equal(rewriteMobileCookiePath(input, WT)![0], input);
});

test("undefined Set-Cookie stays undefined", () => {
  assert.equal(rewriteMobileCookiePath(undefined, WT), undefined);
});
