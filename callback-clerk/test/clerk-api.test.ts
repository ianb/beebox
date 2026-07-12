import { test } from "tap";
import {
  readEnvelopeData,
  parseDestinationsData,
  parseCommentaryResult,
} from "../src/platform/clerk-api.js";

test("readEnvelopeData unwraps a well-formed tRPC success envelope", async (t) => {
  const env = readEnvelopeData({ result: { data: { destinations: [] } } });
  t.same(env, { ok: true, data: { destinations: [] } });
});

test("readEnvelopeData preserves a null data payload (present, not missing)", async (t) => {
  // `data: null` is a present key — the envelope is well-formed; shape
  // validation downstream decides whether null is acceptable.
  t.same(readEnvelopeData({ result: { data: null } }), { ok: true, data: null });
});

test("readEnvelopeData rejects non-object, missing result, and missing data", async (t) => {
  t.same(readEnvelopeData(null), { ok: false });
  t.same(readEnvelopeData("nope"), { ok: false });
  t.same(readEnvelopeData([]), { ok: false });
  t.same(readEnvelopeData({}), { ok: false });
  t.same(readEnvelopeData({ result: 5 }), { ok: false });
  t.same(readEnvelopeData({ result: {} }), { ok: false });
  // A tRPC error envelope has no `result` — treated as a bad success envelope.
  t.same(readEnvelopeData({ error: { message: "boom" } }), { ok: false });
});

test("parseDestinationsData accepts the current response shape", async (t) => {
  const parsed = parseDestinationsData({
    destinations: [
      { dir: "", label: "root", symbol: null },
      { dir: "store/reading", label: "Reading", symbol: "📚" },
    ],
  });
  t.same(parsed, [
    { dir: "", label: "root", symbol: null },
    { dir: "store/reading", label: "Reading", symbol: "📚" },
  ]);
});

test("parseDestinationsData rejects skewed responses (never a silent undefined)", async (t) => {
  t.equal(parseDestinationsData({}), null, "missing destinations");
  t.equal(parseDestinationsData({ destinations: "nope" }), null, "destinations not an array");
  t.equal(parseDestinationsData({ destinations: [{ dir: 1, label: "x", symbol: null }] }), null, "dir not a string");
  t.equal(parseDestinationsData({ destinations: [{ dir: "d", label: "l", symbol: 5 }] }), null, "symbol wrong type");
  t.equal(parseDestinationsData({ destinations: [{ dir: "d" }] }), null, "missing label");
});

test("parseCommentaryResult accepts the current response shape", async (t) => {
  const parsed = parseCommentaryResult({
    created: ["box/inbox/A.webpage.card", "box/inbox/A.commentary.card"],
    open: "chat?session=new",
  });
  t.same(parsed, {
    created: ["box/inbox/A.webpage.card", "box/inbox/A.commentary.card"],
    open: "chat?session=new",
  });
});

test("parseCommentaryResult rejects skewed responses", async (t) => {
  t.equal(parseCommentaryResult({ open: "x" }), null, "missing created");
  t.equal(parseCommentaryResult({ created: [1], open: "x" }), null, "created entry not a string");
  t.equal(parseCommentaryResult({ created: [], open: 5 }), null, "open not a string");
  t.equal(parseCommentaryResult(null), null, "not a record");
});
