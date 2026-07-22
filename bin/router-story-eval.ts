// Autosave endpoint for the story-eval review app (dev/story-eval/index.html).
//
// The app is a static page served from disk (router-docs.ts), so it has no
// server of its own. localStorage + manual export were the only persistence,
// which the boxholder found too fragile across a long triage pass ("we should
// really be able to store it somehow as I go"). This module adds ONE narrow
// side-effecting route — POST /<name>/dev/story-eval/save — that atomically
// writes the posted verdicts JSON to a FIXED path inside the checkout:
//   <checkout>/dev/story-eval/verdicts/autosave.json  (a gitignored working file)
//
// Deliberately minimal and fail-closed:
//   * destination is fixed — no part of the path comes from the client
//   * POST only (405 otherwise), and only when the checkout actually has a
//     dev/story-eval/ directory (404 otherwise)
//   * body is JSON.parse-validated (400 on garbage) under a ~2MB cap (413 beyond)
//   * atomic write: temp file in the same dir, then rename
//
// Mirrors router-site.ts's shape: a pure-ish decision/writer (`saveVerdicts`)
// unit-tested directly, plus a thin HTTP glue (`serveStoryEvalSave`) that reads
// the capped body and writes a concise JSON response.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

/** Body size cap for an autosave POST (~2MB). Larger payloads get a 413. */
export const AUTOSAVE_MAX_BYTES = 2 * 1024 * 1024;

export interface SaveOutcome {
  status: number;
  json: Record<string, unknown>;
}

/**
 * Consume an async-iterable request body, refusing once it exceeds `max` bytes.
 * Returns the collected buffer, or the sentinel "too-large" if the cap is passed
 * (we stop consuming at that point — the socket close / GC handles the rest).
 */
export async function readCappedBody(
  req: AsyncIterable<Buffer | Uint8Array>,
  max: number,
): Promise<Buffer | "too-large"> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > max) return "too-large";
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Validate and atomically persist a verdicts payload to the fixed autosave path.
 * Pure except for the fs probe + write; returns the HTTP outcome the caller sends.
 * Check order: method → checkout has dev/story-eval/ → size → JSON validity.
 */
export async function saveVerdicts(params: {
  repoRoot: string;
  method: string | undefined;
  body: Buffer | "too-large";
}): Promise<SaveOutcome> {
  const { repoRoot, method, body } = params;

  if (method !== "POST") {
    return { status: 405, json: { error: "method not allowed", allow: "POST" } };
  }

  const storyEvalDir = path.join(repoRoot, "dev", "story-eval");
  try {
    if (!(await fs.stat(storyEvalDir)).isDirectory()) throw new Error("not a directory");
  } catch {
    return { status: 404, json: { error: "no dev/story-eval/ in this checkout" } };
  }

  if (body === "too-large") {
    return { status: 413, json: { error: "payload too large", maxBytes: AUTOSAVE_MAX_BYTES } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return { status: 400, json: { error: "invalid JSON body" } };
  }

  // Re-serialize the parsed value: canonical formatting, and it proves the body
  // round-trips as JSON before anything touches disk.
  const out = `${JSON.stringify(parsed, null, 2)}\n`;
  const verdictsDir = path.join(storyEvalDir, "verdicts");
  await fs.mkdir(verdictsDir, { recursive: true });
  const dest = path.join(verdictsDir, "autosave.json");
  const tmp = path.join(verdictsDir, `.autosave.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await fs.writeFile(tmp, out, "utf8");
    await fs.rename(tmp, dest); // atomic within the same directory/filesystem
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return { status: 200, json: { ok: true, bytes: Buffer.byteLength(out) } };
}

/**
 * HTTP glue for POST /<name>/dev/story-eval/save. Reads the capped body (only
 * for POST — a non-POST short-circuits to 405 without consuming anything),
 * decides, and writes a concise no-store JSON response.
 */
export async function serveStoryEvalSave(params: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  repoRoot: string;
}): Promise<void> {
  const { req, res, repoRoot } = params;
  const body: Buffer | "too-large" =
    req.method === "POST" ? await readCappedBody(req, AUTOSAVE_MAX_BYTES) : Buffer.alloc(0);
  const outcome = await saveVerdicts({ repoRoot, method: req.method, body });
  res.writeHead(outcome.status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(outcome.status === 405 ? { allow: "POST" } : {}),
  });
  res.end(`${JSON.stringify(outcome.json)}\n`);
}
