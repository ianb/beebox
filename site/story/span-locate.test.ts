import assert from "node:assert/strict";
import { test } from "node:test";
import { locateSpan, countOccurrences } from "./span-locate.js";

test("exact single match → ok, stores the span unchanged", () => {
  const doc = "The quick brown fox.";
  const r = locateSpan(doc, "quick brown");
  assert.equal(r.kind, "ok");
  assert.equal(r.span, "quick brown");
  assert.equal(r.recovered, false);
});

test("exact multiple matches → ambiguous", () => {
  const r = locateSpan("foo bar foo bar", "foo bar");
  assert.equal(r.kind, "ambiguous");
  assert.equal(r.recovered, false);
});

test("whitespace-mangled span → recovered, stores the CANONICAL source text", () => {
  // Source has a wrapped, indented continuation line; the agent dropped the indent.
  const doc = "intro line\n- a rule that spans\n     two indented lines here\nafter";
  const agentSpan = "a rule that spans\ntwo indented lines here"; // indent stripped
  const r = locateSpan(doc, agentSpan);
  assert.equal(r.kind, "ok");
  assert.equal(r.recovered, true);
  // Stored span is the real source bytes, indentation intact — NOT the agent's copy.
  assert.equal(r.span, "a rule that spans\n     two indented lines here");
  assert.ok(doc.includes(r.span), "recovered span must be verbatim in the source");
});

test("newline collapsed to space still recovers", () => {
  const doc = "alpha beta\ngamma delta";
  const r = locateSpan(doc, "beta gamma"); // agent joined across the newline with a space
  assert.equal(r.kind, "ok");
  assert.equal(r.recovered, true);
  assert.equal(r.span, "beta\ngamma"); // canonical: the real newline
});

test("fabricated span (words absent) → missing even under normalization", () => {
  const r = locateSpan("the real source text", "words that never appeared");
  assert.equal(r.kind, "missing");
});

test("reordered words are NOT a match (order preserved)", () => {
  const r = locateSpan("alpha beta gamma", "gamma alpha");
  assert.equal(r.kind, "missing");
});

test("whitespace-tolerant match that is ambiguous → ambiguous", () => {
  const doc = "x y\nx  y"; // two occurrences differing only in whitespace
  const r = locateSpan(doc, "x\ny");
  assert.equal(r.kind, "ambiguous");
});

test("empty / whitespace-only span → missing", () => {
  assert.equal(locateSpan("something", "   \n  ").kind, "missing");
});

test("countOccurrences counts overlaps", () => {
  assert.equal(countOccurrences("aaaa", "aa"), 3);
  assert.equal(countOccurrences("abc", "z"), 0);
});
