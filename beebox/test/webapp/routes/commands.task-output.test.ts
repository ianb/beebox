// # `GET /api/task-output` — box-scoped background-task output reads
//
// Reads a Claude Code background task's output file for the frontend's task
// notification UI (`user-message.tsx`). The route must refuse anything that
// isn't THIS box's own file under the exact tmp-task shape
// `/private/tmp/claude-<uid>/<encoded box cwd>/<session-id>/tasks/<id>.output`
// — see `isTaskOutputPathForBox` (`src/core/chat/session/transcript-paths.ts`,
// covered on its own in `test/core/chat/session/transcript-paths.doctest.md`).
// This file drives the route end to end with two real, independent boxes.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTwoBoxTestServer } from "../../helpers/test-server.js";
import { encodeProjectDir } from "../../../src/core/chat/session/transcript-paths.js";

/** A fresh `/tmp/claude-<something>-XXXXXX` tmp-task root — a real directory
 *  directly under `/tmp` (not `os.tmpdir()`, which on macOS is a per-process
 *  `/var/folders/...` path outside the shape the route accepts). */
async function makeClaudeTmpRoot() {
  return fs.mkdtemp("/tmp/claude-task-output-doctest-");
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

// ## Alpha reads its own task output; beta cannot read it through beta's own request
void test("Alpha reads its own task output; beta cannot read it through beta's own request", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await ctx.cleanup();
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L38
  const ctx = await createTwoBoxTestServer();
  const tmpRoot = await makeClaudeTmpRoot();

  // doctest:L41
  const alphaFile = await writeTaskOutput({ tmpRoot, cwd: ctx.a.boxRoot, content: "alpha's output" });

  // doctest:L43
  const alphaReadsOwn = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(alphaFile)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  print(`alpha reads its own: ${alphaReadsOwn.statusCode} ${alphaReadsOwn.payload}`);

  // doctest:L50
  const betaReadsAlpha = await ctx.server.inject({
    method: "GET",
    url: `/beta/api/task-output?file=${encodeURIComponent(alphaFile)}`,
    headers: { authorization: ctx.b.agentBearerHeader() },
  });
  await t.checkText(out.with(print(`beta reads alpha's: ${betaReadsAlpha.statusCode}`)), `alpha reads its own: 200 alpha's output
beta reads alpha's: 403`);

  // ## A `..` traversal and a foreign encoded-cwd are both refused without touching disk

  // doctest:L64
  const traversal = `${tmpRoot}/${encodeProjectDir(ctx.a.boxRoot)}/sess-1/tasks/../../../../etc/passwd`;
  const traversalRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(traversal)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  print(`traversal: ${traversalRes.statusCode}`);

  // doctest:L72
  const foreignCwdPath = path.join(tmpRoot, encodeProjectDir(ctx.b.boxRoot), "sess-1", "tasks", "t1.output");
  const foreignCwdRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(foreignCwdPath)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  await t.checkText(out.with(print(`foreign encoded cwd: ${foreignCwdRes.statusCode}`)), `traversal: 403
foreign encoded cwd: 403`);

  // ## A symlink inside alpha's own shape that resolves into beta's task output is refused
  //
  // The literal path matches alpha's shape (so the pre-filesystem check passes),
  // but its target — beta's real output file — does not, so the post-`realpath`
  // re-check must catch it.

  // doctest:L91
  const betaFile = await writeTaskOutput({ tmpRoot, cwd: ctx.b.boxRoot, content: "beta's output" });
  const alphaTasksDir = path.dirname(alphaFile);
  const symlinkPath = path.join(alphaTasksDir, "escape.output");
  await fs.symlink(betaFile, symlinkPath);

  // doctest:L96
  const symlinkRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(symlinkPath)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  await t.checkText(out.with(print(`symlink into beta's output: ${symlinkRes.statusCode}`)), "symlink into beta's output: 403");

  // ## A missing file under alpha's own directory 404s; a request with no `file` 400s

  // doctest:L109
  const missingPath = path.join(alphaTasksDir, "never-written.output");
  const missingRes = await ctx.server.inject({
    method: "GET",
    url: `/alpha/api/task-output?file=${encodeURIComponent(missingPath)}`,
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  print(`missing file: ${missingRes.statusCode}`);

  // doctest:L117
  const noFileRes = await ctx.server.inject({
    method: "GET",
    url: "/alpha/api/task-output",
    headers: { authorization: ctx.a.agentBearerHeader() },
  });
  await t.checkText(out.with(print(`no file param: ${noFileRes.statusCode}`)), `missing file: 404
no file param: 400`);
});
