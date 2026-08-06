/** Authenticated, current-password-protected password rotation. */

import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveRequestIdentity } from "../auth.js";
import { getLocalUser, setPassword, verifyPassword } from "../local-users.js";
import { resetLocalUserCache } from "../local-users-cache.js";
import { AuthStoreUnavailableError } from "../local-users-errors.js";
import { CONCURRENCY_RETRY_MS, loginThrottle } from "../login-throttle.js";
import { readAuthJsonBody, setSessionCookie } from "./auth-password-post.js";

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().max(1024),
    newPassword: z.string().min(8).max(1024),
    confirmPassword: z.string().max(1024),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

async function readPasswordChange(request: FastifyRequest): Promise<z.infer<typeof passwordChangeSchema> | null> {
  try {
    const body = await readAuthJsonBody(request);
    const result = passwordChangeSchema.safeParse(body);
    return result.success ? result.data : null;
  } catch (_error) {
    return null;
  }
}

export async function handlePasswordChange(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const identity = resolveRequestIdentity(request, { openAccess: request.server.openAccess });
  if (identity.source === "unavailable") {
    return reply.status(503).send({ error: "Authentication temporarily unavailable" });
  }
  if (identity.source !== "cookie" || !identity.email) {
    return reply.status(401).send({ error: "Current password could not be verified" });
  }
  const fields = await readPasswordChange(request);
  if (!fields) return reply.status(400).send({ error: "Invalid password change request" });

  const { email } = identity;
  const now = Date.now();
  const decision = loginThrottle.check({ ip: request.ip, email, now });
  if (!decision.allowed) {
    return reply.status(429).send({ error: "Too many attempts, please wait", retryAfterMs: decision.retryAfterMs });
  }
  if (!loginThrottle.acquireHashSlot()) {
    return reply.status(429).send({ error: "Server busy, please retry", retryAfterMs: CONCURRENCY_RETRY_MS });
  }
  try {
    const verified = await verifyPassword({ email, password: fields.currentPassword });
    if (!verified) {
      loginThrottle.recordFailure({ ip: request.ip, email, now: Date.now() });
      return reply.status(401).send({ error: "Current password could not be verified" });
    }
    const updated = await setPassword({ email, password: fields.newPassword });
    resetLocalUserCache();
    loginThrottle.recordSuccess({ ip: request.ip, email });
    setSessionCookie(reply, {
      request,
      user: { email: updated.email, name: identity.name ?? updated.name },
    });
    return reply.status(204).send();
  } catch (error) {
    if (error instanceof AuthStoreUnavailableError) {
      console.error("[auth] password change failed — credential store unavailable:", error);
      return reply.status(503).send({ error: "Password change temporarily unavailable" });
    }
    throw error;
  } finally {
    loginThrottle.releaseHashSlot();
  }
}

export function currentUserHasPassword(email: string): boolean {
  return getLocalUser(email) !== null;
}
