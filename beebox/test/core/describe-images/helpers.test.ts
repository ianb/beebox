// # Describe Images Helpers
//
// Helper utilities for scan-import's Gemini image analysis: image file detection and MIME type mapping.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  isImageFile,
  getMimeType,
} from "../../../src/core/describe-images/helpers.js";

// ## Image file detection
//
// Recognizes common image extensions:
void test("Recognizes common image extensions:", async (t) => {
  t.check(isImageFile("photo.jpg"), true);

  t.check(isImageFile("photo.JPEG"), true);

  t.check(isImageFile("document.pdf"), false);
});

// ## MIME type mapping
void test("MIME type mapping", async (t) => {
  t.check(getMimeType("photo.jpg"), "image/jpeg");

  t.check(getMimeType("photo.JPEG"), "image/jpeg");

  t.check(getMimeType("scan.tiff"), "image/jpeg");
});
