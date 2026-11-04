// # Exhibit comment reads report refusals
//
// The comment list is a read of the CLI store. A CLI refusal cannot appear as
// zero comments, and an app without a workstream cannot read exhibit mail.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "tap";
import "@ianbicking/tap-check/tap";

import { buildExhibitsApp } from "../../src/server/exhibits/app/handler.js";
import { EXHIBITS_COOKIE } from "../../src/server/exhibits/app/auth.js";
import { STORE_MARKER } from "../../src/server/exhibits/store.js";
import { CommentsCliError } from "../../src/server/comments-service.js";

void test("a failed exhibit read stays a 409 and apps are refused", async (t) => {
  const storeRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "exhibit-comment-read-")));
  t.teardown(async () => { await fs.rm(storeRoot, { recursive: true, force: true }); });
  await fs.writeFile(path.join(storeRoot, STORE_MARKER), "");
  await fs.mkdir(path.join(storeRoot, "demo/figure"), { recursive: true });
  const app = await buildExhibitsApp({
    storeRoot,
    appsRoot: path.join(storeRoot, "apps"),
    token: "exhibit-comment-read-token",
    port: 3230,
    runFocus: async () => {},
    comments: {
      add: async () => ({ id: "unused" }),
      forExhibit: async () => { throw new CommentsCliError("store unreadable"); },
    },
    transcribe: { transcribe: async () => ({ text: "" }) },
    createAssets: async () => ({
      transformIndexHtml: async (_url, html) => html,
      preflightModule: async () => {},
      noticeExhibit: () => {},
      handle: (_exchange, next) => next(),
      close: async () => {},
    }),
  });
  t.teardown(async () => { await app.close(); });
  const headers = { cookie: `${EXHIBITS_COOKIE}=exhibit-comment-read-token` };
  const failed = await app.inject({ method: "GET", url: "/api/demo/figure/comments", headers });
  const apps = await app.inject({ method: "GET", url: "/api/apps/other/comments", headers });
  t.check({ failed: [failed.statusCode, failed.json()], apps: [apps.statusCode, apps.json()] }, {
    failed: [409, { message: "Could not read comments.", detail: "bin/comments failed: store unreadable" }],
    apps: [409, { message: "Apps have no comments." }],
  });
});
