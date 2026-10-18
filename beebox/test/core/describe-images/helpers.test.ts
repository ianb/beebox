// # Describe Images Helpers
//
// Helper utilities for scan-import's Gemini image analysis: image file detection and MIME type mapping.

import { test } from "tap";
import "agent-doctest/tap";
import {
  isImageFile,
  getMimeType,
} from "../../../src/core/describe-images/helpers.js";

// ## Image file detection
//
// Recognizes common image extensions:
void test("Recognizes common image extensions:", async (t) => {
  // doctest:L17
  t.check(isImageFile("photo.jpg"), true);

  // doctest:L20
  t.check(isImageFile("photo.JPEG"), true);

  // doctest:L23
  t.check(isImageFile("document.pdf"), false);
});

// ## MIME type mapping
void test("MIME type mapping", async (t) => {
  // doctest:L30
  t.check(getMimeType("photo.jpg"), "image/jpeg");

  // doctest:L33
  t.check(getMimeType("photo.JPEG"), "image/jpeg");

  // doctest:L36
  t.check(getMimeType("scan.tiff"), "image/jpeg");
});
