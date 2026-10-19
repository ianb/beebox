// # Issue category navigation
//
// The category at or immediately before the sticky navigation offset is active.
// Before the first section reaches that offset, the first category remains active.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { activeCategoryAtOffset, issueCategoryId } from "../../../src/frontend/lib/issue-category-nav.js";

const categories = [
  { name: "features", top: 48 },
  { name: "bugs", top: 640 },
  { name: "decisions", top: 980 },
];

void test("line 16", async (t) => {
  // doctest:L17
  t.check(activeCategoryAtOffset(categories, { offset: 0, atEnd: false }), "features");
});

void test("line 21", async (t) => {
  // doctest:L22
  t.check(activeCategoryAtOffset(categories, { offset: 700, atEnd: false }), "bugs");
});

void test("line 26", async (t) => {
  // doctest:L27
  t.check(activeCategoryAtOffset(categories, { offset: 1200, atEnd: false }), "decisions");
});

void test("line 31", async (t) => {
  // doctest:L32
  t.check(activeCategoryAtOffset(categories, { offset: 700, atEnd: true }), "decisions");
});

void test("line 36", async (t) => {
  // doctest:L37
  t.check(issueCategoryId("docs & chores"), "issue-category-docs%20%26%20chores");
});
