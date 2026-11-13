/**
 * Calls in a chat over the WebSocket (docs/chat-calls.md). Holding a `join`
 * subscription is being on the call; WebRTC offers, answers and candidates
 * travel as `signal` frames between members, and the server never reads them.
 * Every mutation names the caller's own `peerId`, and the server accepts it
 * only when that member of that call belongs to `ctx.user`.
 */

import { z } from "zod";
import ky from "ky";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../procedures.js";
import type { CallMemberFrame, MemberRef } from "../../../core/chat/presence/room.js";
import { CLOUDFLARE_TURN_SECRET_NAME, getCloudflareTurnKey } from "../../../core/cloudflare-turn-key.js";
import { recordSecretMint } from "../../../core/secrets/access-log.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { chatRoom, personFor, SESSION_ID_RE } from "../chat-room.js";
import type { TrpcContext } from "../context.js";

const ID_RE = /^[\w-]{8,64}$/;
/** A WebRTC offer with many candidates stays well under this. */
const MAX_SIGNAL_BYTES = 64 * 1024;
/** Long enough for a long call; a call that outlives it reconnects with fresh credentials. */
const TURN_TTL_SECONDS = 3 * 60 * 60;
const STUN_ONLY = [{ urls: ["stun:stun.cloudflare.com:3478"] }];

const memberInput = z.object({
  sessionId: z.string().regex(SESSION_ID_RE),
  callId: z.string().regex(ID_RE),
  peerId: z.string().regex(ID_RE),
});

const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
/** Cloudflare has answered both with one server object and with an array. */
const turnResponseSchema = z.object({ iceServers: z.union([iceServerSchema, z.array(iceServerSchema)]) });
export type IceServer = z.infer<typeof iceServerSchema>;

function requirePerson(ctx: TrpcContext): { email: string; name: string } {
  const person = personFor(ctx);
  if (person === null) throw new TRPCError({ code: "FORBIDDEN", message: "Only a box member can be on a call." });
  return person;
}

function memberRef(ctx: TrpcContext, input: z.infer<typeof memberInput>): MemberRef {
  return { boxRoot: ctx.boxRoot, ...input, email: requirePerson(ctx).email };
}

/** Mint short-lived TURN credentials, or null when the box has no key or Cloudflare fails. */
async function mintTurn(ctx: TrpcContext): Promise<IceServer[] | null> {
  const key = await getCloudflareTurnKey(ctx.boxRoot, { observe: true });
  if (key === null) return null;
  await recordSecretMint({ boxRoot: ctx.boxRoot, slug: ctx.boxSlug, secret: CLOUDFLARE_TURN_SECRET_NAME, purpose: "call-relay" });
  try {
    const raw = await ky
      .post(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(key.keyId)}/credentials/generate-ice-servers`, {
        json: { ttl: TURN_TTL_SECONDS },
        headers: { Authorization: `Bearer ${key.apiToken}` },
        retry: 1,
        timeout: 15_000,
      })
      .json();
    const parsed = turnResponseSchema.parse(raw);
    return Array.isArray(parsed.iceServers) ? parsed.iceServers : [parsed.iceServers];
  } catch (e) {
    // A call can still connect directly; the client names the relay as the cause if it then fails.
    console.warn(`[chat-call] TURN credentials failed: ${errorMessage(e)}`);
    return null;
  }
}

export const chatCallRouter = router({
  /**
   * The servers a call's peer connections use. `relay` says whether a TURN relay
   * is among them, so a failed connection can say why.
   */
  iceServers: authedProcedure.query(async ({ ctx }): Promise<{ iceServers: IceServer[]; relay: boolean }> => {
    requirePerson(ctx);
    const turn = await mintTurn(ctx);
    return turn === null ? { iceServers: STUN_ONLY, relay: false } : { iceServers: turn, relay: true };
  }),

  /** Be on the chat's call, starting one when `callId` is null and there is none. */
  join: authedProcedure
    .input(z.object({ sessionId: z.string().regex(SESSION_ID_RE), callId: z.string().regex(ID_RE).nullable() }))
    .subscription(async function* (opts): AsyncGenerator<CallMemberFrame> {
      const person = requirePerson(opts.ctx);
      const signal = opts.signal;
      // Signals are ordered messages, not states: every frame is kept.
      const queue: CallMemberFrame[] = [];
      let wake: (() => void) | null = null;
      const ping = (): void => {
        if (wake) {
          wake();
          wake = null;
        }
      };
      const joined = chatRoom.joinCall({
        boxRoot: opts.ctx.boxRoot,
        sessionId: opts.input.sessionId,
        callId: opts.input.callId,
        person,
        send: (frame) => {
          queue.push(frame);
          ping();
        },
      });
      if (!joined.ok) {
        if (joined.reason === "full") yield { t: "full" };
        else yield { t: "ended", reason: "no-answer" };
        return;
      }
      signal?.addEventListener("abort", ping, { once: true });
      try {
        while (signal?.aborted !== true) {
          const frame = queue.shift();
          if (frame === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          yield frame;
          if (frame.t === "ended") return;
        }
      } finally {
        joined.leave();
      }
    }),

  signal: authedProcedure
    .input(memberInput.extend({ to: z.string().regex(ID_RE), data: z.unknown() }))
    .mutation(({ ctx, input }) => {
      const { to, data, ...member } = input;
      if (JSON.stringify(data ?? null).length > MAX_SIGNAL_BYTES) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Call signal too large." });
      }
      return { delivered: chatRoom.signal(memberRef(ctx, member), { to, data }) };
    }),

  setTranscribing: authedProcedure
    .input(memberInput.extend({ on: z.boolean() }))
    .mutation(({ ctx, input }) => {
      const { on, ...member } = input;
      if (!chatRoom.setTranscribing(memberRef(ctx, member), on)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not on this call." });
      }
      return { on };
    }),

  /** Leave explicitly as well as by ending the subscription; see docs/chat-calls.md on the tRPC early-stop race. */
  leave: authedProcedure.input(memberInput).mutation(({ ctx, input }) => ({ left: chatRoom.leaveCall(memberRef(ctx, input)) })),
});
