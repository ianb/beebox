// Tests for host-pressure's pure logic: parsing sysctl/vm_stat text, and the
// refuse/warn/proceed decision. No sysctl or vm_stat is invoked. Run with:
//   node --import tsx --test bin/host-pressure.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEMORY_PRESSURE_CRITICAL,
  MEMORY_PRESSURE_WARN,
  pageoutRate,
  parsePageouts,
  parsePressureLevel,
  parseSwapFreeBytes,
  pressureDecision,
} from "./host-pressure.js";

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

// ── swap and pageout rate ───────────────────────────────────────────────────

test("parseSwapFreeBytes reads vm.swapusage's free figure in any unit", () => {
  assert.equal(parseSwapFreeBytes("total = 16384.00M  used = 16272.00M  free = 112.00M  (encrypted)\n"), 112 * 1024 ** 2);
  assert.equal(parseSwapFreeBytes("total = 2.00G  used = 0.50G  free = 1.50G  (encrypted)"), 1.5 * 1024 ** 3);
});

test("parseSwapFreeBytes is null on anything else (non-Darwin, error text)", () => {
  assert.equal(parseSwapFreeBytes(""), null);
  assert.equal(parseSwapFreeBytes("sysctl: unknown oid 'vm.swapusage'\n"), null);
});

test("pageoutRate is pages per second between two samples", () => {
  assert.equal(pageoutRate({ pageouts: 1000, atMs: 0 }, { pageouts: 1500, atMs: 5000 }), 100);
  assert.equal(pageoutRate({ pageouts: 1000, atMs: 0 }, { pageouts: 1000, atMs: 5000 }), 0);
});

test("pageoutRate is null when a sample is missing, time stands still, or the counter resets", () => {
  assert.equal(pageoutRate({ pageouts: null, atMs: 0 }, { pageouts: 5, atMs: 1000 }), null);
  assert.equal(pageoutRate({ pageouts: 1, atMs: 0 }, { pageouts: null, atMs: 1000 }), null);
  assert.equal(pageoutRate({ pageouts: 1, atMs: 1000 }, { pageouts: 5, atMs: 1000 }), null);
  assert.equal(pageoutRate({ pageouts: 900, atMs: 0 }, { pageouts: 5, atMs: 1000 }), null);
});
