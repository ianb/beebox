// # Publication leak scan
//
// `scanBundle` is a **pure** scan over a prepared release's file map. It reports
// *findings, not a boolean* — each finding carries a stable id, so an unchanged
// finding keeps its identity across preparations. It scans only text entries;
// binary entries are skipped and listed. These examples pin one fixture per pattern class, the clean case, the
// binary-skip case, and the stable-id contract.

import { test } from "tap";
import "agent-doctest/tap";
import { scanBundle } from "../../src/publish/leak-scan.js";

// Convenience: scan a single text file with no owner/allowlist context.
function scanOne(text: string) {
  return scanBundle(new Map([["index.html", text]]), { ownerEmail: null, allowedEmails: [] });
}

// A real home path, built by concatenation so the literal `/Users/<name>/`
// never appears in this file (which would trip the repo's own path-leak-check
// hook — the very shape this fixture is here to exercise).
const REAL_HOME = "/Users/" + "janedoe" + "/";

// ## Home-directory paths are flagged (placeholders are not)
//
// The `/Users/<name>/` and `/home/<name>/` shapes are document-copied from
// `bin/path-leak-check.ts`. A real name trips it; the `me`/`you`/`user`/`x`
// placeholders don't.
void test("The /Users/<name>/ and /home/<name>/ shapes are document-copied from bin/path...", async (t) => {
  // doctest:L30
  const home = scanOne("Saved to " + REAL_HOME + "secrets/notes.md and /Users/me/ok.md");
  await t.checkText(home.findings.length, "1");

  // doctest:L34
  t.check(home.findings[0]?.kind, "home-path");

  // doctest:L37
  await t.checkText(home.findings[0]?.match === REAL_HOME, "true");
});

// ## A foreign email is flagged; the owner and allowlist are not
//
// The publication's own allowlist and the box owner are passed in and treated as
// expected content.
void test("The publication's own allowlist and the box owner are passed in and treated a...", async (t) => {
  // doctest:L47
  const files = new Map([["index.html", "Contact owner@box.test, viewer@allowed.test, or stranger@elsewhere.test."]]);
  const res = scanBundle(files, { ownerEmail: "owner@box.test", allowedEmails: ["viewer@allowed.test"] });

  // doctest:L50
  t.check(res.findings.map((f) => f.kind + ":" + f.match).join(", "), "email:stranger@elsewhere.test");
});

// ## Each credential shape is flagged
//
// One fixture per shape in the named credential table. Strings are built by
// construction so each matches exactly its intended pattern.
void test("One fixture per shape in the named credential table.", async (t) => {
  // doctest:L60
  t.check(scanOne("key=" + "AIza" + "a".repeat(35)).findings[0]?.detail, "Google API key");

  // doctest:L63
  t.check(scanOne("token " + "sk-" + "a".repeat(24)).findings[0]?.detail, "OpenAI API key");

  // doctest:L66
  t.check(scanOne("auth " + "ghp_" + "a".repeat(36)).findings[0]?.detail, "GitHub token");

  // doctest:L69
  t.check(scanOne("slack " + "xoxb-" + "a".repeat(20)).findings[0]?.detail, "Slack token");

  // doctest:L72
  t.check(scanOne("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r").findings[0]?.detail, "JWT");

  // doctest:L75
  t.check(scanOne("blob " + "a".repeat(48)).findings[0]?.detail, "long base64/hex run");
});

// ## An absolute http(s) reference is flagged (the self-containment / CSP check)
void test("An absolute http(s) reference is flagged (the self-containment / CSP check)", async (t) => {
  // doctest:L82
  const url = scanOne('See <a href="https://evil.example.com/x">here</a>.');
  t.check(url.findings[0]?.kind, "external-url");

  // doctest:L86
  t.check(url.findings[0]?.match, "https://evil.example.com/x");
});

// An inlined `data:` image does NOT trip the base64 catch-all — the payload is
// masked before that pattern runs, so an ordinary doc bundle with an inline image
// scans clean.
void test("An inlined data: image does NOT trip the base64 catch-all — the payload is ma...", async (t) => {
  // doctest:L95
  await t.checkText(scanOne('<img src="data:image/png;base64,' + "A".repeat(200) + '">').findings.length, "0");
});

// ## A clean bundle produces no findings
void test("A clean bundle produces no findings", async (t) => {
  // doctest:L102
  const clean = scanOne("<h1>Build Journal</h1><p>Plain prose, nothing sensitive.</p>");
  await t.checkText(clean.findings.length, "0");

  // doctest:L106
  t.check(clean.scannedFiles.join(","), "index.html");

  // doctest:L109
  await t.checkText(clean.skippedBinaries.length, "0");
});

// ## Binary entries are skipped and listed, never scanned
//
// A screenshot of a key ships clean (the plan's finding-#8 blind spot): binary
// bytes are not regexed. The bytes below spell an API-key shape, yet produce no
// finding — but the file IS listed as an unscanned binary so the preview can warn.
void test("A screenshot of a key ships clean (the plan's finding-#8 blind spot):", async (t) => {
  // doctest:L120
  const bundle = new Map<string, string | Uint8Array>([
    ["index.html", "<p>All good.</p>"],
    ["assets/shot.png", new TextEncoder().encode("AIza" + "a".repeat(35))],
  ]);
  const mixed = scanBundle(bundle, { ownerEmail: null, allowedEmails: [] });

  // doctest:L126
  await t.checkText(mixed.findings.length, "0");

  // doctest:L129
  t.check(mixed.scannedFiles.join(","), "index.html");

  // doctest:L132
  t.check(mixed.skippedBinaries.join(","), "assets/shot.png");
});

// ## Finding ids are stable
//
// The id is a hash of (kind, file, match), so the same input yields the same id
// across runs. That is what lets a reviewer recognize a finding they already
// judged when the same content is prepared again.
void test("The id is a hash of (kind, file, match), so the same input yields the same id...", async (t) => {
  // doctest:L143
  const a = scanOne("home " + REAL_HOME + "x/");
  const b = scanOne("home " + REAL_HOME + "x/");

  // doctest:L146
  t.check(/^[\da-f]{12}$/.test(a.findings[0]?.id ?? ""), true);

  // doctest:L149
  await t.checkText(a.findings[0]?.id === b.findings[0]?.id, "true");
});
