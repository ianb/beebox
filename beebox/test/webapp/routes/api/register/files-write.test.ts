// # Files API — writes, conflicts, commits
//
// `PUT /api/files/*` creates or overwrites; `POST /api/files/*` appends;
// both accept etag preconditions for mid-air collision detection and return
// the file's new metadata. `POST /api/files-commit` commits a file and its
// attachments — nothing else. Writes never auto-commit (interactive views
// are chatty); git state rides on view metadata instead.

import { test } from "tap";
import "agent-doctest/tap";
import { z } from "zod";
import { makeTestServer, type InjectResult } from "../../../../helpers/test-route-server.js";
import { bodyField } from "../../../../helpers/test-helpers.js";
import { getStatus } from "../../../../../src/lib/git/core/operations.js";

// The `/api/views/:id/cards` response: each file with its git status.
const ViewCards = z.object({ files: z.array(z.looseObject({ path: z.string(), gitStatus: z.unknown().optional() })) });

// The `paths` a commit response lists.
const CommitBody = z.object({ paths: z.array(z.string()) });

// The etag of the file a write response describes.
function etagOf(res: InjectResult): string {
  return z.object({ file: z.object({ etag: z.string() }) }).parse(res.body).file.etag;
}

// ## PUT creates (with parent dirs) and returns the file's identity
void test("PUT creates (with parent dirs) and returns the file's identity", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L30
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "PUT",
    url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
    payload: { content: '{"summary":"first"}\n' },
  });
  t.check(res.statusCode, 201);

  // doctest:L39
  t.check(bodyField(res.body, "file", "path"), "_content/playground/Playground.attach/sessions/history.jsonl");

  // doctest:L42
  t.check(bodyField(res.body, "file", "size"), 20);

  // ## POST appends; the returned identity moves

  // doctest:L49
  const appended = await ctx.request({
    method: "POST",
    url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
    payload: { content: '{"summary":"second"}\n' },
  });
  t.check(appended.statusCode, 200);

  // doctest:L57
  t.check(bodyField(appended.body, "file", "size"), 41);

  // doctest:L60
  await t.checkText(bodyField(appended.body, "file", "etag") !== bodyField(res.body, "file", "etag"), "true");

  // ## A write asserting a stale version conflicts with 412 + current state

  // doctest:L67
  const stale = await ctx.request({
    method: "PUT",
    url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
    payload: { content: "clobber" },
    headers: { "if-match": etagOf(res) },
  });
  t.check(stale.statusCode, 412);

  // doctest:L76
  t.check(bodyField(stale.body, "error"), "File changed since it was read");

  // doctest:L79
  await t.checkText(bodyField(stale.body, "current", "etag") === bodyField(appended.body, "file", "etag"), "true");

  // doctest:L82
  const fresh = await ctx.request({
    method: "PUT",
    url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
    payload: { content: "rewritten\n" },
    headers: { "if-match": etagOf(appended) },
  });
  t.check(fresh.statusCode, 200);

  // ## Create-only (If-None-Match: *) conflicts when the file appeared

  // doctest:L95
  const createOnly = await ctx.request({
    method: "PUT",
    url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
    payload: { content: "x" },
    headers: { "if-none-match": "*" },
  });
  t.check(createOnly.statusCode, 412);

  // doctest:L104
  t.check(bodyField(createOnly.body, "error"), "File already exists");

  // ## Cards and escapes are rejected

  // doctest:L111
  t.check((await ctx.request({ method: "PUT", url: "/api/files/_content/notes/A.doc.card", payload: { content: "x" } })).statusCode, 403);

  // doctest:L114
  t.check(
    // Fastify resolves dot-segments before routing, so a traversal never even
    // reaches the handler (404); the handler's own resolve-guard (403) backstops
    // any encoded form that slips through routing.
    (await ctx.request({ method: "PUT", url: "/api/files/_content/../../outside.txt", payload: { content: "x" } })).statusCode,
    404,
  );

  // A path outside the underscore areas — `src/`, `node_modules/`, or any other
  // root entry — is rejected too, even though it stays inside the box (Track B's
  // namespace fence):

  // doctest:L126
  t.check((await ctx.request({ method: "PUT", url: "/api/files/src/tricks/scripts/x.ts", payload: { content: "x" } })).statusCode, 403);

  // ## files-commit sweeps the file's card + attach scope, nothing else

  // doctest:L133
  await ctx.seed("_content/playground/Playground.doc.card", "---\ntitle: Playground\n---\nbody\n");
  await ctx.seed("_content/notes/unrelated.md", "left dirty on purpose\n");
  const commit = await ctx.request({
    method: "POST",
    url: "/api/files-commit",
    payload: { path: "_content/playground/Playground.attach/sessions/history.jsonl", message: "Save session history" },
  });
  t.check(commit.statusCode, 200);

  // doctest:L143
  t.check(bodyField(commit.body, "committed"), true);

  // doctest:L146
  t.check(CommitBody.parse(commit.body).paths.join(", "), "_content/playground/Playground.doc.card, _content/playground/Playground.attach");

  // doctest:L149
  const status = await getStatus(ctx.boxRoot);
  await t.checkText(status.untracked.some((p) => p.includes("unrelated")), "true");

  // doctest:L153
  await t.checkText(status.untracked.some((p) => p.includes("Playground")), "false");

  // Committing again with nothing changed is a no-op:

  // doctest:L160
  const again = await ctx.request({
    method: "POST",
    url: "/api/files-commit",
    payload: { path: "_content/playground/Playground.attach/sessions/history.jsonl", message: "noop" },
  });
  t.check(bodyField(again.body, "committed"), false);

  // ## View metadata carries gitStatus until a commit clears it

  // doctest:L172
  await ctx.seedView("pg.tsx", `
export const name = "PG";
export const description = "pg";
export const dependencies = ["_content/playground/**/*.jsonl", "_content/notes/**/*.md"];
export const modes = ["page"];
export default function PG() { return null; }
`);
  const data = await ctx.request({ method: "GET", url: "/api/views/pg/cards" });
  const byPath = Object.fromEntries(ViewCards.parse(data.body).files.map((f) => [f.path, f.gitStatus]));
  t.check(byPath["_content/notes/unrelated.md"], "untracked");

  // doctest:L184
  t.check(byPath["_content/playground/Playground.attach/sessions/history.jsonl"], undefined);
});
