/**
 * Tests for routes/scheduler.ts — scheduler log and schedule listing.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "tap";
import "../src/test-lib/tap-check.js";
import "./helpers/check-serializers.js";
import { createTestServer, TEST_SLUG } from "./helpers/test-server.js";

const BASE = `/${TEST_SLUG}`;

test("GET /api/scheduler/log returns empty for no log file", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/scheduler/log` });
    t.check(res, `200\n___"entries": []___`);
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/scheduler/log reads JSONL entries", async (t) => {
  const ctx = await createTestServer();
  try {
    // Write a JSONL log file where the scheduler expects it
    const logDir = join(ctx.boxRoot, ".callback-box");
    await mkdir(logDir, { recursive: true });
    const entries = [
      JSON.stringify({ event: "tick", ts: "2026-01-20T10:00:00Z", result: { scripts: [{ name: "test", status: "ran" }] } }),
      JSON.stringify({ event: "tick", ts: "2026-01-20T11:00:00Z", result: { scripts: [{ name: "test", status: "skipped" }] } }),
    ];
    await writeFile(join(logDir, "scheduler.jsonl"), entries.join("\n") + "\n");

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/scheduler/log` });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.equal(body.entries.length, 2);
    // Newest first
    t.equal(body.entries[0].ts, "2026-01-20T11:00:00Z");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/scheduler/log filters by status", async (t) => {
  const ctx = await createTestServer();
  try {
    const logDir = join(ctx.boxRoot, ".callback-box");
    await mkdir(logDir, { recursive: true });
    const entries = [
      JSON.stringify({ event: "tick", ts: "2026-01-20T10:00:00Z", result: { scripts: [{ name: "test", status: "ran" }] } }),
      JSON.stringify({ event: "tick", ts: "2026-01-20T11:00:00Z", result: { scripts: [{ name: "test", status: "skipped" }] } }),
    ];
    await writeFile(join(logDir, "scheduler.jsonl"), entries.join("\n") + "\n");

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/scheduler/log?status=ran` });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.equal(body.entries.length, 1, "should only return entries with ran status");
    t.equal(body.entries[0].ts, "2026-01-20T10:00:00Z");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/schedules returns empty when no schedules dir", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/schedules` });
    t.check(res, `200\n___"schedules": []___`);
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/schedules lists scheduled script cards", async (t) => {
  const ctx = await createTestServer();
  try {
    const schedulesDir = join(ctx.boxRoot, "config/schedules");
    await mkdir(schedulesDir, { recursive: true });
    await writeFile(
      join(schedulesDir, "test-echo.scheduled-script.card"),
      `<scheduled-script cron="0 * * * *">
  <description>Echo test</description>
  <runs>echo hello</runs>
</scheduled-script>
`,
    );

    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/schedules` });
    // field order: name, description, schedule, scheduleType, enabled, ...
    t.check(res, `200
{
  "schedules": [
    {
      "name": "test-echo",
      "description": "Echo test",
      ___
      "scheduleType": "cron",
      "enabled": true___
    }
  ]
}`);
  } finally {
    await ctx.cleanup();
  }
});
