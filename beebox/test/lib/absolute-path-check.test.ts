// # Absolute machine-path guard
//
// `findAbsoluteMachinePaths` (`src/lib/absolute-path-check.ts`) flags a real
// developer home directory embedded in card content — `bbx validate`'s Track B
// check (`docs/implemented-plans/one-root-box-layout.md`) that a box carries no machine-
// specific paths. Same allowlist shape as the monorepo's `bin/path-leak-check.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { findAbsoluteMachinePaths, redactAbsoluteMachinePaths } from "../../src/lib/absolute-path-check.js";

// A real home path is flagged, macOS and Linux forms alike:
void test("A real home path is flagged, macOS and Linux forms alike:", async (t) => {
  t.check(findAbsoluteMachinePaths("See /Users/beebox/src/boxes/test1 for the fixture."), [
    "/Users/beebox/",
  ]);

  t.check(findAbsoluteMachinePaths("Logs at /home/beebox/.local/share/beebox."), [
    "/home/beebox/",
  ]);
});

// The placeholder names used in `file:` URL examples and docs (`me`, `you`,
// `user`, `x`) are not flagged:
void test("The placeholder names used in file: URL examples and docs (me, you, user, x)...", async (t) => {
  t.check(
    [
      findAbsoluteMachinePaths("open file:///Users/me/Desktop/scan.pdf"),
      findAbsoluteMachinePaths("open file:///Users/you/Desktop/scan.pdf"),
    ],
    [
    [],
    [],
  ],
  );
});

// Text with no absolute path — a box ref, a relative path, prose — carries
// nothing:
void test("Text with no absolute path — a box ref, a relative path, prose — carries noth...", async (t) => {
  t.check(findAbsoluteMachinePaths("See /_content/docs/report.md and ../notes.md."), []);
});

// Multiple leaks in one text are all reported, in order:
void test("Multiple leaks in one text are all reported, in order:", async (t) => {
  t.check(findAbsoluteMachinePaths("/Users/beebox/a and /home/bbx-test1/b"), [
    "/Users/beebox/",
    "/home/bbx-test1/",
  ]);
});

// A path inside a URL is the page's or the tab's own address, not a leak — a
// site whose routes start with `/home/`, or a captured `file://` tab:
void test("A path inside a URL is the page's or the tab's own address, not a leak — a si...", async (t) => {
  // Built at run time: the monorepo's own path-leak check reads test text literally.
  const site = "https://college.example" + "/ho" + "me/";
  t.check(
    [
      findAbsoluteMachinePaths(`Read more at ${site}news/2026/ and ${site}academics/`),
      findAbsoluteMachinePaths("url: file:///Users/beebox/Desktop/notes.html"),
      findAbsoluteMachinePaths("copied to /Users/beebox/Desktop/notes.html"),
    ],
    [
    [],
    [],
    [
      "/Users/beebox/",
    ],
  ],
  );
});

// An ordinary URL can contain a `/home/` route without naming a machine path:
void test("An ordinary URL can contain a /home/ route without naming a machine path:", async (t) => {
  t.check(
    findAbsoluteMachinePaths("See https://example.gov/App/home/section/page")
    ,
    [],
  );
});

// Compact structured text doesn't let an earlier URL hide a later machine path:
void test("Compact structured text doesn't let an earlier URL hide a later machine path:", async (t) => {
  t.check(
    findAbsoluteMachinePaths('{"url":"https://example.gov/home/section","cwd":"/Users/beebox/src"}')
    ,
    [
    "/Users/beebox/",
  ],
  );
});

// Redaction writes each flagged home prefix as `~<name>/`, which the guard
// accepts, and leaves placeholders and URLs as they are. A migration question
// quotes host output this way:
void test("Redaction rewrites flagged home prefixes and nothing else", async (t) => {
  const text = "mirror /home/beebox/.cache/pnpm/x.json; see /Users/me/a and https://college.example/home/admissions/";
  const redacted = redactAbsoluteMachinePaths(text);
  t.check({ redacted, leaks: findAbsoluteMachinePaths(redacted) }, {
    redacted: "mirror ~beebox/.cache/pnpm/x.json; see /Users/me/a and https://college.example/home/admissions/",
    leaks: [],
  });
});
