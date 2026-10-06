import assert from "node:assert/strict";
import test from "node:test";
import { classifyFailure, packageRelative, parseTapFiles, repoRelative } from "./test-ledger-lib.js";

// Roots mirror the `include` globs of beebox/.taprc; see TEST_FILE_ROOTS.

test("accepts every test root .taprc includes, passing and failing", () => {
  const raw = [
    "ok 1 - src/frontend/test/dev/vite-proxy.public-assets.doctest.md # time=10ms",
    "not ok 2 - src/frontend/test/ui/x.test.ts # time=20ms",
    "ok 3 - ../bin/test/agent-quotas.doctest.md # time=30ms",
    "not ok 4 - ../bin/test/lib/y.doctest.md # time=40ms",
  ].join("\n");
  assert.deepEqual(parseTapFiles(raw), [
    { file: "src/frontend/test/dev/vite-proxy.public-assets.doctest.md", ok: true, ms: 10 },
    { file: "src/frontend/test/ui/x.test.ts", ok: false, ms: 20 },
    { file: "../bin/test/agent-quotas.doctest.md", ok: true, ms: 30 },
    { file: "../bin/test/lib/y.doctest.md", ok: false, ms: 40 },
  ]);
});

test("rejects top-level lines that are not under a test root", () => {
  const raw = [
    "ok 1 - src/frontend/components/Button.tsx # time=1ms",
    "ok 2 - (unnamed test)",
    "ok 3 - bin/test/x.doctest.md",
  ].join("\n");
  assert.deepEqual(parseTapFiles(raw), []);
});

test("graph paths and tap names convert both ways, so frontend and bin failures classify", () => {
  assert.equal(packageRelative("beebox/src/frontend/test/a.doctest.md"), "src/frontend/test/a.doctest.md");
  assert.equal(packageRelative("bin/test/lib/c.doctest.md"), "../bin/test/lib/c.doctest.md");
  for (const path of ["beebox/src/frontend/test/a.doctest.md", "bin/test/lib/c.doctest.md", "beebox/test/a.test.ts"]) {
    assert.equal(repoRelative(packageRelative(path)), path);
  }
  const implicated = new Set(["src/frontend/test/a.doctest.md"]);
  assert.equal(classifyFailure({ file: "src/frontend/test/a.doctest.md", implicated }), "attached");
});
