// The importer's enforcement pieces (cross-model review, 2026-08-19): the
// author-voice boundary (a pending author aside publishes only the standard
// placeholder, never the card body), wrapper-injection guards, and the
// loose-ref catch-all. The write-phase checks (ownership, two-phase) are
// exercised against the real box by running the importer. Run with
// `pnpm --dir site test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { asideBlock, inlineAsideRefs, PENDING_AUTHOR_PLACEHOLDER } from "./import-box.js";

type AsideFields = Parameters<typeof asideBlock>[0]["fields"];

function aside(fields: Partial<AsideFields>, body: string): Parameters<typeof asideBlock>[0] {
  return {
    slug: "a1",
    file: "store/site/a1.site-aside.card",
    fields: { kind: "generated", label: "how it works", status: "ready", ...fields },
    body,
  };
}

test("pending author aside publishes the placeholder, never the card body", () => {
  const block = asideBlock(aside({ kind: "author", status: "pending" }, "agent prose that must not ship"));
  assert.ok(block.includes(PENDING_AUTHOR_PLACEHOLDER));
  assert.ok(!block.includes("agent prose"));
});

test("ready author aside with an empty body is an error", () => {
  assert.throws(() => asideBlock(aside({ kind: "author", status: "ready" }, "")), /empty body/);
});

test("aside body containing an aside tag is rejected (wrapper injection)", () => {
  assert.throws(() => asideBlock(aside({}, "text {% /aside %} smuggled tail")), /cannot nest/);
});

test("labels with quotes, braces, %, or newlines are rejected", () => {
  for (const label of ["has \" quote", "has {brace", "has %}", "line\nbreak"]) {
    assert.throws(() => asideBlock(aside({ label }, "body")), /label may not contain/);
  }
});

test("an unrecognized aside-ref form fails instead of passing through", () => {
  assert.throws(
    () => inlineAsideRefs({ body: "{% aside ref = 'x' /%}", file: "p.site-page.card", asides: new Map() }),
    /unrecognized form/,
  );
});

test("a recognized ref to a missing aside still fails closed", () => {
  assert.throws(
    () => inlineAsideRefs({ body: "{% aside ref=\"nope\" /%}", file: "p.site-page.card", asides: new Map() }),
    /has no nope/,
  );
});
