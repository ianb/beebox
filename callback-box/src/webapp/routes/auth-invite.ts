/** Public invite inspection and acceptance routes. */

import * as crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { BoxSpec } from "../server-types.js";
import {
  AuthInviteStoreError,
  consumeAuthInvite,
  inspectAuthInvite,
  type AuthInvite,
} from "../auth-invites.js";
import { getOwnerEmail } from "../auth.js";
import { grantBoxAccess, normalizeAllowedEmails } from "../box-config-write.js";
import { loadBoxConfig } from "../../core/box/config.js";
import { renderInvitePage, renderInvitePartialPage, renderInviteUnavailablePage } from "../invite-page.js";
import { addUserWithPasswordHash, canonicalizeEmail, listUsers } from "../local-users.js";
import { hashPassword } from "../local-users-scrypt.js";
import { resetLocalUserCache } from "../local-users-cache.js";
import { loginThrottle } from "../login-throttle.js";
import { readBasePrefix } from "../base-prefix.js";
import { readAuthFormBody, setSessionCookie } from "./auth-password-post.js";

const inviteFieldsSchema = z.object({
  token: z.string().min(1).max(256),
  email: z.string().max(254).optional(),
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(1024),
  confirmPassword: z.string().max(1024),
});

function responseHeaders(reply: FastifyReply): FastifyReply {
  return reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
}

function tokenThrottleKey(token: string): string {
  return `invite:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

async function readFields(request: FastifyRequest): Promise<z.infer<typeof inviteFieldsSchema> | null> {
  try {
    const params = await readAuthFormBody(request);
    const parsed = inviteFieldsSchema.safeParse({
      token: params.get("token") ?? "",
      email: params.get("email") ?? undefined,
      name: params.get("name") ?? "",
      password: params.get("password") ?? "",
      confirmPassword: params.get("confirmPassword") ?? "",
    });
    if (!parsed.success || parsed.data.password !== parsed.data.confirmPassword) return null;
    return parsed.data;
  } catch (_error) {
    return null;
  }
}

function targetBox(boxes: BoxSpec[], invite: AuthInvite): BoxSpec | null {
  return boxes.find((box) => box.boxRoot === invite.boxRoot) ?? null;
}

async function openEmailIsClaimable(options: { boxes: BoxSpec[]; email: string }): Promise<boolean> {
  const email = canonicalizeEmail(options.email);
  if (email === getOwnerEmail()) return false;
  if (listUsers().some((user) => user.email === email)) return false;
  for (const box of options.boxes) {
    const config = await loadBoxConfig(box.boxRoot);
    if (normalizeAllowedEmails(config.allowedEmails ?? []).includes(email)) return false;
  }
  return true;
}

function genericFailure(options: {
  reply: FastifyReply;
  prefix: string;
  token: string;
  status?: number | undefined;
}): FastifyReply {
  return responseHeaders(options.reply)
    .status(options.status ?? 400)
    .type("text/html")
    .send(renderInvitePage({ prefix: options.prefix, token: options.token, error: true }));
}

function storeUnavailable(reply: FastifyReply): FastifyReply {
  return responseHeaders(reply).status(503).type("text/html").send(renderInviteUnavailablePage());
}

async function acceptInvite(options: {
  boxes: BoxSpec[];
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<FastifyReply> {
  const { request, reply, boxes } = options;
  const prefix = readBasePrefix(request.headers);
  const fields = await readFields(request);
  if (!fields) return genericFailure({ reply, prefix, token: "" });
  const now = Date.now();
  const initialKey = tokenThrottleKey(fields.token);
  const initialDecision = loginThrottle.check({ ip: request.ip, email: initialKey, now });
  if (!initialDecision.allowed) return genericFailure({ reply, prefix, token: fields.token, status: 429 });

  let inspected;
  try {
    inspected = await inspectAuthInvite({ token: fields.token, now });
  } catch (error) {
    if (error instanceof AuthInviteStoreError) return storeUnavailable(reply);
    throw error;
  }
  if (inspected.status !== "valid") {
    loginThrottle.recordFailure({ ip: request.ip, email: initialKey, now });
    return responseHeaders(reply).status(410).type("text/html").send(renderInviteUnavailablePage());
  }
  const box = targetBox(boxes, inspected.invite);
  if (!box) return responseHeaders(reply).status(410).type("text/html").send(renderInviteUnavailablePage());
  const email = canonicalizeEmail(inspected.invite.email ?? fields.email ?? "");
  const claimable = inspected.invite.email
    ? email !== getOwnerEmail() && !listUsers().some((user) => user.email === email)
    : await openEmailIsClaimable({ boxes, email });
  if (!email.includes("@") || !claimable) {
    loginThrottle.recordFailure({ ip: request.ip, email: initialKey, now });
    return genericFailure({ reply, prefix, token: fields.token });
  }
  const emailDecision = loginThrottle.check({ ip: request.ip, email, now });
  if (!emailDecision.allowed || !loginThrottle.acquireHashSlot()) {
    return genericFailure({ reply, prefix, token: fields.token, status: 429 });
  }

  try {
    const scrypt = await hashPassword(fields.password);
    const stillClaimable = inspected.invite.email
      ? email !== getOwnerEmail() && !listUsers().some((user) => user.email === email)
      : await openEmailIsClaimable({ boxes, email });
    if (!stillClaimable) return genericFailure({ reply, prefix, token: fields.token });
    let consumed;
    try {
      consumed = await consumeAuthInvite({ token: fields.token });
    } catch (error) {
      if (error instanceof AuthInviteStoreError) return storeUnavailable(reply);
      throw error;
    }
    if (consumed.status !== "consumed") {
      return responseHeaders(reply).status(410).type("text/html").send(renderInviteUnavailablePage());
    }
    const member = await addUserWithPasswordHash({ email, name: fields.name, role: "member", scrypt });
    resetLocalUserCache();
    let grant;
    try {
      grant = await grantBoxAccess({ boxRoot: box.boxRoot, email });
    } catch (error) {
      console.error(`[auth-invite] account created but box config write failed for ${email}:`, error);
      return responseHeaders(reply).status(503).type("text/html").send(renderInvitePartialPage(email));
    }
    if (grant.commitError) {
      console.error(`[auth-invite] access granted but Git commit failed for ${box.boxRoot}/config/box.json:`, grant.commitError);
    }
    loginThrottle.recordSuccess({ ip: request.ip, email });
    setSessionCookie(reply, { request, user: { email: member.email, name: member.name } });
    return responseHeaders(reply).redirect(`${prefix}/${box.slug}/`);
  } finally {
    loginThrottle.releaseHashSlot();
  }
}

export async function registerAuthInviteRoutes(server: FastifyInstance, boxes: BoxSpec[]): Promise<void> {
  server.get<{ Querystring: { token?: string; error?: string } }>("/auth/invite", async (request, reply) => {
    const token = request.query.token ?? "";
    let result;
    try {
      result = await inspectAuthInvite({ token });
    } catch (error) {
      if (error instanceof AuthInviteStoreError) return storeUnavailable(reply);
      throw error;
    }
    if (result.status !== "valid" || !targetBox(boxes, result.invite)) {
      return responseHeaders(reply).status(410).type("text/html").send(renderInviteUnavailablePage());
    }
    return responseHeaders(reply)
      .type("text/html")
      .send(
        renderInvitePage({
          prefix: readBasePrefix(request.headers),
          token,
          ...(result.invite.email === undefined ? {} : { email: result.invite.email }),
          error: request.query.error === "1",
        }),
      );
  });
  server.post("/auth/invite", async (request, reply) => acceptInvite({ boxes, request, reply }));
}
