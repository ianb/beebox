// # Conversation reservation recovery
//
// A Claude chat is addressable before its first message so fullscreen capture can
// target it. The same-tab receipt proves which otherwise-empty id this client
// reserved, allowing an exact re-reservation after a server restart without
// turning arbitrary missing ids into new chats.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { resolveConversation } from "../../../../src/components/chat/everywhere/resolve-conversation.js";
import { ReservationReceipts } from "../../../../src/components/chat/everywhere/reservation-receipts.js";
import { ReservationRecoveryUnsupportedError } from "../../../../src/components/chat/everywhere/reservation-recovery.js";
import { QueryClient } from "@tanstack/react-query";

type ResolveParams = Parameters<typeof resolveConversation>[0];
class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
function unavailable(sessionId: string) {
  return { kind: "unavailable", reason: "missing-local-transcript", sessionId,
    transcript: { state: "unknown" }, huskPath: null, history: null, label: null,
    status: {}, pending: [] };
}
function resumable(sessionId: string, opts?: { total?: number; contextDir?: string }) {
  const total = opts?.total ?? 0;
  return { kind: "resumable", sessionId, contextDir: opts?.contextDir ?? "",
    history: { entries: total === 0 ? [] : [{ type: "user" }], total }, label: null,
    status: { running: false, busy: false }, pending: [] };
}
function fakeUtils(options: {
  boxEngine?: "claude" | "codex";
  features?: Record<string, string>;
  bootstraps?: object[];
}): { utils: ResolveParams["utils"]; bootstrapCalls: () => number } {
  let bootstrapCalls = 0;
  return {
    // A test double built on a null prototype: it implements only the router
    // procedures exercised below (the pattern clerk.send.test.ts uses).
    utils: Object.assign(Object.create(null), {
      chat: {
        status: { fetch: async () => ({ boxEngine: options.boxEngine ?? "claude" }) },
        newFeatures: { fetch: async () => options.features ?? {} },
        bootstrap: { fetch: async () => options.bootstraps?.[bootstrapCalls++] },
        directoryFor: { setData: () => {} },
      },
    }),
    bootstrapCalls: () => bootstrapCalls,
  };
}
function cachedBootstrapUtils(options: {
  bootstraps: object[];
  directories: string[];
}): { utils: ResolveParams["utils"]; networkCalls: () => number; directoryNetworkCalls: () => number; cachedDirectory: (input: object) => unknown } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5000, retry: false } } });
  let networkCalls = 0;
  let directoryNetworkCalls = 0;
  return {
    // Only the QueryClient-backed procedures used here (see fakeUtils).
    utils: Object.assign(Object.create(null), {
      chat: {
        bootstrap: { fetch: (input: object, fetchOptions?: { staleTime?: number }) => queryClient.fetchQuery({
          queryKey: ["chat.bootstrap", input],
          queryFn: async () => options.bootstraps[networkCalls++],
          ...fetchOptions,
        }) },
        directoryFor: { fetch: (input: object, fetchOptions?: { staleTime?: number }) => queryClient.fetchQuery({
          queryKey: ["chat.directoryFor", input],
          queryFn: async () => ({ contextDir: options.directories[directoryNetworkCalls++] }),
          ...fetchOptions,
        }),
        setData: (input: object, data: unknown) => queryClient.setQueryData(["chat.directoryFor", input], data) },
      },
    }),
    networkCalls: () => networkCalls,
    directoryNetworkCalls: () => directoryNetworkCalls,
    cachedDirectory: (input: object) => queryClient.getQueryData(["chat.directoryFor", input]),
  };
}

// ## A fresh reservation writes its receipt before exposing the id
//
// Constructing a new store over the same storage simulates a reload in that tab.
// The server-minted id and all context needed to repeat the reservation survive.
void test("Constructing a new store over the same storage simulates a reload in that tab.", async (t) => {
  const storage = new MemoryStorage();
  const receipts = new ReservationReceipts(storage, "paper-cards/test1");
  const reserveCalls: Array<{ sessionId: string; contextDir: string; engine?: string; model?: string }> = [];
  const reserve: ResolveParams["reserve"] = async (input) => {
    reserveCalls.push(input);
    return { kind: "reserved", sessionId: input.sessionId };
  };
  const freshUtils = fakeUtils({ boxEngine: "claude" });
  const fresh = await resolveConversation({
    utils: freshUtils.utils, reserve, receipts,
    request: { kind: "new", contextDir: "_content/courses", model: "sonnet" },
  });
  const freshTarget = fresh.selection.kind === "ready" ? fresh.selection.target : null;
  const coinedId = freshTarget?.kind === "session" ? freshTarget.sessionId : "";
  const reloadedReceipts = new ReservationReceipts(storage, "paper-cards/test1");
  const receipt = reloadedReceipts.get(coinedId);
  t.check(
    { target: freshTarget?.kind, targetContext: freshTarget?.contextDir,
      receipt: receipt ? { ...receipt, sessionId: "<same>" } : null, calls: reserveCalls.length },
    {
    target: "session",
    targetContext: "_content/courses",
    receipt: {
      sessionId: "<same>",
      contextDir: "_content/courses",
      engine: "claude",
      model: "sonnet",
    },
    calls: 1,
  },
  );

  // After the server forgets the reservation, the matching receipt authorizes
  // re-reserving that same id before bootstrap. This matters on a Codex-default box:
  // without the reservation, a history consumer can choose the wrong engine before
  // the resolver gets a missing-transcript answer. Context, engine, and model are
  // preserved. The directory comes from the bootstrap that runs after the
  // recovery: it replaces a stale cached `chat.directoryFor` answer (here the
  // pre-recovery `""`) without a request of its own.

  let reservationRestored = false;
  const recoveryUtils = cachedBootstrapUtils({
    bootstraps: [{ get kind(): string {
      if (!reservationRestored) throw new Error("Codex history request failed");
      return "resumable";
    }, sessionId: coinedId, contextDir: "_content/courses", history: { entries: [], total: 0 }, label: null,
    status: { running: false, busy: false }, pending: [] }],
    directories: [""],
  });
  await recoveryUtils.utils.chat.directoryFor.fetch({ sessionId: coinedId });
  const recovered = await resolveConversation({
    utils: recoveryUtils.utils,
    reserve: async (input) => { reservationRestored = true; return reserve(input); },
    receipts: reloadedReceipts,
    request: { kind: "session", sessionId: coinedId },
  });
  const recoveryCall = reserveCalls[1];
  const recoveredContext = recovered.selection.kind === "ready" ? recovered.selection.target.contextDir : "unavailable";
  t.check(
    { kind: recovered.selection.kind, recoveredContext, networkCalls: recoveryUtils.networkCalls(),
      directoryNetworkCalls: recoveryUtils.directoryNetworkCalls(),
      cachedDirectory: recoveryUtils.cachedDirectory({ sessionId: coinedId }),
      recoveryCall: recoveryCall ? { ...recoveryCall, sessionId: "<same>" } : null,
      sameId: recoveryCall?.sessionId === coinedId },
    {
    kind: "ready",
    recoveredContext: "_content/courses",
    networkCalls: 1,
    directoryNetworkCalls: 1,
    cachedDirectory: {
      contextDir: "_content/courses",
    },
    recoveryCall: {
      sessionId: "<same>",
      contextDir: "_content/courses",
      engine: "claude",
      model: "sonnet",
    },
    sameId: true,
  },
  );
});

// ## A conversation this box cannot open becomes a new chat
//
// A load always lands on a usable chat. An id named in the URL that this box has
// no transcript for (never created, expired, ran elsewhere, being deleted) is
// replaced by a new chat in the same place; the conversation menu picks another.
// Without a matching receipt the old id is never re-reserved: a receipt stored
// for another API scope does not authorize it, so the only reservation is the
// replacement's fresh id.
void test("An id named in the URL that this box has no transcript for is replaced by a ...", async (t) => {
  const storage = new MemoryStorage();
  const paperReceipts = new ReservationReceipts(storage, "paper-cards/test1");
  paperReceipts.put({ sessionId: "other-scope-id", contextDir: "papers", engine: "claude", model: "sonnet" });
  const reserved: string[] = [];
  const reserve: ResolveParams["reserve"] = async (input) => { reserved.push(input.sessionId); return { kind: "reserved", sessionId: input.sessionId }; };
  const originalWarn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args[0]); };
  const unknownUtils = fakeUtils({ bootstraps: [unavailable("unknown-id")] });
  const unknown = await resolveConversation({ utils: unknownUtils.utils, reserve,
    receipts: paperReceipts, request: { kind: "session", sessionId: "unknown-id", contextDir: "notes" } });
  const chatReceipts = new ReservationReceipts(storage, "chat-everywhere/test1");
  const crossScopeUtils = fakeUtils({ bootstraps: [unavailable("other-scope-id")] });
  const crossScope = await resolveConversation({ utils: crossScopeUtils.utils, reserve,
    receipts: chatReceipts, request: { kind: "session", sessionId: "other-scope-id" } });
  const deletingUtils = fakeUtils({ bootstraps: [{ ...unavailable("deleting"), reason: "deletion-in-progress" }] });
  const deleting = await resolveConversation({ utils: deletingUtils.utils, reserve,
    receipts: chatReceipts, request: { kind: "session", sessionId: "deleting" } });
  console.warn = originalWarn;
  function shape(result: Awaited<ReturnType<typeof resolveConversation>>) {
    const target = result.selection.kind === "ready" ? result.selection.target : null;
    return { kind: result.selection.kind, target: target?.kind, contextDir: target?.contextDir,
      label: result.selection.kind === "ready" ? result.selection.label : null, unstarted: result.unstarted };
  }
  t.check(
    { unknown: shape(unknown), crossScope: shape(crossScope), deleting: shape(deleting),
      reusedAnOldId: reserved.some((id) => ["unknown-id", "other-scope-id", "deleting"].includes(id)),
      reserves: reserved.length, warnings: warnings.length },
    {
    unknown: { kind: "ready", target: "session", contextDir: "notes", label: "New conversation", unstarted: true },
    crossScope: { kind: "ready", target: "session", contextDir: "", label: "New conversation", unstarted: true },
    deleting: { kind: "ready", target: "session", contextDir: "", label: "New conversation", unstarted: true },
    reusedAnOldId: false,
    reserves: 3,
    warnings: 3,
  },
  );
});

// A matching receipt never makes `taken` mean success. Bootstrap is retried for
// the race where the chat became real; if it is still missing, a new chat
// replaces it under the receipt's original place.
void test("A matching receipt never makes taken mean success.", async (t) => {
  const storage = new MemoryStorage();
  const receipts = new ReservationReceipts(storage, "paper-cards/test1");
  receipts.put({ sessionId: "still-missing", contextDir: "papers", engine: "claude" });
  const outcomes: string[] = [];
  const reserve: ResolveParams["reserve"] = async (input) => {
    const kind = input.sessionId === "still-missing" ? "taken" : "reserved";
    outcomes.push(`${input.sessionId === "still-missing" ? "old" : "new"}:${kind}`);
    return kind === "taken" ? { kind } : { kind, sessionId: input.sessionId };
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  const utils = fakeUtils({ bootstraps: [unavailable("still-missing")] });
  const result = await resolveConversation({ utils: utils.utils, reserve, receipts,
    request: { kind: "session", sessionId: "still-missing" } });
  console.warn = originalWarn;
  const target = result.selection.kind === "ready" ? result.selection.target : null;
  t.check({ kind: result.selection.kind, context: target?.contextDir,
    replaced: target?.kind === "session" && target.sessionId !== "still-missing", outcomes, bootstraps: utils.bootstrapCalls() }, {
    kind: "ready",
    context: "papers",
    replaced: true,
    outcomes: ["old:taken", "new:reserved"],
    bootstraps: 1,
  });
});

// If the retry proves the chat became real, normal bootstrap wins and its stale
// receipt is removed.
void test("If the retry proves the chat became real, normal bootstrap wins and its stale...", async (t) => {
  const storage = new MemoryStorage();
  const receipts = new ReservationReceipts(storage, "paper-cards/test1");
  receipts.put({ sessionId: "became-real", contextDir: "papers", engine: "claude" });
  const utils = fakeUtils({ bootstraps: [resumable("became-real", { total: 1, contextDir: "papers" })] });
  const result = await resolveConversation({ utils: utils.utils, reserve: async () => ({ kind: "taken" }), receipts,
    request: { kind: "session", sessionId: "became-real" } });
  t.check({ kind: result.selection.kind, receipt: receipts.get("became-real") ?? null }, {
    kind: "ready",
    receipt: null,
  });
});

// ## A failed recovery is retried before a receipted chat is replaced
//
// Passive navigation can restore a remembered conversation without naming it in
// the URL. If its reservation recovery fails (the box restarting after a refused
// first send) and bootstrap then cannot find it, bootstrap's answer shows the box
// is up, so recovery runs once more. Success keeps the same chat; a second
// failure throws, so the page reports it with Retry rather than swapping to a
// different chat. An engine that no longer reserves ids means the reservation is
// gone for good: a new chat replaces it in the receipt's place.
void test("Passive navigation can restore a remembered conversation without naming it in...", async (t) => {
  const storage = new MemoryStorage();
  const receipts = new ReservationReceipts(storage, "paper-cards/test1");
  receipts.put({ sessionId: "remembered", contextDir: "papers", engine: "claude" });
  const receipt = { sessionId: "remembered", contextDir: "papers", engine: "claude" as const };
  let fallbackReserves = 0;
  const reserve: ResolveParams["reserve"] = async () => {
    fallbackReserves += 1;
    return { kind: "reserved", sessionId: `replacement-${fallbackReserves}` };
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  const request = { kind: "session" as const, sessionId: "remembered", contextDir: "elsewhere" };
  let recoveries = 0;
  const recoveredUtils = fakeUtils({ bootstraps: [unavailable("remembered"), resumable("remembered", { contextDir: "papers" })] });
  const recovered = await resolveConversation({ utils: recoveredUtils.utils, reserve, receipts, request,
    ensureReservation: async () => { recoveries += 1; if (recoveries === 1) throw new Error("server restarting"); return receipt; } });
  const downUtils = fakeUtils({ bootstraps: [unavailable("remembered")] });
  const down = await resolveConversation({ utils: downUtils.utils, reserve, receipts, request,
    ensureReservation: async () => { throw new Error("server restarting"); } }).catch((error: unknown) => error instanceof Error ? error.message : "?");
  const goneUtils = fakeUtils({ bootstraps: [{ kind: "empty" }] });
  const gone = await resolveConversation({ utils: goneUtils.utils, reserve, receipts, request,
    ensureReservation: async () => { throw new ReservationRecoveryUnsupportedError(); } });
  console.warn = originalWarn;
  t.check({ recovered: recovered.selection, recoveries, recoveredBootstraps: recoveredUtils.bootstrapCalls(),
    down, gone: gone.selection, fallbackReserves }, {
    recovered: { kind: "ready", label: "New conversation", target: { kind: "session", sessionId: "remembered", contextDir: "papers" } },
    recoveries: 2,
    recoveredBootstraps: 2,
    down: "server restarting",
    gone: { kind: "ready", label: "New conversation", target: { kind: "session", sessionId: "replacement-1", contextDir: "papers" } },
    fallbackReserves: 1,
  });
});

// ## Codex retains the existing first-send assignment path
//
// Codex cannot accept a client-coined id, so it still carries context, engine,
// model, and feature seeds in a pending `start` target.
void test("Codex cannot accept a client-coined id, so it still carries context, engine,...", async (t) => {
  const utils = fakeUtils({ boxEngine: "codex", features: { audience: "teacher" } });
  let reserves = 0;
  const result = await resolveConversation({ utils: utils.utils,
    reserve: async () => { reserves += 1; return { kind: "unsupported" }; },
    receipts: new ReservationReceipts(new MemoryStorage(), "paper-cards/test1"),
    request: { kind: "new", contextDir: "_content/lessons", model: "pinned-model" },
  });
  const target = result.selection.kind === "ready" ? result.selection.target : null;
  t.check({ target: target?.kind === "start" ? { ...target, clientConversationId: "<uuid>" } : target, reserves }, {
    target: {
      kind: "start",
      clientConversationId: "<uuid>",
      contextDir: "_content/lessons",
      engine: "codex",
      model: "pinned-model",
      seedFeatures: {
        audience: "teacher",
      },
    },
    reserves: 0,
  });
});

// ## An implicitly chosen missing transcript starts fresh
//
// An old box default or remembered chat does not require the user to recover an
// unavailable transcript. On a Codex box the replacement is a pending `start`.
void test("An old box default or remembered chat does not require the user to recover an...", async (t) => {
  const utils = fakeUtils({ boxEngine: "codex", bootstraps: [unavailable("old-default")] });
  const result = await resolveConversation({ utils: utils.utils,
    reserve: async () => ({ kind: "unsupported" }), receipts: null,
    request: { kind: "session", sessionId: "old-default", contextDir: "papers" },
  });
  const target = result.selection.kind === "ready" ? result.selection.target : null;
  t.check({ kind: result.selection.kind, target: target?.kind, contextDir: target?.contextDir }, {
    kind: "ready",
    target: "start",
    contextDir: "papers",
  });
});

// ## An unstarted chat is one this tab created and nobody has written in
//
// Openers belong on a conversation the resolver created for this tab that has no
// committed turn. The resolver already knows that: a fresh reservation leaves a
// receipt, and a `start` target has no session yet. An existing session with
// zero entries and no receipt is a different state (someone opened it before and
// wrote nothing, or another tab owns it), so it resolves `unstarted: false`
// rather than being inferred fresh from its empty history.
//
// A fresh reservation and the Codex `start` fallback are both unstarted.
void test("Openers belong on a conversation the resolver created for this tab that has n...", async (t) => {
  const receipts = new ReservationReceipts(new MemoryStorage(), "paper-cards/test1");
  const reserved = await resolveConversation({ utils: fakeUtils({ boxEngine: "claude" }).utils,
    reserve: async (input) => ({ kind: "reserved", sessionId: input.sessionId }), receipts,
    request: { kind: "new", contextDir: "" } });
  const started = await resolveConversation({ utils: fakeUtils({ boxEngine: "codex" }).utils,
    reserve: async () => ({ kind: "unsupported" }), receipts,
    request: { kind: "new", contextDir: "" } });
  t.check(({ reserved: reserved.unstarted, start: started.unstarted }), {
    reserved: true,
    start: true,
  });
});

// Reloading a reserved session that still holds this tab's receipt keeps it
// unstarted. The same empty bootstrap without a receipt is an existing empty
// session, and a session with history is resumed; neither is unstarted.
void test("Reloading a reserved session that still holds this tab's receipt keeps it uns...", async (t) => {
  const storage = new MemoryStorage();
  const receipts = new ReservationReceipts(storage, "paper-cards/test1");
  receipts.put({ sessionId: "mine", contextDir: "", engine: "claude" });
  const reserve: ResolveParams["reserve"] = async (input) => ({ kind: "reserved", sessionId: input.sessionId });
  const reload = await resolveConversation({ utils: fakeUtils({ bootstraps: [resumable("mine")] }).utils,
    reserve, receipts, request: { kind: "session", sessionId: "mine" } });
  const emptyNoReceipt = await resolveConversation({ utils: fakeUtils({ bootstraps: [resumable("someone-elses")] }).utils,
    reserve, receipts, ensureReservation: async () => null, request: { kind: "session", sessionId: "someone-elses" } });
  const resumed = await resolveConversation({ utils: fakeUtils({ bootstraps: [resumable("talked", { total: 3 })] }).utils,
    reserve, receipts, ensureReservation: async () => null, request: { kind: "session", sessionId: "talked" } });
  t.check(({ reload: reload.unstarted, emptyNoReceipt: emptyNoReceipt.unstarted, resumed: resumed.unstarted }), {
    reload: true,
    emptyNoReceipt: false,
    resumed: false,
  });

  // An untitled chat's label follows the same state. Reloading the unstarted chat
  // keeps "New conversation", the label it had before the reload; an untitled
  // session that is not unstarted reads "Conversation".

  t.check(
    ({ reload: reload.selection.kind === "ready" ? reload.selection.label : null,
      emptyNoReceipt: emptyNoReceipt.selection.kind === "ready" ? emptyNoReceipt.selection.label : null }),
    {
    reload: "New conversation",
    emptyNoReceipt: "Conversation",
  },
  );
});

// A restored `start` target (a Codex chat chosen before its first send) is
// unstarted; a restored session target is unstarted only while this tab holds
// its receipt.
void test("A restored start target (a Codex chat chosen before its first send) is unstar...", async (t) => {
  const receipts = new ReservationReceipts(new MemoryStorage(), "paper-cards/test1");
  receipts.put({ sessionId: "held", contextDir: "", engine: "claude" });
  const utils = fakeUtils({}).utils;
  const reserve: ResolveParams["reserve"] = async () => ({ kind: "unsupported" });
  const start = await resolveConversation({ utils, reserve, receipts, request: { kind: "restore",
    target: { kind: "start", clientConversationId: "c1", contextDir: "", engine: "codex", seedFeatures: {} } } });
  const held = await resolveConversation({ utils, reserve, receipts, request: { kind: "restore",
    target: { kind: "session", sessionId: "held", contextDir: "" } } });
  const other = await resolveConversation({ utils, reserve, receipts, request: { kind: "restore",
    target: { kind: "session", sessionId: "other", contextDir: "" } } });
  t.check(({ start: start.unstarted, held: held.unstarted, other: other.unstarted }), {
    start: true,
    held: true,
    other: false,
  });
});
