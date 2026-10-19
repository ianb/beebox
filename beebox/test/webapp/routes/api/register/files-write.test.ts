// # Files API — writes, conflicts, commits
//
// `PUT /api/files/*` creates or overwrites; `POST /api/files/*` appends;
// both accept etag preconditions for mid-air collision detection and return
// the file's new metadata. `POST /api/files-commit` commits a file and its
// attachments — nothing else. Writes never auto-commit (interactive views
// are chatty); git state rides on view metadata instead.

import { test } from "tap";
import "agent-doctest/tap";
import { any, capture, not } from "agent-doctest/check";
import { z } from "zod";
import { makeTestServer, type InjectResult } from "../../../../helpers/test-route-server.js";
import { getStatus } from "../../../../../src/lib/git/core/operations.js";

// The `/api/views/:id/cards` response: each file with its git status.
const ViewCards = z.object({ files: z.array(z.looseObject({ path: z.string(), gitStatus: z.unknown().optional() })) });

const HISTORY = "_content/playground/Playground.attach/sessions/history.jsonl";

// The identity a write or conflict response reports for a file.
function fileIdentity(size: number, etag: unknown) {
  return { path: HISTORY, size, mtimeMs: any(Number).positive(), etag };
}

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
  t.check(res, { statusCode: 201, body: { ok: true, file: fileIdentity(20, any(String)) } });

  // ## POST appends; the returned identity moves

  // doctest:L49
  const appended = await ctx.request({
    method: "POST",
    url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
    payload: { content: '{"summary":"second"}\n' },
  });
  const appendedEtag = capture(any(String));
  t.check(appended, { statusCode: 200, body: { ok: true, file: fileIdentity(41, appendedEtag) } });
  t.check(appendedEtag.value, not(etagOf(res)));

  // ## A write asserting a stale version conflicts with 412 + current state

  // doctest:L67
  const stale = await ctx.request({
    method: "PUT",
    url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
    payload: { content: "clobber" },
    headers: { "if-match": etagOf(res) },
  });
  t.check(stale, {
    statusCode: 412,
    body: { error: "File changed since it was read", current: fileIdentity(41, appendedEtag.value) },
  });

  // doctest:L82
  const fresh = await ctx.request({
    method: "PUT",
    url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
    payload: { content: "rewritten\n" },
    headers: { "if-match": etagOf(appended) },
  });
  const freshEtag = capture(any(String));
  t.check(fresh, { statusCode: 200, body: { ok: true, file: fileIdentity(10, freshEtag) } });

  // ## Create-only (If-None-Match: *) conflicts when the file appeared

  // doctest:L95
  const createOnly = await ctx.request({
    method: "PUT",
    url: "/api/files/_content/playground/Playground.attach/sessions/history.jsonl",
    payload: { content: "x" },
    headers: { "if-none-match": "*" },
  });
  t.check(createOnly, {
    statusCode: 412,
    body: { error: "File already exists", current: fileIdentity(10, freshEtag.value) },
  });

  // ## Cards and escapes are rejected

  // doctest:L111
  t.check(await ctx.request({ method: "PUT", url: "/api/files/_content/notes/A.doc.card", payload: { content: "x" } }), {
    statusCode: 403,
    body: { error: "Card writes go through the card API or bbx create (cards validate)" },
  });

  // doctest:L114
  t.check(
    // Fastify resolves dot-segments before routing, so a traversal never even
    // reaches the handler (404); the handler's own resolve-guard (403) backstops
    // any encoded form that slips through routing.
    await ctx.request({ method: "PUT", url: "/api/files/_content/../../outside.txt", payload: { content: "x" } }),
    { statusCode: 404, body: { error: "Not found" } },
  );

  // A path outside the underscore areas — `src/`, `node_modules/`, or any other
  // root entry — is rejected too, even though it stays inside the box (Track B's
  // namespace fence):

  // doctest:L126
  t.check(await ctx.request({ method: "PUT", url: "/api/files/src/tricks/scripts/x.ts", payload: { content: "x" } }), {
    statusCode: 403,
    body: { error: "Access denied" },
  });

  // ## files-commit sweeps the file's card + attach scope, nothing else

  // doctest:L133
  await ctx.seed("_content/playground/Playground.doc.card", "---\ntitle: Playground\n---\nbody\n");
  await ctx.seed("_content/notes/unrelated.md", "left dirty on purpose\n");
  const commit = await ctx.request({
    method: "POST",
    url: "/api/files-commit",
    payload: { path: "_content/playground/Playground.attach/sessions/history.jsonl", message: "Save session history" },
  });
  t.check(commit, {
    statusCode: 200,
    body: { ok: true, committed: true, hash: any(String).matches(/^[\da-f]{40}$/), paths: ["_content/playground/Playground.doc.card", "_content/playground/Playground.attach"] },
  });

  // doctest:L149
  const status = await getStatus(ctx.boxRoot);
  t.check(status, { staged: [], modified: [], untracked: ["_content/notes/unrelated.md"], clean: false });

  // Committing again with nothing changed is a no-op:

  // doctest:L160
  const again = await ctx.request({
    method: "POST",
    url: "/api/files-commit",
    payload: { path: "_content/playground/Playground.attach/sessions/history.jsonl", message: "noop" },
  });
  t.check(again, { statusCode: 200, body: { ok: true, committed: false, paths: ["_content/playground/Playground.doc.card", "_content/playground/Playground.attach"] } });

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
  t.check(byPath, { "_content/notes/unrelated.md": "untracked", [HISTORY]: undefined });
});
