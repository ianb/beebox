# Publication leak scan

`scanBundle` (Track E of `docs/plans/publish-pages.md`) is a **pure** scan over a
rendered bundle's file map. It reports *findings, not a boolean* — each finding
carries a stable id an operator can wave through with `cb pub draft
--accept-leak <id>`. It scans only text entries; binary entries are skipped and
listed. These examples pin one fixture per pattern class, the clean case, the
binary-skip case, and the stable-id contract.

```ts setup
import { scanBundle } from "../../src/publish/leak-scan.js";

// Convenience: scan a single text file with no owner/allowlist context.
function scanOne(text) {
  return scanBundle(new Map([["index.html", text]]), { ownerEmail: null, allowedEmails: [] });
}

// A real home path, built by concatenation so the literal `/Users/<name>/`
// never appears in this file (which would trip the repo's own path-leak-check
// hook — the very shape this fixture is here to exercise).
const REAL_HOME = "/Users/" + "janedoe" + "/";
```

## Home-directory paths are flagged (placeholders are not)

The `/Users/<name>/` and `/home/<name>/` shapes are document-copied from
`bin/path-leak-check.ts`. A real name trips it; the `me`/`you`/`user`/`x`
placeholders don't.

```ts
const home = scanOne("Saved to " + REAL_HOME + "secrets/notes.md and /Users/me/ok.md");
home.findings.length
=> 1

home.findings[0].kind
=> home-path

home.findings[0].match === REAL_HOME
=> true
```

## A foreign email is flagged; the owner and allowlist are not

The publication's own allowlist and the box owner are passed in and treated as
expected content.

```ts
const files = new Map([["index.html", "Contact owner@box.test, viewer@allowed.test, or stranger@elsewhere.test."]]);
const res = scanBundle(files, { ownerEmail: "owner@box.test", allowedEmails: ["viewer@allowed.test"] });

res.findings.map((f) => f.kind + ":" + f.match).join(", ")
=> email:stranger@elsewhere.test
```

## Each credential shape is flagged

One fixture per shape in the named credential table. Strings are built by
construction so each matches exactly its intended pattern.

```ts
scanOne("key=" + "AIza" + "a".repeat(35)).findings[0].detail
=> Google API key

scanOne("token " + "sk-" + "a".repeat(24)).findings[0].detail
=> OpenAI API key

scanOne("auth " + "ghp_" + "a".repeat(36)).findings[0].detail
=> GitHub token

scanOne("slack " + "xoxb-" + "a".repeat(20)).findings[0].detail
=> Slack token

scanOne("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r").findings[0].detail
=> JWT

scanOne("blob " + "a".repeat(48)).findings[0].detail
=> long base64/hex run
```

## An absolute http(s) reference is flagged (the self-containment / CSP check)

```ts
const url = scanOne('See <a href="https://evil.example.com/x">here</a>.');
url.findings[0].kind
=> external-url

url.findings[0].match
=> https://evil.example.com/x
```

An inlined `data:` image does NOT trip the base64 catch-all — the payload is
masked before that pattern runs, so an ordinary doc bundle with an inline image
scans clean.

```ts
scanOne('<img src="data:image/png;base64,' + "A".repeat(200) + '">').findings.length
=> 0
```

## A clean bundle produces no findings

```ts
const clean = scanOne("<h1>Build Journal</h1><p>Plain prose, nothing sensitive.</p>");
clean.findings.length
=> 0

clean.scannedFiles.join(",")
=> index.html

clean.skippedBinaries.length
=> 0
```

## Binary entries are skipped and listed, never scanned

A screenshot of a key ships clean (the plan's finding-#8 blind spot): binary
bytes are not regexed. The bytes below spell an API-key shape, yet produce no
finding — but the file IS listed as an unscanned binary so the preview can warn.

```ts
const bundle = new Map([
  ["index.html", "<p>All good.</p>"],
  ["assets/shot.png", new TextEncoder().encode("AIza" + "a".repeat(35))],
]);
const mixed = scanBundle(bundle, { ownerEmail: null, allowedEmails: [] });

mixed.findings.length
=> 0

mixed.scannedFiles.join(",")
=> index.html

mixed.skippedBinaries.join(",")
=> assets/shot.png
```

## Finding ids are stable — the anchor `--accept-leak` references

The id is a hash of (kind, file, match), so the same input yields the same id
across runs. That is what lets an operator accept a specific finding by id.

```ts
const a = scanOne("home " + REAL_HOME + "x/");
const b = scanOne("home " + REAL_HOME + "x/");

/^[\da-f]{12}$/.test(a.findings[0].id)
=> true

a.findings[0].id === b.findings[0].id
=> true
```
