/**
 * The `POST /auth/login` and `POST /auth/setup` handlers, split out of
 * `routes/auth.ts` to keep both files under the line cap.
 *
 * Each handler accepts BOTH shapes:
 *
 * - **JSON** (`application/json`, from a programmatic/SPA caller) — byte-identical
 *   to the pre-existing behavior: 204 + `Set-Cookie` on success, a JSON error
 *   body otherwise.
 * - **Form** (`application/x-www-form-urlencoded`, from the bare server-rendered
 *   login/setup page) — on success set the session cookie and 302 to the
 *   sanitized `returnTo`; on failure 302 back to the bare page with a generic
 *   error signal, never leaking whether the email exists.
 *
 * The form path reads its body from the raw stream: the
 * `application/x-www-form-urlencoded` content-type parser registered in
 * `routes/auth.ts` calls `done(null)` without draining (the SAME shape the hub's
 * `*` parser uses), so `request.raw` is still readable here.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import {
  signSession,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  type SessionUser,
} from "../auth.js";
import { readBasePrefix } from "../base-prefix.js";
import { canonicalizeEmail, createFirstUser, listUsers, verifyPassword } from "../local-users.js";
import { AuthStoreUnavailableError, OwnerEmailMismatchError, UserExistsError } from "../local-users-errors.js";
import { CONCURRENCY_RETRY_MS, loginThrottle } from "../login-throttle.js";
import { checkSetupToken, clearSetupToken } from "../setup-token.js";
import { sanitizeReturnTo, type SetupErrorKind } from "../login-page.js";

// Bounded inputs (FIX 4 — DoS): email at the RFC-max 254, password 1024, name
// 200, token 256. Caps the parsed fields on top of the raw-body cap below.
const loginBodySchema = z.object({ email: z.string().max(254), password: z.string().max(1024) });
const setupBodySchema = z.object({
  email: z.string().max(254),
  name: z.string().max(200),
  password: z.string().max(1024),
  token: z.string().max(256),
});

/** Cap on the raw request body these auth routes will read — they carry tiny
 *  bodies, so anything larger is abuse. Bounds both the hub JSON raw-body read
 *  and the form-body read. */
const MAX_AUTH_BODY_BYTES = 16 * 1024;
/** Cap the raw-body read so a client that opens the connection and then
 *  dribbles/stalls the body can't hold the request open indefinitely (a
 *  slow-loris on the login endpoint). Prod's reverse proxy also bounds this, but
 *  the read defends itself regardless. */
const MAX_AUTH_BODY_READ_MS = 10_000;

/** Truncate a user-supplied string before logging so a failed/throttled attempt
 *  can't amplify log volume with a giant "email" (FIX 4). */
function forLog(value: string): string {
  return value.length > 128 ? `${value.slice(0, 128)}…` : value;
}

class AuthBodyTooLargeError extends Error {
  constructor() {
    super(`Auth request body exceeds ${MAX_AUTH_BODY_BYTES} bytes.`);
    this.name = "AuthBodyTooLargeError";
  }
}

class AuthBodyReadTimeoutError extends Error {
  constructor() {
    super(`Auth request body not received within ${MAX_AUTH_BODY_READ_MS}ms.`);
    this.name = "AuthBodyReadTimeoutError";
  }
}

function readRawBody(raw: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      raw.destroy();
      reject(new AuthBodyReadTimeoutError());
    }, MAX_AUTH_BODY_READ_MS);
    raw.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_AUTH_BODY_BYTES) {
        clearTimeout(timer);
        raw.destroy();
        reject(new AuthBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    raw.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    raw.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * Read the JSON body for an auth POST, working in BOTH server modes (FIX 2):
 * standalone, Fastify's JSON parser already populated `request.body`; behind the
 * hub, the wildcard parser leaves it undefined without draining, so the raw
 * stream is read here. Throws (oversize/invalid JSON) — the caller answers 400.
 */
async function readJsonBody(request: FastifyRequest): Promise<unknown> {
  // `request.body !== undefined` — NOT `isRecord(...)` — is the correct test for
  // "a content-type parser already consumed the stream". Standalone, Fastify's
  // JSON parser populates `body` for EVERY valid JSON value; an `isRecord` check
  // would misread those as unparsed and wait on stream events that already fired.
  if (request.body !== undefined) return request.body;
  const raw = await readRawBody(request.raw);
  return JSON.parse(raw);
}

/** Read a urlencoded form body from the (undrained) raw stream. */
async function readFormBody(request: FastifyRequest): Promise<URLSearchParams> {
  const raw = await readRawBody(request.raw);
  return new URLSearchParams(raw);
}

/** True when the POST body arrived as an HTML form submission (bare page) rather
 *  than the SPA/programmatic JSON API. */
function isFormRequest(request: FastifyRequest): boolean {
  const contentType = request.headers["content-type"];
  return typeof contentType === "string" && contentType.includes("application/x-www-form-urlencoded");
}

/** Login page's error re-render target: the bare page with `error=1` and the
 *  (already-sanitized) returnTo preserved, prefix-carried. */
function loginErrorLocation({ prefix, returnTo }: { prefix: string; returnTo: string }): string {
  return `${prefix}/auth/login?returnTo=${encodeURIComponent(returnTo)}&error=1`;
}

/** Setup page's error re-render target: the bare page with the token preserved
 *  and a specific `error` kind, prefix-carried. */
function setupErrorLocation({ prefix, token, kind }: { prefix: string; token: string; kind: SetupErrorKind }): string {
  return `${prefix}/auth/setup?token=${encodeURIComponent(token)}&error=${kind}`;
}

/** Sign a session for `user` and set the `cb_session` cookie — the SAME options
 *  the Google callback uses (`path:/`, httpOnly, `secure` iff https, sameSite
 *  lax, the 30-day max-age). */
function setSessionCookie(reply: FastifyReply, { request, user }: { request: FastifyRequest; user: SessionUser }): void {
  reply.setCookie(COOKIE_NAME, signSession(user), {
    path: "/",
    httpOnly: true,
    secure: request.protocol === "https",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

interface LoginCredentials {
  email: string;
  password: string;
  returnTo: string;
}

/** Parse `{email,password}` (+ form-only `returnTo`) from either shape. `null`
 *  signals a malformed/oversize body. */
async function readLoginCredentials({
  request,
  form,
  prefix,
}: {
  request: FastifyRequest;
  form: boolean;
  prefix: string;
}): Promise<LoginCredentials | null> {
  if (form) {
    let params: URLSearchParams;
    try {
      params = await readFormBody(request);
    } catch (_e) {
      /* ignore: oversize/unreadable form body is untrusted input — treat as malformed. */
      return null;
    }
    const returnTo = sanitizeReturnTo({ raw: params.get("returnTo") ?? undefined, prefix });
    const parsed = loginBodySchema.safeParse({ email: params.get("email") ?? "", password: params.get("password") ?? "" });
    if (!parsed.success) return null;
    return { email: canonicalizeEmail(parsed.data.email), password: parsed.data.password, returnTo };
  }
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (_e) {
    /* ignore: oversize/unparseable JSON body is untrusted input — treat as malformed. */
    return null;
  }
  const parsed = loginBodySchema.safeParse(body);
  if (!parsed.success) return null;
  return { email: canonicalizeEmail(parsed.data.email), password: parsed.data.password, returnTo: `${prefix}/` };
}

/** `POST /auth/login` — verify credentials, mint the session cookie. */
export async function handleLoginPost(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const form = isFormRequest(request);
  const prefix = readBasePrefix(request.headers);
  const creds = await readLoginCredentials({ request, form, prefix });
  if (!creds) {
    return form
      ? reply.redirect(loginErrorLocation({ prefix, returnTo: `${prefix}/` }))
      : reply.status(400).send({ error: "Invalid request" });
  }
  const { email, password, returnTo } = creds;
  const ip = request.ip;
  const fail = (status: number, jsonBody: object): FastifyReply =>
    form ? reply.redirect(loginErrorLocation({ prefix, returnTo })) : reply.status(status).send(jsonBody);

  const decision = loginThrottle.check({ ip, email, now: Date.now() });
  if (!decision.allowed) {
    console.warn(`[auth] throttled login for ${JSON.stringify(forLog(email))} from ${ip}`);
    return fail(429, { error: "Too many attempts, please wait", retryAfterMs: decision.retryAfterMs });
  }
  if (!loginThrottle.acquireHashSlot()) {
    console.warn(`[auth] login verification capacity reached; rejecting ${JSON.stringify(forLog(email))} from ${ip}`);
    return fail(429, { error: "Server busy, please retry", retryAfterMs: CONCURRENCY_RETRY_MS });
  }

  let user;
  try {
    user = await verifyPassword({ email, password });
  } catch (e) {
    if (e instanceof AuthStoreUnavailableError) {
      console.error("[auth] login failed — credential store unavailable:", e);
      return fail(503, { error: "Login temporarily unavailable" });
    }
    throw e;
  } finally {
    loginThrottle.releaseHashSlot();
  }

  if (!user) {
    loginThrottle.recordFailure({ ip, email, now: Date.now() });
    console.warn(`[auth] failed login for ${JSON.stringify(forLog(email))} from ${ip}`);
    // Unknown user and wrong password answer identically — no user enumeration.
    return fail(401, { error: "Invalid credentials" });
  }
  loginThrottle.recordSuccess({ ip, email });
  setSessionCookie(reply, { request, user: { email: user.email, name: user.name } });
  return form ? reply.redirect(returnTo) : reply.status(204).send();
}

interface SetupFields {
  email: string;
  name: string;
  password: string;
  token: string;
}

type SetupParse = { kind: "ok"; fields: SetupFields } | { kind: "mismatch"; token: string } | { kind: "bad" };

/** Parse the setup fields from either shape. The form path additionally rejects
 *  a password/confirm mismatch (`kind: "mismatch"`) — the bare page has no JS to
 *  check it client-side. */
async function readSetupFields({ request, form }: { request: FastifyRequest; form: boolean }): Promise<SetupParse> {
  if (form) {
    let params: URLSearchParams;
    try {
      params = await readFormBody(request);
    } catch (_e) {
      /* ignore: oversize/unreadable form body is untrusted input — treat as malformed. */
      return { kind: "bad" };
    }
    const token = params.get("token") ?? "";
    if ((params.get("password") ?? "") !== (params.get("confirmPassword") ?? "")) return { kind: "mismatch", token };
    const parsed = setupBodySchema.safeParse({
      email: params.get("email") ?? "",
      name: params.get("name") ?? "",
      password: params.get("password") ?? "",
      token,
    });
    if (!parsed.success) return { kind: "bad" };
    return { kind: "ok", fields: parsed.data };
  }
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (_e) {
    /* ignore: oversize/unparseable JSON body is untrusted input — treat as malformed. */
    return { kind: "bad" };
  }
  const parsed = setupBodySchema.safeParse(body);
  if (!parsed.success) return { kind: "bad" };
  return { kind: "ok", fields: parsed.data };
}

/** `POST /auth/setup` — create the owner account from a live setup token. */
export async function handleSetupPost(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const form = isFormRequest(request);
  const prefix = readBasePrefix(request.headers);
  const parse = await readSetupFields({ request, form });
  if (parse.kind === "bad") {
    return form
      ? reply.redirect(setupErrorLocation({ prefix, token: "", kind: "generic" }))
      : reply.status(400).send({ error: "Invalid request" });
  }
  if (parse.kind === "mismatch") {
    return reply.redirect(setupErrorLocation({ prefix, token: parse.token, kind: "mismatch" }));
  }
  const fields = parse.fields;
  const failSetup = ({ kind, status, jsonBody }: { kind: SetupErrorKind; status: number; jsonBody: object }): FastifyReply =>
    form ? reply.redirect(setupErrorLocation({ prefix, token: fields.token, kind })) : reply.status(status).send(jsonBody);

  let existingUsers: number;
  try {
    existingUsers = listUsers().length;
  } catch (e) {
    if (e instanceof AuthStoreUnavailableError) {
      console.error("[auth] setup failed — credential store unavailable:", e);
      return failSetup({ kind: "generic", status: 503, jsonBody: { error: "Setup temporarily unavailable" } });
    }
    throw e;
  }
  // Once an account exists, setup is permanently closed.
  if (existingUsers > 0) {
    return failSetup({
      kind: "exists",
      status: 410,
      jsonBody: { error: "Setup already complete", message: "An account already exists; sign in at /auth/login." },
    });
  }

  const email = canonicalizeEmail(fields.email);
  const ip = request.ip;
  const now = Date.now();

  const decision = loginThrottle.check({ ip, email, now });
  if (!decision.allowed) {
    console.warn(`[auth] throttled setup for ${JSON.stringify(forLog(email))} from ${ip}`);
    return failSetup({
      kind: "generic",
      status: 429,
      jsonBody: { error: "Too many attempts, please wait", retryAfterMs: decision.retryAfterMs },
    });
  }

  const tokenStatus = checkSetupToken({ token: fields.token, now });
  if (tokenStatus !== "valid") {
    loginThrottle.recordFailure({ ip, email, now });
    if (tokenStatus === "mismatch") {
      console.warn(`[auth] setup rejected — invalid token from ${ip}`);
      return failSetup({ kind: "token", status: 403, jsonBody: { error: "Invalid setup token" } });
    }
    // "expired" | "absent": the one-time capability is gone.
    return failSetup({
      kind: "token",
      status: 410,
      jsonBody: {
        error: "Setup token expired",
        message: "Restart the server to print a fresh setup link, or run `cb auth create-user` on the host.",
      },
    });
  }

  // Setup hashes a password too (createFirstUser → scrypt), so it must take the
  // SAME global concurrency slot login does (FIX 6) — otherwise concurrent setup
  // POSTs bypass the ~128MB-per-hash cap and can OOM the process.
  if (!loginThrottle.acquireHashSlot()) {
    console.warn(`[auth] setup verification capacity reached; rejecting ${JSON.stringify(forLog(email))} from ${ip}`);
    return failSetup({
      kind: "generic",
      status: 429,
      jsonBody: { error: "Server busy, please retry", retryAfterMs: CONCURRENCY_RETRY_MS },
    });
  }
  try {
    const owner = await createFirstUser({ email, name: fields.name, password: fields.password });
    clearSetupToken();
    loginThrottle.recordSuccess({ ip, email });
    setSessionCookie(reply, { request, user: { email: owner.email, name: owner.name } });
    return form ? reply.redirect(`${prefix}/`) : reply.status(204).send();
  } catch (e) {
    // Lost the O_EXCL race (a second setup won): the winner already created it.
    if (e instanceof UserExistsError) {
      return failSetup({ kind: "exists", status: 409, jsonBody: { error: "An account already exists" } });
    }
    if (e instanceof OwnerEmailMismatchError) {
      return failSetup({ kind: "generic", status: 400, jsonBody: { error: e.message } });
    }
    throw e;
  } finally {
    loginThrottle.releaseHashSlot();
  }
}
