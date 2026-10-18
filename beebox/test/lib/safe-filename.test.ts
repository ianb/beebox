// # safeFilename
//
// Converts arbitrary text to a filesystem-safe filename. Strips non-alphanumeric characters (keeping spaces and hyphens), replaces spaces with underscores, and limits to 50 characters.

import { test } from "tap";
import "agent-doctest/tap";
import { safeFilename } from "../../src/lib/safe-filename.js";

// Basic usage — spaces become underscores, punctuation stripped:
void test("Basic usage — spaces become underscores, punctuation stripped:", async (t) => {
  // doctest:L12
  t.check(safeFilename("Hello World!"), "Hello_World");
});

// Leading and trailing underscores are stripped (e.g. `Tax Documents (2)` would otherwise end in `_` after the `)` becomes blank):
void test("Leading and trailing underscores are stripped (e.g.", async (t) => {
  // doctest:L19
  t.check(safeFilename("Tax Documents (2)"), "Tax_Documents_2");

  // doctest:L22
  t.check(safeFilename("  leading spaces"), "leading_spaces");
});

// Hyphens are preserved:
void test("Hyphens are preserved:", async (t) => {
  // doctest:L29
  t.check(safeFilename("follow-up notes"), "follow-up_notes");
});

// Long strings are truncated to 50 characters:
void test("Long strings are truncated to 50 characters:", async (t) => {
  // doctest:L36
  t.check(safeFilename("A".repeat(100)), "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
});

// Falls back to "untitled" when everything is stripped:
void test("Falls back to \"untitled\" when everything is stripped:", async (t) => {
  // doctest:L43
  t.check(safeFilename("!!!"), "untitled");
});

// Custom fallback:
void test("Custom fallback:", async (t) => {
  // doctest:L50
  t.check(safeFilename("...", "unnamed"), "unnamed");
});
