import assert from "node:assert/strict";
import { test } from "node:test";
import { renderComparedCaveat } from "./docs-compared.js";

const compared = {
  date: "2026-07-04",
  subject: "OpenClaw v0.9",
  beebox: "commit abc123",
  "looked-for": ["memory model", "channels"],
  "not-looked-for": ["pricing"],
};

test("renderComparedCaveat: renders the block, no stale line when recent", () => {
  const lines = renderComparedCaveat(compared, { now: new Date("2026-08-01T00:00:00Z") });
  assert.deepEqual(lines, [
    "Compared: 2026-07-04 — OpenClaw v0.9; Bee Box at commit abc123",
    "Looked for: memory model, channels",
    "Not looked for: pricing",
    "Since then: both projects have changed; treat this page as a snapshot.",
  ]);
});

test("renderComparedCaveat: adds a stale line past 180 days", () => {
  const lines = renderComparedCaveat(compared, { now: new Date("2027-02-01T00:00:00Z") });
  assert.equal(lines.at(-1), "Stale: this comparison is more than six months old.");
});

test("renderComparedCaveat: exactly at the boundary is not yet stale", () => {
  const lines = renderComparedCaveat(compared, { now: new Date("2026-07-05T00:00:00Z") });
  assert.equal(lines.length, 4);
});
