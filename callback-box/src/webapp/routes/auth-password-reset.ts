/** Public member password reset routes. Possession of the capability replaces the old password proof. */

import * as crypto from "node:crypto";
import * as path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { BoxSpec } from "../server-types.js";
import {
  AuthCapabilityStoreError,
  consumeAuthPasswordReset,
  inspectAuthPasswordReset,
  type AuthPasswordReset,
} from "../auth-capabilities.js";
import { getOwnerEmail } from "../auth.js";
import { readBasePrefix } from "../base-prefix.js";
import { canAccessBox } from "../box-access.js";
import { getLocalUser, setPasswordWithPasswordHash } from "../local-users.js";
import { AuthStoreUnavailableError, NoSuchUserError } from "../local-users-errors.js";
import { hashPassword } from "../local-users-scrypt.js";
import { resetLocalUserCache } from "../local-users-cache.js";
import { LoginThrottle, loginThrottle } from "../login-throttle.js";
import { renderPasswordResetPage, renderPasswordResetUnavailablePage } from "../password-reset-page.js";
import { isFormRequest, readAuthFormBody } from "./auth-password-post.js";

const resetFieldsSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(8).max(1024),
  confirmPassword: z.string().max(1024),
});

/** Reset backoff is isolated from failed-login backoff; the expensive-hash slot remains process-global. */
export const passwordResetThrottle = new LoginThrottle();

function responseHeaders(reply: FastifyReply): FastifyReply {
  return reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
}

function tokenThrottleKey(token: string): string {
  return `password-reset:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function targetBox(boxes: BoxSpec[], reset: AuthPasswordReset): BoxSpec | null {
  return boxes.find((box) => path.resolve(box.boxRoot) === path.resolve(reset.boxRoot)) ?? null;
}

function unavailable(reply: FastifyReply, status?: number): FastifyReply {
  return responseHeaders(reply).status(status ?? 410).type("text/html").send(renderPasswordResetUnavailablePage());
}

function invalidFields(options: { reply: FastifyReply; prefix: string; token: string; email?: string }): FastifyReply {
  return responseHeaders(options.reply)
    .status(400)
    .type("text/html")
    .send(renderPasswordResetPage({
      prefix: options.prefix,
      token: options.token,
      ...(options.email === undefined ? {} : { email: options.email }),
      error: "validation",
    }));
}

function retryable(options: { reply: FastifyReply; prefix: string; token: string; email?: string }): FastifyReply {
  return responseHeaders(options.reply)
    .status(429)
    .type("text/html")
    .send(renderPasswordResetPage({
      prefix: options.prefix,
      token: options.token,
      ...(options.email === undefined ? {} : { email: options.email }),
      error: "retry",
    }));
}

type ResetFieldsResult =
  | { status: "valid"; fields: z.infer<typeof resetFieldsSchema> }
  | { status: "invalid"; token: string };

async function readFields(request: FastifyRequest): Promise<ResetFieldsResult> {
  try {
    const params = await readAuthFormBody(request);
    const token = params.get("token") ?? "";
    const parsed = resetFieldsSchema.safeParse({
      token,
      password: params.get("password") ?? "",
      confirmPassword: params.get("confirmPassword") ?? "",
    });
    if (!parsed.success || parsed.data.password !== parsed.data.confirmPassword) {
      return { status: "invalid", token: token.length <= 256 ? token : "" };
    }
    return { status: "valid", fields: parsed.data };
  } catch (_error) {
    return { status: "invalid", token: "" };
  }
}

async function memberStillEligible(box: BoxSpec, reset: AuthPasswordReset): Promise<boolean> {
  const user = getLocalUser(reset.email);
  return user?.role === "member" && canAccessBox({ boxRoot: box.boxRoot, email: reset.email, ownerEmail: getOwnerEmail() });
}

async function resetPassword(options: {
  boxes: BoxSpec[];
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<FastifyReply> {
  const { request, reply } = options;
  const prefix = readBasePrefix(request.headers);
  const parsedFields = await readFields(request);
  const token = parsedFields.status === "valid" ? parsedFields.fields.token : parsedFields.token;
  if (!token) return invalidFields({ reply, prefix, token: "" });
  const now = Date.now();
  const tokenKey = tokenThrottleKey(token);
  const tokenDecision = passwordResetThrottle.check({ ip: request.ip, email: tokenKey, now });
  if (!tokenDecision.allowed) return retryable({ reply, prefix, token });

  let inspected;
  try {
    inspected = await inspectAuthPasswordReset({ token, now });
  } catch (error) {
    if (error instanceof AuthCapabilityStoreError) return unavailable(reply, 503);
    throw error;
  }
  if (inspected.status !== "valid") {
    passwordResetThrottle.recordFailure({ ip: request.ip, email: tokenKey, now });
    console.warn(`[auth-password-reset] rejected: category=dead-token ip=${request.ip}`);
    return unavailable(reply);
  }
  const box = targetBox(options.boxes, inspected.reset);
  if (!box || !(await memberStillEligible(box, inspected.reset))) {
    passwordResetThrottle.recordFailure({ ip: request.ip, email: tokenKey, now });
    console.warn(`[auth-password-reset] rejected: category=stale-target ip=${request.ip}`);
    return unavailable(reply);
  }
  if (parsedFields.status === "invalid") {
    return invalidFields({ reply, prefix, token, email: inspected.reset.email });
  }
  const { fields } = parsedFields;
  if (!loginThrottle.acquireHashSlot()) {
    return retryable({ reply, prefix, token, email: inspected.reset.email });
  }

  try {
    const scrypt = await hashPassword(fields.password);
    if (!(await memberStillEligible(box, inspected.reset))) return unavailable(reply);
    let consumed;
    try {
      consumed = await consumeAuthPasswordReset({ token });
    } catch (error) {
      if (error instanceof AuthCapabilityStoreError) return unavailable(reply, 503);
      throw error;
    }
    if (consumed.status !== "consumed") return unavailable(reply);
    try {
      await setPasswordWithPasswordHash({ email: consumed.reset.email, scrypt });
    } catch (error) {
      if (error instanceof NoSuchUserError) return unavailable(reply);
      throw error;
    }
    resetLocalUserCache();
    passwordResetThrottle.recordSuccess({ ip: request.ip, email: tokenKey });
    const returnTo = `${prefix}/${box.slug}/`;
    return responseHeaders(reply).redirect(
      `${prefix}/auth/login?returnTo=${encodeURIComponent(returnTo)}&passwordReset=1`,
    );
  } finally {
    loginThrottle.releaseHashSlot();
  }
}

export async function registerAuthPasswordResetRoutes(server: FastifyInstance, boxes: BoxSpec[]): Promise<void> {
  server.get<{ Querystring: { token?: string } }>("/auth/reset-password", async (request, reply) => {
    const token = request.query.token ?? "";
    let email: string;
    try {
      const result = await inspectAuthPasswordReset({ token });
      if (result.status !== "valid") return unavailable(reply);
      const box = targetBox(boxes, result.reset);
      if (!box || !(await memberStillEligible(box, result.reset))) return unavailable(reply);
      email = result.reset.email;
    } catch (error) {
      if (error instanceof AuthCapabilityStoreError || error instanceof AuthStoreUnavailableError) {
        return unavailable(reply, 503);
      }
      throw error;
    }
    return responseHeaders(reply)
      .type("text/html")
      .send(renderPasswordResetPage({
        prefix: readBasePrefix(request.headers),
        token,
        email,
        error: null,
      }));
  });
  server.post("/auth/reset-password", async (request, reply) => {
    if (!isFormRequest(request)) return unavailable(reply, 400);
    try {
      return await resetPassword({ boxes, request, reply });
    } catch (error) {
      console.error("[auth-password-reset] reset failed closed:", error);
      return unavailable(reply, 503);
    }
  });
}
