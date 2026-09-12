// Tests for host-pressure's pure logic: parsing sysctl/vm_stat text, and the
// refuse/warn/proceed decision. No sysctl or vm_stat is invoked. Run with:
//   node --import tsx --test bin/host-pressure.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { MEMORY_PRESSURE_CRITICAL, MEMORY_PRESSURE_WARN, parsePageouts, parsePressureLevel, pressureDecision } from "./host-pressure.js";

// ── parsing ──────────────────────────────────────────────────────────────

test("parsePressureLevel reads sysctl's bare integer", () => {
  assert.equal(parsePressureLevel("1\n"), 1);
  assert.equal(parsePressureLevel("4"), 4);
});

test("parsePressureLevel is null on anything that isn't a number", () => {
  assert.equal(parsePressureLevel(""), null);
  assert.equal(parsePressureLevel("sysctl: unknown oid\n"), null);
});

test("parsePageouts reads vm_stat's Pageouts line", () => {
  const raw = ["Mach Virtual Memory Statistics: (page size of 16384 bytes)", "Pages free:  123456.", "Pageouts:   789.", ""].join("\n");
  assert.equal(parsePageouts(raw), 789);
});

test("parsePageouts is null when the line is missing", () => {
  assert.equal(parsePageouts("Pages free: 1.\n"), null);
});

// ── the refuse/warn/proceed decision ────────────────────────────────────────

test("pressureDecision refuses a full run under critical pressure only", () => {
  assert.equal(pressureDecision({ mode: "full", level: MEMORY_PRESSURE_CRITICAL, ignoreLoad: false }), "refuse");
  assert.equal(pressureDecision({ mode: "selected", level: MEMORY_PRESSURE_CRITICAL, ignoreLoad: false }), "warn");
});

test("pressureDecision warns at warn level for either mode", () => {
  assert.equal(pressureDecision({ mode: "full", level: MEMORY_PRESSURE_WARN, ignoreLoad: false }), "warn");
  assert.equal(pressureDecision({ mode: "selected", level: MEMORY_PRESSURE_WARN, ignoreLoad: false }), "warn");
});

test("pressureDecision proceeds when calm or unknown", () => {
  assert.equal(pressureDecision({ mode: "full", level: 1, ignoreLoad: false }), "proceed");
  assert.equal(pressureDecision({ mode: "full", level: null, ignoreLoad: false }), "proceed");
});

test("ignoreLoad bypasses only the refusal, not the warning", () => {
  // A caller that already gated on load itself (full-suite) still wants to
  // know pressure is up when tap actually runs — it just never wants a
  // silent, no-TAP-output refusal.
  assert.equal(pressureDecision({ mode: "full", level: MEMORY_PRESSURE_CRITICAL, ignoreLoad: true }), "warn");
  assert.equal(pressureDecision({ mode: "full", level: MEMORY_PRESSURE_WARN, ignoreLoad: true }), "warn");
  assert.equal(pressureDecision({ mode: "full", level: 1, ignoreLoad: true }), "proceed");
});
