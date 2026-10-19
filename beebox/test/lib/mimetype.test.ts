// # mimetypeToExtension
//
// Tests for the shared MIME-type → extension map. This map is the reconciled
// **union** of two formerly-drifted copies (the CLI `create` command and the
// webapp upload route), so the regression these cases guard is that *both*
// callers' formats still resolve from the single map.

import { test } from "tap";
import "agent-doctest/tap";
import { mimetypeToExtension } from "../../src/lib/mimetype.js";

// ## Formerly CLI-only formats (image/heic, video/*)
void test("Formerly CLI-only formats (image/heic, video/*)", async (t) => {
  // doctest:L15
  t.check(
    ["image/heic", "image/heif", "video/mp4", "video/webm"].map(mimetypeToExtension),
    [".heic", ".heif", ".mp4", ".webm"],
  );
});

// ## Voice capture formats
void test("Voice capture formats", async (t) => {
  // doctest:L29
  t.check(["audio/aac", "audio/x-m4a"].map(mimetypeToExtension), [".aac", ".m4a"]);
});

// ## Formerly webapp-only formats (pdf, text, json)
void test("Formerly webapp-only formats (pdf, text, json)", async (t) => {
  // doctest:L39
  t.check(["application/pdf", "text/plain", "application/json"].map(mimetypeToExtension), [".pdf", ".txt", ".json"]);
});

// ## Unknown type falls back to .bin
void test("Unknown type falls back to .bin", async (t) => {
  // doctest:L51
  t.check(mimetypeToExtension("application/x-nonsense"), ".bin");
});
