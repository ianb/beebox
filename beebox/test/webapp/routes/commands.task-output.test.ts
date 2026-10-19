// # `GET /api/task-output` — box-scoped background-task output reads
//
// Reads a Claude Code background task's output file for the frontend's task
// notification UI (`user-message.tsx`). The route must refuse anything that
// isn't THIS box's own file under the exact tmp-task shape
// `/private/tmp/claude-<uid>/<encoded box cwd>/<session-id>/tasks/<id>.output`
// — see `isTaskOutputPathForBox` (`src/core/chat/session/transcript-paths.ts`,
// covered on its own in `test/core/chat/session/transcript-paths.test.ts`).
// This file drives the route end to end with two real, independent boxes.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTwoBoxTestServer } from "../../helpers/test-server.js";
import { encodeProjectDir } from "../../../src/core/chat/session/transcript-paths.js";

/** A fresh `/tmp/claude-<something>-XXXXXX` tmp-task root — a real directory
 *  directly under `/tmp` (not `os.tmpdir()`, which on macOS is a per-process
 *  `/var/folders/...` path outside the shape the route accepts). */
async function makeClaudeTmpRoot() {
  return fs.mkdtemp("/tmp/claude-task-output-test-");
}

/** Write a task output file at the exact shape the route expects, returning
 *  its absolute path. */
async function writeTaskOutput({ tmpRoot, cwd, session, file, content }: { tmpRoot: string; cwd: string; session?: string; file?: string; content?: string }) {
  const dir = path.join(tmpRoot, encodeProjectDir(cwd), session ?? "sess-1", "tasks");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, file ?? "t1.output");
  await fs.writeFile(filePath, content ?? "task output content");
  return filePath;
}

/** The status and body of an injected response. */
function reply(res: { statusCode: number; payload: string }) {
  return { statusCode: res.statusCode, payload: res.payload };
}

// ## Alpha reads its own task output; beta cannot read it through beta's own request
void test("Alpha reads its own task output; beta cannot read it through beta's own request", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await createTwoBoxTestServer();
  const tmpRoot = await makeClaudeTmpRoot();

  const alphaFile = await writeTaskOutput({ tmpRoot, cwd: ctx.a.boxRoot, content: "alpha's output" });

  const alphaReadsOwn = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(alphaFile)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });

  const betaReadsAlpha = await ctx.server.inject({
    method: "GET",
    url: `/beta/api/task-output?file=${encodeURIComponent(alphaFile)}`,
    headers: { authorization: ctx.b.agentBearerHeader() },
  });
  t.check({ alphaReadsOwn: reply(alphaReadsOwn), betaReadsAlpha: reply(betaReadsAlpha) }, {
    alphaReadsOwn: { statusCode: 200, payload: "alpha's output" },
    betaReadsAlpha: { statusCode: 403, payload: "{\"error\":\"Access denied\"}" },
  });

  // ## A `..` traversal and a foreign encoded-cwd are both refused without touching disk

  const traversal = `${tmpRoot}/${encodeProjectDir(ctx.a.boxRoot)}/sess-1/tasks/../../../../etc/passwd`;
  const traversalRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(traversal)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });

  const foreignCwdPath = path.join(tmpRoot, encodeProjectDir(ctx.b.boxRoot), "sess-1", "tasks", "t1.output");
  const foreignCwdRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(foreignCwdPath)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  t.check({ traversal: reply(traversalRes), foreignCwd: reply(foreignCwdRes) }, {
    traversal: { statusCode: 403, payload: "{\"error\":\"Access denied\"}" },
    foreignCwd: { statusCode: 403, payload: "{\"error\":\"Access denied\"}" },
  });

  // ## A symlink inside alpha's own shape that resolves into beta's task output is refused
  //
  // The literal path matches alpha's shape (so the pre-filesystem check passes),
  // but its target — beta's real output file — does not, so the post-`realpath`
  // re-check must catch it.

  const betaFile = await writeTaskOutput({ tmpRoot, cwd: ctx.b.boxRoot, content: "beta's output" });
  const alphaTasksDir = path.dirname(alphaFile);
  const symlinkPath = path.join(alphaTasksDir, "escape.output");
  await fs.symlink(betaFile, symlinkPath);

  const symlinkRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(symlinkPath)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  t.check(reply(symlinkRes), { statusCode: 403, payload: "{\"error\":\"Access denied\"}" });

  // ## A missing file under alpha's own directory 404s; a request with no `file` 400s

  const missingPath = path.join(alphaTasksDir, "never-written.output");
  const missingRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(missingPath)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });

  const noFileRes = await ctx.server.inject({
    method: "GET",
    url: "/alpha/api/task-output",
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  t.check({ missing: reply(missingRes), noFile: reply(noFileRes) }, {
    missing: { statusCode: 404, payload: "{\"error\":\"Output file not found\"}" },
    noFile: { statusCode: 400, payload: "{\"error\":\"Missing file parameter\"}" },
  });
});
