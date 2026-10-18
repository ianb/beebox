// # mimetypeToExtension
//
// Tests for the shared MIME-type → extension map. This map is the reconciled
// **union** of two formerly-drifted copies (the CLI `create` command and the
// webapp upload route), so the regression these cases guard is that *both*
// callers' formats still resolve from the single map.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { mimetypeToExtension } from "../../src/lib/mimetype.js";

// ## Formerly CLI-only formats (image/heic, video/*)
void test("Formerly CLI-only formats (image/heic, video/*)", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L15
  print(mimetypeToExtension("image/heic"));
  print(mimetypeToExtension("image/heif"));
  print(mimetypeToExtension("video/mp4"));
  await t.checkText(out.with(print(mimetypeToExtension("video/webm"))), `.heic
.heif
.mp4
.webm`);
});

// ## Voice capture formats
void test("Voice capture formats", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L29
  print(mimetypeToExtension("audio/aac"));
  await t.checkText(out.with(print(mimetypeToExtension("audio/x-m4a"))), `.aac
.m4a`);
});

// ## Formerly webapp-only formats (pdf, text, json)
void test("Formerly webapp-only formats (pdf, text, json)", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L39
  print(mimetypeToExtension("application/pdf"));
  print(mimetypeToExtension("text/plain"));
  await t.checkText(out.with(print(mimetypeToExtension("application/json"))), `.pdf
.txt
.json`);
});

// ## Unknown type falls back to .bin
void test("Unknown type falls back to .bin", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L51
  await t.checkText(out.with(print(mimetypeToExtension("application/x-nonsense"))), ".bin");
});
