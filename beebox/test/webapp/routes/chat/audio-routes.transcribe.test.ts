// # The HQ transcription route: a permanent failure says so
//
// `POST /api/chat/transcribe-audio` is narration mode's checkpoint pass. When it
// fails, the client falls back to the realtime transcript — right for a bad
// network moment, wrong for a misconfiguration that will fail every single time.
// The route therefore hands the client what the error already knows: whether
// retrying could help (`permanent`) and a stable `code`, so the misconfiguration
// can be shown once and named instead of vanishing into a console warning.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestServer, type TestServer } from "../../../helpers/test-route-server.js";
import { bodyField } from "../../../helpers/test-helpers.js";
import { buildMultipartForm } from "../../../../src/lib/multipart.js";

async function postClip(ctx: TestServer) {
  const { body, boundary } = buildMultipartForm([
    { kind: "file", file: { name: "file", filename: "segment.wav", contentType: "audio/wav", data: Buffer.alloc(64) } },
  ]);
  return ctx.request({
    method: "POST",
    url: "/api/chat/transcribe-audio",
    payload: body,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
}

// ## A service the box has no key for is a permanent, named failure
//
// `mai` is reachable only through OpenRouter, so with an empty secret store the
// pass cannot run — and never will until a key is granted. The body says so.
void test("mai is reachable only through OpenRouter, so with an empty secret store the p...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L37
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  const ctx = await makeTestServer();
  await mkdir(join(ctx.boxRoot, "_config"), { recursive: true });
  await writeFile(join(ctx.boxRoot, "_config/transcription.json"), JSON.stringify({ hqService: "mai" }));

  // doctest:L43
  const res = await postClip(ctx);
  t.check({ status: res.statusCode, code: bodyField(res.body, "code"), permanent: bodyField(res.body, "permanent"), namesTheSecret: /"openrouter"/.test(String(bodyField(res.body, "error"))) }, {
    status: 500,
    code: "missing_openrouter_key",
    permanent: true,
    namesTheSecret: true,
  });
});
