/**
 * Tests for routes/admin.ts — box config endpoints (local only).
 *
 * Skips Telegram and Claude Code endpoints (external API calls).
 */

import { test } from "tap";
import "../src/test-lib/tap-check.js";
import "./helpers/check-serializers.js";
import { createTestServer, TEST_SLUG } from "./helpers/test-server.js";

const BASE = `/${TEST_SLUG}`;

test("GET /api/admin/box-config returns defaults when no config exists", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({ method: "GET", url: `${BASE}/api/admin/box-config` });
    t.equal(res.statusCode, 200);
    const body = res.json();
    t.same(body.allowedEmails, [], "should default to empty array");
    t.equal(body.boxSlug, TEST_SLUG);
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/admin/box-config saves allowedEmails", async (t) => {
  const ctx = await createTestServer();
  try {
    const postRes = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/admin/box-config`,
      payload: { allowedEmails: ["alice@example.com", "bob@example.com"] },
    });
    t.check(postRes, `200
{
  "success": true,
  "allowedEmails": [
    "alice@example.com",
    "bob@example.com"
  ]
}`);

    // Verify persisted via GET
    const getRes = await ctx.server.inject({ method: "GET", url: `${BASE}/api/admin/box-config` });
    const getBody = getRes.json();
    t.same(getBody.allowedEmails, ["alice@example.com", "bob@example.com"]);
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/admin/box-config filters out invalid emails", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/admin/box-config`,
      payload: { allowedEmails: ["valid@example.com", "not-an-email", "", "also@valid.org"] },
    });
    t.check(res, `200
{
  "success": true,
  "allowedEmails": [
    "valid@example.com",
    "also@valid.org"
  ]
}`);
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/admin/box-config rejects missing allowedEmails", async (t) => {
  const ctx = await createTestServer();
  try {
    const res = await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/admin/box-config`,
      payload: {},
    });
    t.equal(res.statusCode, 400);
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/admin/box-config preserves other config fields", async (t) => {
  const ctx = await createTestServer();
  try {
    // First set up a config with publicUrl via direct file write
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const configDir = join(ctx.boxRoot, "config");
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(configDir, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(
      join(configDir, "box.json"),
      JSON.stringify({ publicUrl: "https://example.com" }) + "\n",
    );

    // Now update allowedEmails
    await ctx.server.inject({
      method: "POST",
      url: `${BASE}/api/admin/box-config`,
      payload: { allowedEmails: ["user@example.com"] },
    });

    // Verify publicUrl is preserved
    const getRes = await ctx.server.inject({ method: "GET", url: `${BASE}/api/admin/box-config` });
    const body = getRes.json();
    t.same(body.allowedEmails, ["user@example.com"]);
    t.equal(body.publicUrl, "https://example.com", "publicUrl should be preserved");
  } finally {
    await ctx.cleanup();
  }
});
