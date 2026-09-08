# Conversation reservation recovery

A Claude chat is addressable before its first message so fullscreen capture can
target it. The same-tab receipt proves which otherwise-empty id this client
reserved, allowing an exact re-reservation after a server restart without
turning arbitrary missing ids into new chats.

```ts setup
import { resolveConversation } from "../../../src/frontend/src/components/chat/everywhere/resolve-conversation.js";
import { ReservationReceipts } from "../../../src/frontend/src/components/chat/everywhere/reservation-receipts.js";
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
function resumable(sessionId: string, total = 0) {
  return { kind: "resumable", sessionId,
    history: { entries: total === 0 ? [] : [{ type: "user" }], total }, label: null,
    status: { running: false, busy: false }, pending: [] };
}
function fakeUtils(options: {
  boxEngine?: "claude" | "codex";
  features?: Record<string, string>;
  bootstraps?: object[];
  directory?: string;
}): { utils: ResolveParams["utils"]; bootstrapCalls: () => number } {
  let bootstrapCalls = 0;
  return {
    utils: {
      chat: {
        status: { fetch: async () => ({ boxEngine: options.boxEngine ?? "claude" }) },
        newFeatures: { fetch: async () => options.features ?? {} },
        bootstrap: { fetch: async () => options.bootstraps?.[bootstrapCalls++] },
        directoryFor: { fetch: async () => ({ contextDir: options.directory ?? "" }) },
      },
    } as unknown as ResolveParams["utils"],
    bootstrapCalls: () => bootstrapCalls,
  };
}
function cachedBootstrapUtils(options: {
  bootstraps: object[];
  directories: string[];
}): { utils: ResolveParams["utils"]; networkCalls: () => number; directoryNetworkCalls: () => number } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5000, retry: false } } });
  let networkCalls = 0;
  let directoryNetworkCalls = 0;
  return {
    utils: {
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
        }) },
      },
    } as unknown as ResolveParams["utils"],
    networkCalls: () => networkCalls,
    directoryNetworkCalls: () => directoryNetworkCalls,
  };
}
```

## A fresh reservation writes its receipt before exposing the id

Constructing a new store over the same storage simulates a reload in that tab.
The server-minted id and all context needed to repeat the reservation survive.

```ts
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
JSON.stringify({ target: freshTarget?.kind, targetContext: freshTarget?.contextDir,
  receipt: receipt ? { ...receipt, sessionId: "<same>" } : null, calls: reserveCalls.length })
=> {"target":"session","targetContext":"_content/courses","receipt":{"sessionId":"<same>","contextDir":"_content/courses","engine":"claude","model":"sonnet"},"calls":1}
```

After the server forgets the reservation, the matching receipt authorizes
re-reserving that same id before bootstrap. This matters on a Codex-default box:
without the reservation, a history consumer can choose the wrong engine before
the resolver gets a missing-transcript answer. Context, engine, and model are
preserved.

```ts continue
let reservationRestored = false;
const recoveryUtils = cachedBootstrapUtils({
  bootstraps: [{ get kind(): string {
    if (!reservationRestored) throw new Error("Codex history request failed");
    return "resumable";
  }, sessionId: coinedId, history: { entries: [], total: 0 }, label: null,
  status: { running: false, busy: false }, pending: [] }],
  directories: ["", "_content/courses"],
});
await recoveryUtils.utils.chat.directoryFor.fetch({ sessionId: coinedId });
const recovered = await resolveConversation({
  utils: recoveryUtils.utils,
  reserve: async (input) => { reservationRestored = true; return reserve(input); },
  receipts: reloadedReceipts,
  request: { kind: "session", named: true, sessionId: coinedId },
});
const recoveryCall = reserveCalls[1];
const recoveredContext = recovered.selection.kind === "ready" ? recovered.selection.target.contextDir : "unavailable";
JSON.stringify({ kind: recovered.selection.kind, recoveredContext, networkCalls: recoveryUtils.networkCalls(),
  directoryNetworkCalls: recoveryUtils.directoryNetworkCalls(),
  recoveryCall: recoveryCall ? { ...recoveryCall, sessionId: "<same>" } : null,
  sameId: recoveryCall?.sessionId === coinedId })
=> {"kind":"ready","recoveredContext":"_content/courses","networkCalls":1,"directoryNetworkCalls":2,"recoveryCall":{"sessionId":"<same>","contextDir":"_content/courses","engine":"claude","model":"sonnet"},"sameId":true}
```

## Missing ids without exact local provenance remain unavailable

An arbitrary explicit id has no receipt, and a receipt stored for another API
scope cannot authorize it. Neither case calls the reservation endpoint.

```ts
const storage = new MemoryStorage();
const paperReceipts = new ReservationReceipts(storage, "paper-cards/test1");
paperReceipts.put({ sessionId: "other-scope-id", contextDir: "papers", engine: "claude", model: "sonnet" });
let reserves = 0;
const reserve: ResolveParams["reserve"] = async () => { reserves += 1; return { kind: "taken" }; };
const unknownUtils = fakeUtils({ bootstraps: [unavailable("unknown-id")] });
const unknown = await resolveConversation({ utils: unknownUtils.utils, reserve,
  receipts: paperReceipts, request: { kind: "session", named: true, sessionId: "unknown-id" } });
const chatReceipts = new ReservationReceipts(storage, "chat-everywhere/test1");
const crossScopeUtils = fakeUtils({ bootstraps: [unavailable("other-scope-id")] });
const crossScope = await resolveConversation({ utils: crossScopeUtils.utils, reserve,
  receipts: chatReceipts, request: { kind: "session", named: true, sessionId: "other-scope-id" } });
JSON.stringify({ unknown: unknown.selection.kind, crossScope: crossScope.selection.kind, reserves,
  unknownBootstraps: unknownUtils.bootstrapCalls(), crossScopeBootstraps: crossScopeUtils.bootstrapCalls() })
=> {"unknown":"unavailable","crossScope":"unavailable","reserves":0,"unknownBootstraps":1,"crossScopeBootstraps":1}
```

A matching receipt never makes `taken` mean success. Bootstrap is retried for
the race where the chat became real; if it is still missing or empty, it stays
unavailable under the receipt's original landmark.

```ts
const storage = new MemoryStorage();
const receipts = new ReservationReceipts(storage, "paper-cards/test1");
receipts.put({ sessionId: "still-missing", contextDir: "papers", engine: "claude" });
let reserves = 0;
const reserve: ResolveParams["reserve"] = async () => { reserves += 1; return { kind: "taken" }; };
const utils = fakeUtils({ bootstraps: [{ kind: "empty" }] });
const result = await resolveConversation({ utils: utils.utils, reserve, receipts,
  request: { kind: "session", named: true, sessionId: "still-missing" } });
const context = result.selection.kind === "unavailable" ? result.selection.contextDir : "wrong";
JSON.stringify({ kind: result.selection.kind, context, reserves, bootstraps: utils.bootstrapCalls() })
=> {"kind":"unavailable","context":"papers","reserves":1,"bootstraps":1}
```

If the retry proves the chat became real, normal bootstrap wins and its stale
receipt is removed.

```ts
const storage = new MemoryStorage();
const receipts = new ReservationReceipts(storage, "paper-cards/test1");
receipts.put({ sessionId: "became-real", contextDir: "papers", engine: "claude" });
const utils = fakeUtils({ bootstraps: [resumable("became-real", 1)], directory: "papers" });
const result = await resolveConversation({ utils: utils.utils, reserve: async () => ({ kind: "taken" }), receipts,
  request: { kind: "session", named: true, sessionId: "became-real" } });
JSON.stringify({ kind: result.selection.kind, receipt: receipts.get("became-real") ?? null })
=> {"kind":"ready","receipt":null}
```

## A proven implicit selection never silently changes identity

Passive navigation can restore a remembered conversation without naming it in
the URL. Its exact receipt remains identity evidence even when the recovery
request itself fails: a missing or unexpectedly empty bootstrap must stay on
that conversation rather than minting a fresh default chat.

```ts
const storage = new MemoryStorage();
const receipts = new ReservationReceipts(storage, "paper-cards/test1");
receipts.put({ sessionId: "remembered", contextDir: "papers", engine: "claude" });
let fallbackReserves = 0;
const reserve: ResolveParams["reserve"] = async () => {
  fallbackReserves += 1;
  return { kind: "reserved", sessionId: "replacement" };
};
const originalWarn = console.warn;
console.warn = () => {};
const missingUtils = fakeUtils({ bootstraps: [unavailable("remembered")] });
const missing = await resolveConversation({ utils: missingUtils.utils, reserve, receipts,
  ensureReservation: async () => { throw new Error("server restarting"); },
  request: { kind: "session", sessionId: "remembered", contextDir: "elsewhere" } });
const emptyUtils = fakeUtils({ bootstraps: [{ kind: "empty" }] });
const empty = await resolveConversation({ utils: emptyUtils.utils, reserve, receipts,
  ensureReservation: async () => { throw new Error("server restarting"); },
  request: { kind: "session", sessionId: "remembered", contextDir: "elsewhere" } });
console.warn = originalWarn;
JSON.stringify({ missing: missing.selection, empty: empty.selection, fallbackReserves })
=> {"missing":{"kind":"unavailable","contextDir":"papers","reason":"This conversation has no saved transcript in this box."},"empty":{"kind":"unavailable","contextDir":"papers","reason":"This conversation has no saved transcript in this box."},"fallbackReserves":0}
```

## Codex retains the existing first-send assignment path

Codex cannot accept a client-coined id, so it still carries context, engine,
model, and feature seeds in a pending `start` target.

```ts
const utils = fakeUtils({ boxEngine: "codex", features: { audience: "teacher" } });
let reserves = 0;
const result = await resolveConversation({ utils: utils.utils,
  reserve: async () => { reserves += 1; return { kind: "unsupported" }; },
  receipts: new ReservationReceipts(new MemoryStorage(), "paper-cards/test1"),
  request: { kind: "new", contextDir: "_content/lessons", model: "gpt-5" },
});
const target = result.selection.kind === "ready" ? result.selection.target : null;
JSON.stringify({ target: target?.kind === "start" ? { ...target, clientConversationId: "<uuid>" } : target, reserves })
=> {"target":{"kind":"start","clientConversationId":"<uuid>","contextDir":"_content/lessons","engine":"codex","model":"gpt-5","seedFeatures":{"audience":"teacher"}},"reserves":0}
```

## An implicitly chosen missing transcript starts fresh

An old box default or remembered chat does not require the user to recover an
unavailable transcript. Explicit picks above still preserve the requested id.

```ts
const utils = fakeUtils({ boxEngine: "codex", bootstraps: [unavailable("old-default")] });
const result = await resolveConversation({ utils: utils.utils,
  reserve: async () => ({ kind: "unsupported" }), receipts: null,
  request: { kind: "session", sessionId: "old-default", contextDir: "papers" },
});
const target = result.selection.kind === "ready" ? result.selection.target : null;
JSON.stringify({ kind: result.selection.kind, target: target?.kind, contextDir: target?.contextDir })
=> {"kind":"ready","target":"start","contextDir":"papers"}
```
