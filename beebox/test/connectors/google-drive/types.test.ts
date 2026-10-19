// # Drive Types — URL Parsing
//
// Tests for extracting Google Drive file IDs from various URL formats.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { extractDriveFileId } from "../../../src/connectors/google-drive/types.js";

// ## Google Sheets, Docs, Slides and Drive file URLs
//
// All four carry the ID in a `/d/<id>/` segment.
void test("All four carry the ID in a /d/<id>/ segment.", async (t) => {
  t.check(
    extractDriveFileId("https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsT/edit#gid=0")
    ,
    "1aBcDeFgHiJkLmNoPqRsT",
  );
});

// ## Drive open URL with query param
void test("Drive open URL with query param", async (t) => {
  t.check(
    extractDriveFileId("https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRsT")
    ,
    "1aBcDeFgHiJkLmNoPqRsT",
  );
});

// ## Bare file ID
void test("Bare file ID", async (t) => {
  t.check(extractDriveFileId("1aBcDeFgHiJkLmNoPqRsT"), "1aBcDeFgHiJkLmNoPqRsT");
});

// ## Short string is not a file ID
void test("Short string is not a file ID", async (t) => {
  t.check(extractDriveFileId("abc"), null);
});

// ## Random URL is not a file ID
void test("Random URL is not a file ID", async (t) => {
  t.check(
    extractDriveFileId("https://example.com/page")
    ,
    null,
  );
});
