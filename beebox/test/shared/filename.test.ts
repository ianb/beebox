// # Filename helpers
//
// Shared filename helpers used by both backend (connectors, CLI) and frontend (capture upload).

import { test } from "tap";
import "agent-doctest/tap";
import {
  sanitizeFilenameStem,
  sanitizeFilename,
  splitExtension,
} from "../../src/shared/filename.js";

// ## sanitizeFilenameStem
//
// Sanitizes a display string into a filename stem (no extension). Keeps alphanumerics, underscores, and hyphens; collapses whitespace runs into underscores; strips leading/trailing separators; caps at 50 chars.
void test("Sanitizes a display string into a filename stem (no extension).", async (t) => {
  // doctest:L18
  t.check(sanitizeFilenameStem("Hello World!"), "Hello_World");

  // doctest:L21
  t.check(sanitizeFilenameStem("  leading spaces"), "leading_spaces");
});

// Underscores inside the text are preserved (only punctuation is stripped):
void test("Underscores inside the text are preserved (only punctuation is stripped):", async (t) => {
  // doctest:L28
  t.check(sanitizeFilenameStem("tax_return 2024"), "tax_return_2024");
});

// Falls back to `"untitled"` (or a custom fallback) when nothing survives:
void test("Falls back to \"untitled\" (or a custom fallback) when nothing survives:", async (t) => {
  // doctest:L35
  t.check(sanitizeFilenameStem("!!!"), "untitled");

  // doctest:L38
  t.check(sanitizeFilenameStem("...", { fallback: "unnamed" }), "unnamed");
});

// ## splitExtension
//
// Splits a filename into `{ stem, ext }`, where `ext` includes the leading dot. A leading dot (dotfile) or a name with no dot returns an empty `ext`:
void test("Splits a filename into { stem, ext }, where ext includes the leading dot.", async (t) => {
  // doctest:L47
  t.check(splitExtension("Tax Documents (2).pdf"), {
    stem: "Tax Documents (2)",
    ext: ".pdf",
  });

  // doctest:L50
  t.check(splitExtension("README"), {
    stem: "README",
    ext: "",
  });

  // doctest:L53
  t.check(splitExtension(".gitignore"), {
    stem: ".gitignore",
    ext: "",
  });
});

// ## sanitizeFilename
//
// Sanitizes a full filename including its extension — this is the one used for files uploaded from disk (where we want to preserve `.pdf`, `.jpg`, etc.):
void test("Sanitizes a full filename including its extension — this is the one used for...", async (t) => {
  // doctest:L62
  t.check(sanitizeFilename("Tax Documents (2).pdf"), "Tax_Documents_2.pdf");

  // doctest:L65
  t.check(sanitizeFilename("no-extension-here"), "no-extension-here");
});

// Custom fallback used when the stem would otherwise be empty:
void test("Custom fallback used when the stem would otherwise be empty:", async (t) => {
  // doctest:L72
  t.check(sanitizeFilename("....pdf", { fallback: "upload" }), "upload.pdf");
});
