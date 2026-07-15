/**
 * The submit ("drop box") endpoint — `POST /__submit/<pub-id>` (Track F of
 * `docs/plans/publish-pages.md`). Accepts a constrained urlencoded form, validates
 * every field against the manifest's `submit` block, enforces size + volume
 * limits, and writes an accepted submission to `submissions/<pub-id>/<id>.json`
 * for the box connector to pull. Every failure is fail-closed and typed; every
 * response (including the thank-you page) leaves through `withSecurityHeaders` at
 * the `handle` exit in `index.ts`.
 *
 * Twice-enforced no-public-submit (the Val Town lesson): even though Track A's
 * zod union makes `public` + `submit` unrepresentable, this endpoint independently
 * refuses a `public` manifest or a manifest with no `submit` block — the Worker
 * never trusts its own store.
 */

import {
  submissionSchema,
  validateSubmissionFields,
  type Submission,
} from "../../src/publish/submission";
import type { EdgeManifest, SubmitBlock } from "../../src/publish/manifest-edge";
import { authenticateAccess } from "./access-auth";
import type { WorkerDeps } from "./deps";
import { assertNever } from "./exhaustive";
import type { Env } from "./env";
import { isExpired, loadManifest } from "./manifest-store";
import {
  badRequest,
  forbidden,
  gone,
  notFound,
  payloadTooLarge,
  tooManyRequests,
  unsupportedMediaType,
} from "./responses";

/**
 * A hard pre-parse body ceiling, independent of any manifest — refuse a huge body
 * before buffering intent turns into work. The manifest's own `maxSubmissionBytes`
 * (typically far smaller) is enforced after the manifest loads.
 */
const HARD_BODY_LIMIT_BYTES = 1024 * 1024;

/** If `pathname` is `/__submit/<id>`, return the decoded pub-id; otherwise `null`. */
export function matchSubmitPath(pathname: string): string | null {
  const segments = pathname.split("/");
  segments.shift(); // drop the leading "" (pathname always starts with "/")
  if (segments.length !== 2) return null;
  const [prefix, rawId] = segments;
  if (prefix !== "__submit" || rawId === undefined || rawId.length === 0) return null;
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch (_e) {
    return null; // malformed percent-encoding → not a valid submit target
  }
  // The id addresses R2 keys directly; a separator or NUL would let it escape the
  // `submissions/<id>/` prefix, so refuse those outright (mirrors asset-path.ts).
  if (id.length === 0 || id.includes("/") || id.includes("\\") || id.includes("\0")) return null;
  return id;
}

/**
 * Handle `POST /__submit/<pubId>`. The full fail-closed pipeline; see the module
 * doc for the twice-enforced no-public-submit rule.
 */
export async function handleSubmit({
  request,
  env,
  deps,
  pubId,
}: {
  request: Request;
  env: Env;
  deps: WorkerDeps;
  pubId: string;
}): Promise<Response> {
  // Content-type gate: urlencoded only (v1 is text-only — no multipart uploads).
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.split(";")[0]?.trim().toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return unsupportedMediaType();
  }

  // Hard body ceiling BEFORE parsing. Check the declared length first (cheap), then
  // the actual bytes (authoritative — a client can lie about Content-Length).
  const declaredLength = Number(request.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > HARD_BODY_LIMIT_BYTES) return payloadTooLarge();
  const rawBytes = new Uint8Array(await request.arrayBuffer());
  if (rawBytes.byteLength > HARD_BODY_LIMIT_BYTES) return payloadTooLarge();

  // Manifest: same untrusted-store read as the serve path. Missing/invalid → 404;
  // the tombstone/expiry that kills pages kills submit in the same read → 410.
  const manifest = await loadManifest(pubId, env);
  if (manifest === null) return notFound();
  if (manifest.status === "revoked") return gone();
  if (isExpired(manifest.expiresAt, deps.now())) return gone();

  // Twice-enforced no-public-submit: refuse a public manifest OR a manifest with
  // no submit block, regardless of what the store claims.
  if (manifest.tier === "public") return forbidden();
  const submit: SubmitBlock | null | undefined = manifest.submit;
  if (submit === null || submit === undefined) return forbidden();

  // Submitter identity by tier. `secret` is anonymous; account tiers require a
  // valid Access assertion, and `accounts` additionally requires the allowlist.
  const identity = await resolveSubmitter({ manifest, request, env, deps });
  if (!identity.ok) return identity.response;
  const viewer = identity.viewer;

  // Parse + validate the form against the manifest's submit block.
  const rawFields = parseForm(rawBytes);
  const validated = validateSubmissionFields(submit, rawFields);
  if (!validated.ok) return badRequest(validated.errors.join("\n"));

  // Manifest-specific size ceiling on the raw body.
  if (rawBytes.byteLength > submit.maxSubmissionBytes) return payloadTooLarge();

  // Best-effort daily cap. R2 LIST is eventually consistent, so a burst can
  // momentarily slip past `maxPerDay` — soft/gameable, acceptable at personal
  // scale (a per-pub counter object is the tightening option if abuse appears).
  const todayCount = await countSubmissionsSince({
    env,
    pubId,
    sinceMs: startOfUtcDay(deps.now()),
    cap: submit.maxPerDay,
  });
  if (todayCount >= submit.maxPerDay) return tooManyRequests();

  // Per-IP rate limit via the OPTIONAL Workers binding. Absent in the test pool
  // and unconfigured boxes → skip (the platform 100k/day is the outer backstop).
  const limiter = env.SUBMIT_RATE_LIMITER;
  if (limiter !== undefined) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiter.limit({ key: `${pubId}:${ip}` });
    if (!success) return tooManyRequests();
  }

  // Accept: write the validated submission, then return the thank-you page.
  const submission: Submission = submissionSchema.parse({
    id: deps.newId(),
    ts: new Date(deps.now()).toISOString(),
    pubId,
    fields: validated.fields,
    viewer,
    country: coarseCountry(request),
  });
  await env.PUB_STORE.put(`submissions/${pubId}/${submission.id}.json`, JSON.stringify(submission));
  return thankYou();
}

type SubmitterResult = { ok: true; viewer: string | null } | { ok: false; response: Response };

/** The submitter's `viewer` value by tier, or the fail-closed response to return. */
async function resolveSubmitter({
  manifest,
  request,
  env,
  deps,
}: {
  manifest: Extract<EdgeManifest, { tier: "secret" | "accounts" | "any-account" }>;
  request: Request;
  env: Env;
  deps: WorkerDeps;
}): Promise<SubmitterResult> {
  switch (manifest.tier) {
    case "secret":
      return { ok: true, viewer: null };
    case "accounts": {
      const auth = await authenticateAccess({ request, env, deps });
      if (!auth.ok) return { ok: false, response: auth.response };
      const allowed = manifest.allowedEmails ?? [];
      if (!allowed.includes(auth.email)) return { ok: false, response: forbidden() };
      return { ok: true, viewer: auth.email };
    }
    case "any-account": {
      const auth = await authenticateAccess({ request, env, deps });
      if (!auth.ok) return { ok: false, response: auth.response };
      return { ok: true, viewer: auth.email };
    }
    default:
      return assertNever(manifest);
  }
}

/** Decode the urlencoded body into a flat field bag (last value wins on a repeat). */
function parseForm(rawBytes: Uint8Array): Record<string, string> {
  const text = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(rawBytes);
  const params = new URLSearchParams(text);
  const fields: Record<string, string> = {};
  for (const [name, value] of params) fields[name] = value;
  return fields;
}

/**
 * Count objects under `submissions/<pubId>/` uploaded at/after `sinceMs`, stopping
 * once the count reaches `cap` (no need to enumerate further). R2 LIST is
 * eventually consistent — see the caller's best-effort note.
 */
async function countSubmissionsSince({
  env,
  pubId,
  sinceMs,
  cap,
}: {
  env: Env;
  pubId: string;
  sinceMs: number;
  cap: number;
}): Promise<number> {
  const prefix = `submissions/${pubId}/`;
  let count = 0;
  let cursor: string | undefined;
  do {
    // `exactOptionalPropertyTypes` forbids `cursor: undefined`; omit the key on the
    // first page and supply it only when R2 handed back a continuation token.
    const options = cursor === undefined ? { prefix, limit: 1000 } : { prefix, limit: 1000, cursor };
    const listing = await env.PUB_STORE.list(options);
    for (const object of listing.objects) {
      if (object.uploaded.getTime() >= sinceMs) count++;
      if (count >= cap) return count;
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor !== undefined);
  return count;
}

/** UTC midnight (ms) for the day containing `nowMs`. */
function startOfUtcDay(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Coarse origin: the Cloudflare country (edge-supplied), never an IP. */
function coarseCountry(request: Request): string | null {
  const fromCf = request.cf?.country;
  if (typeof fromCf === "string" && fromCf.length > 0) return fromCf;
  const header = request.headers.get("CF-IPCountry");
  if (header !== null && header.length > 0) return header;
  return null;
}

const THANK_YOU_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Submission received</title>
  </head>
  <body>
    <main>
      <h1>Thanks — your submission was received.</h1>
      <p>You can close this page.</p>
    </main>
  </body>
</html>
`;

function thankYou(): Response {
  return new Response(THANK_YOU_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
