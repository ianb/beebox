// Unit tests for router-story-eval.ts: the autosave endpoint's validation and
// atomic-write behavior. Mirrors router-site.test.ts's structure — a pure-ish
// decision/writer (`saveVerdicts`) exercised directly, plus the HTTP glue
// (`serveStoryEvalSave`) over a fake req/res. Run with:
//   node --import tsx --test bin/router-story-eval.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  AUTOSAVE_MAX_BYTES,
  readCappedBody,
  saveVerdicts,
  serveStoryEvalSave,
} from "./router-story-eval.js";

// A checkout that has a dev/story-eval/ directory (the precondition for a save).
async function mkStoryEvalCheckout(): Promise<{ repoRoot: string; autosavePath: string }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "router-story-eval-test-"));
  await fs.mkdir(path.join(repoRoot, "dev", "story-eval"), { recursive: true });
  return { repoRoot, autosavePath: path.join(repoRoot, "dev", "story-eval", "verdicts", "autosave.json") };
}

const SAMPLE = { tool: "story-eval", blindMap: { v1: "A" }, docs: { "cloud-honesty": [] } };

// --- saveVerdicts (decision + write) -----------------------------------------

test("saveVerdicts: a valid POST writes autosave.json and returns 200", async () => {
  const { repoRoot, autosavePath } = await mkStoryEvalCheckout();
  const body = Buffer.from(JSON.stringify(SAMPLE), "utf8");
  const out = await saveVerdicts({ repoRoot, method: "POST", body });
  assert.equal(out.status, 200);
  assert.equal(out.json.ok, true);
  const written = JSON.parse(await fs.readFile(autosavePath, "utf8"));
  assert.deepEqual(written, SAMPLE);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("saveVerdicts: the verdicts/ directory is created if absent", async () => {
  const { repoRoot, autosavePath } = await mkStoryEvalCheckout();
  await assert.rejects(fs.stat(path.dirname(autosavePath))); // not there yet
  const out = await saveVerdicts({ repoRoot, method: "POST", body: Buffer.from("{}", "utf8") });
  assert.equal(out.status, 200);
  assert.equal((await fs.stat(path.dirname(autosavePath))).isDirectory(), true);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("saveVerdicts: a non-POST method is 405 and writes nothing", async () => {
  const { repoRoot, autosavePath } = await mkStoryEvalCheckout();
  for (const method of ["GET", "PUT", "DELETE", undefined]) {
    const out = await saveVerdicts({ repoRoot, method, body: Buffer.from("{}", "utf8") });
    assert.equal(out.status, 405);
    assert.equal(out.json.allow, "POST");
  }
  await assert.rejects(fs.stat(autosavePath)); // never created
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("saveVerdicts: a checkout without dev/story-eval/ is 404", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "router-story-eval-nodir-"));
  const out = await saveVerdicts({ repoRoot, method: "POST", body: Buffer.from("{}", "utf8") });
  assert.equal(out.status, 404);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("saveVerdicts: an oversized body is 413 (checked after the dir precondition)", async () => {
  const { repoRoot, autosavePath } = await mkStoryEvalCheckout();
  const out = await saveVerdicts({ repoRoot, method: "POST", body: "too-large" });
  assert.equal(out.status, 413);
  assert.equal(out.json.maxBytes, AUTOSAVE_MAX_BYTES);
  await assert.rejects(fs.stat(autosavePath)); // nothing written
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("saveVerdicts: an invalid JSON body is 400 and writes nothing", async () => {
  const { repoRoot, autosavePath } = await mkStoryEvalCheckout();
  const out = await saveVerdicts({ repoRoot, method: "POST", body: Buffer.from("{not json", "utf8") });
  assert.equal(out.status, 400);
  await assert.rejects(fs.stat(autosavePath));
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("saveVerdicts: a second save overwrites the first (atomic replace)", async () => {
  const { repoRoot, autosavePath } = await mkStoryEvalCheckout();
  await saveVerdicts({ repoRoot, method: "POST", body: Buffer.from(JSON.stringify({ n: 1 }), "utf8") });
  await saveVerdicts({ repoRoot, method: "POST", body: Buffer.from(JSON.stringify({ n: 2 }), "utf8") });
  assert.deepEqual(JSON.parse(await fs.readFile(autosavePath, "utf8")), { n: 2 });
  // no stray temp files left behind
  const leftovers = (await fs.readdir(path.dirname(autosavePath))).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

// --- readCappedBody -----------------------------------------------------------

test("readCappedBody: collects a small body", async () => {
  const src = Readable.from([Buffer.from("ab"), Buffer.from("cd")]);
  const out = await readCappedBody(src, 10);
  assert.equal(out === "too-large" ? out : out.toString(), "abcd");
});

test("readCappedBody: returns the sentinel once the cap is exceeded", async () => {
  const src = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
  const out = await readCappedBody(src, 10);
  assert.equal(out, "too-large");
});

// --- serveStoryEvalSave (HTTP glue over a fake req/res) -----------------------

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(chunk?: string | Buffer): void;
}

function fakeResponse(): FakeResponse {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers ?? {})) this.headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      if (chunk !== undefined) this.body = chunk.toString();
    },
  };
}

// A minimal stand-in for http.IncomingMessage: an async-iterable body + method.
function fakeReq(method: string, body: string): http.IncomingMessage {
  const stream = Readable.from(body ? [Buffer.from(body, "utf8")] : []) as unknown as http.IncomingMessage;
  stream.method = method;
  return stream;
}

test("serveStoryEvalSave: a POST with valid JSON writes the file and 200s (no-store)", async () => {
  const { repoRoot, autosavePath } = await mkStoryEvalCheckout();
  const res = fakeResponse();
  await serveStoryEvalSave({
    req: fakeReq("POST", JSON.stringify(SAMPLE)),
    res: res as unknown as http.ServerResponse,
    repoRoot,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(await fs.readFile(autosavePath, "utf8")), SAMPLE);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveStoryEvalSave: a GET is 405 with an Allow: POST header and no body read", async () => {
  const { repoRoot, autosavePath } = await mkStoryEvalCheckout();
  const res = fakeResponse();
  await serveStoryEvalSave({
    req: fakeReq("GET", ""),
    res: res as unknown as http.ServerResponse,
    repoRoot,
  });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers["allow"], "POST");
  await assert.rejects(fs.stat(autosavePath));
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveStoryEvalSave: a POST with garbage JSON is 400", async () => {
  const { repoRoot } = await mkStoryEvalCheckout();
  const res = fakeResponse();
  await serveStoryEvalSave({
    req: fakeReq("POST", "{not json"),
    res: res as unknown as http.ServerResponse,
    repoRoot,
  });
  assert.equal(res.statusCode, 400);
  await fs.rm(repoRoot, { recursive: true, force: true });
});
