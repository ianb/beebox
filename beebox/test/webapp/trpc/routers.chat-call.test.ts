// `chatCall`: holding `join` is being on the chat's call. Members hear each
// other's peer ids and pass WebRTC signals through the server; people present
// in the chat see the call on `chatPresence.watch`; the agent cannot join; a
// box with no TURN key gets STUN only; a box granted the host's own relay gets
// coturn credentials signed locally. See docs/chat-calls.md.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { appRouter } from "../../../src/webapp/trpc/routers.js";
import { trpcContext } from "../../helpers/trpc-context.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TrpcContext } from "../../../src/webapp/trpc/context.js";
import { readFoldRecord } from "../../../src/core/chat/call-transcript/record.js";
import { grantSecret, revokeSecret, setSecret } from "../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { restCredentials } from "../../../src/core/turn-server-key.js";

// Mutations take box-work admission, which needs a Git box.
const box = await makeTmpBox({ git: true });
const boxRoot = box.root;
const sessionId = "5d1c9e7a-2b3f-4a6e-8c0d-9e8f7a6b5c4d";
const priya = { email: "priya@example.com", name: "Priya Marlowe" };
const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };

function caller(over: Partial<TrpcContext>, signal?: AbortSignal) {
  return appRouter.createCaller(trpcContext({ boxRoot, ...over }), signal === undefined ? undefined : { signal });
}

/** A subscription's frames, and the close that ends it (abort, then return, as the WebSocket handler does). */
async function open<T>(start: (signal: AbortSignal) => Promise<AsyncIterable<T>>) {
  const controller = new AbortController();
  const frames = (await start(controller.signal))[Symbol.asyncIterator]();
  return {
    next: async (): Promise<T> => {
      const r = await frames.next();
      if (r.done === true) throw new Error("subscription ended");
      return r.value;
    },
    close: async () => {
      controller.abort();
      await frames.return?.();
    },
  };
}

void test("two people on a call pass signals, and someone present sees the call", async (t) => {
  const odette = await open((signal) => caller({ user: { email: "odette@example.com", name: "Odette Marlowe" } }, signal).chatPresence.watch({ sessionId }));
  t.check(await odette.next(), { t: "others", people: [] });
  // The call and composing states arrive in either order.
  const states = [await odette.next(), await odette.next()];
  t.check(states.toSorted((a, b) => a.t.localeCompare(b.t)), [{ t: "call", call: null }, { t: "composing", active: [] }]);

  const p = await open((signal) => caller({ user: priya }, signal).chatCall.join({ sessionId, callId: null }));
  const joined = await p.next();
  t.check(joined, { t: "joined", callId: any(String), peerId: any(String), serverNowMs: any(Number) });
  if (joined.t !== "joined") throw new Error("expected joined");
  const { callId, peerId: priyaPeer } = joined;
  t.check(await p.next(), { t: "state", members: [{ peerId: priyaPeer, person: priya }], transcribing: false });
  t.check(await odette.next(), { t: "call", call: { callId, members: [priya], transcribing: false, startedAt: any(Number) } });

  const tm = await open((signal) => caller({ user: tomas, actor: "device" }, signal).chatCall.join({ sessionId, callId }));
  const tJoined = await tm.next();
  if (tJoined.t !== "joined") throw new Error("expected joined");
  const tomasPeer = tJoined.peerId;
  const both = { t: "state" as const, members: [{ peerId: priyaPeer, person: priya }, { peerId: tomasPeer, person: tomas }], transcribing: false };
  t.check(await tm.next(), both);
  t.check(await p.next(), both);

  const sent = await caller({ user: priya }).chatCall.signal({ sessionId, callId, peerId: priyaPeer, to: tomasPeer, data: { description: { type: "offer", sdp: "v=0" } } });
  t.check(sent, { delivered: true });
  t.check(await tm.next(), { t: "signal", from: priyaPeer, data: { description: { type: "offer", sdp: "v=0" } } });

  // Tomas cannot turn transcription on as Priya's peer; as his own, he can.
  await t.checkThrows(() => caller({ user: tomas }).chatCall.setTranscribing({ sessionId, callId, peerId: priyaPeer, on: true }), "TRPCError: Not on this call.");
  t.check(await caller({ user: tomas }).chatCall.setTranscribing({ sessionId, callId, peerId: tomasPeer, on: true }), { on: true });
  t.check(await p.next(), { ...both, transcribing: true });

  t.check(await caller({ user: tomas }).chatCall.leave({ sessionId, callId, peerId: tomasPeer }), { left: true });
  t.check(await p.next(), { t: "state", members: [{ peerId: priyaPeer, person: priya }], transcribing: true });
  await Promise.all([p.close(), tm.close(), odette.close()]);
});

void test("the agent cannot be on a call", async (t) => {
  await t.checkThrows(() => caller({ user: priya, actor: "agent" }).chatCall.iceServers(), "TRPCError: Only a box member can be on a call.");
});

// docs/implemented-plans/chat-calls.md, Track F: a member registers its recording before
// capture starts. Only the peer's own person may, and only while transcribing.
void test("a member registers its own recording, only while transcription is on", async (t) => {
  const p = await open((signal) => caller({ user: priya }, signal).chatCall.join({ sessionId, callId: null }));
  const joined = await p.next();
  if (joined.t !== "joined") throw new Error("expected joined");
  const { callId, peerId } = joined;
  const register = (user: typeof priya) => caller({ user }).chatCall.registerRecording({ sessionId, callId, peerId, voiceSessionId: "3f1d2c4b-5a6e-4f70-8b9c-0d1e2f3a4b5c", clockOffsetMs: 1_500 });

  await t.checkThrows(() => register(priya), "TRPCError: Transcription is off.");
  await caller({ user: priya }).chatCall.setTranscribing({ sessionId, callId, peerId, on: true });
  await t.checkThrows(() => register(tomas), "TRPCError: Not on this call.");
  t.check(await register(priya), { registered: true });
  t.check((await readFoldRecord(boxRoot, callId))?.recordings, [
    { voiceSessionId: "3f1d2c4b-5a6e-4f70-8b9c-0d1e2f3a4b5c", person: priya, clockOffsetMs: 1_500 },
  ]);
  await p.close();
});

// docs/plans/self-hosted-turn.md: the host's own coturn, signed locally with no
// outside call, and preferred over Cloudflare. The username's expiry is three
// hours out and names the box; the credential is coturn's HMAC of it.
void test("a box granted the host's relay gets its coturn servers", async (t) => {
  const slug = await boxSlug(boxRoot);
  const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const urls = ["turn:203.0.113.5:3478?transport=udp", "turn:203.0.113.5:3478?transport=tcp"];
  await setSecret({ name: "turn-server", value: JSON.stringify({ secret, urls }) });
  await grantSecret({ slug, name: "turn-server", access: "server" });
  t.teardown(() => revokeSecret({ slug, name: "turn-server" }));
  const before = Math.floor(Date.now() / 1000);
  const got = await caller({ user: priya }).chatCall.iceServers();
  t.check(got, {
    iceServers: [{ urls: ["stun:203.0.113.5:3478"] }, { urls, username: any(String), credential: any(String) }],
    relay: true,
    serverNowMs: any(Number),
  });
  const after = Math.floor(Date.now() / 1000);
  const relayServer = got.iceServers[1];
  const [expiry, id] = (relayServer?.username ?? "").split(":");
  const issuedAt = Number(expiry) - 10_800;
  const signed = restCredentials({ secret, nowMs: issuedAt * 1000, ttlSeconds: 10_800, id: id ?? "" });
  t.check(
    { issuedAt: issuedAt >= before && issuedAt <= after ? "during the request" : issuedAt, id, credential: relayServer?.credential },
    { issuedAt: "during the request", id: "test", credential: signed.credential },
  );
});

void test("a box with no TURN key gets STUN only", async (t) => {
  // Tests run in order; the last one removes the shared box.
  t.teardown(() => box.cleanup());
  t.check(await caller({ user: priya }).chatCall.iceServers(), { iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }], relay: false, serverNowMs: any(Number) });
});
