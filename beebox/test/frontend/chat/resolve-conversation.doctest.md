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

After the server forgets the reservation, bootstrap first reports the exact id
missing. The matching receipt authorizes re-reserving that same id and retrying
bootstrap once; context, engine, and model are preserved.

```ts continue
const recoveryUtils = cachedBootstrapUtils({
  bootstraps: [unavailable(coinedId), resumable(coinedId)],
  directories: ["", "_content/courses"],
});
await recoveryUtils.utils.chat.directoryFor.fetch({ sessionId: coinedId });
const recovered = await resolveConversation({
  utils: recoveryUtils.utils, reserve, receipts: reloadedReceipts,
  request: { kind: "session", sessionId: coinedId },
});
const recoveryCall = reserveCalls[1];
const recoveredContext = recovered.selection.kind === "ready" ? recovered.selection.target.contextDir : "unavailable";
JSON.stringify({ kind: recovered.selection.kind, recoveredContext, networkCalls: recoveryUtils.networkCalls(),
  directoryNetworkCalls: recoveryUtils.directoryNetworkCalls(),
  recoveryCall: recoveryCall ? { ...recoveryCall, sessionId: "<same>" } : null,
  sameId: recoveryCall?.sessionId === coinedId })
=> {"kind":"ready","recoveredContext":"_content/courses","networkCalls":2,"directoryNetworkCalls":2,"recoveryCall":{"sessionId":"<same>","contextDir":"_content/courses","engine":"claude","model":"sonnet"},"sameId":true}
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
  receipts: paperReceipts, request: { kind: "session", sessionId: "unknown-id" } });
const chatReceipts = new ReservationReceipts(storage, "chat-everywhere/test1");
const crossScopeUtils = fakeUtils({ bootstraps: [unavailable("other-scope-id")] });
const crossScope = await resolveConversation({ utils: crossScopeUtils.utils, reserve,
  receipts: chatReceipts, request: { kind: "session", sessionId: "other-scope-id" } });
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
const utils = fakeUtils({ bootstraps: [unavailable("still-missing"), { kind: "empty" }] });
const result = await resolveConversation({ utils: utils.utils, reserve, receipts,
  request: { kind: "session", sessionId: "still-missing" } });
const context = result.selection.kind === "unavailable" ? result.selection.contextDir : "wrong";
JSON.stringify({ kind: result.selection.kind, context, reserves, bootstraps: utils.bootstrapCalls() })
=> {"kind":"unavailable","context":"papers","reserves":1,"bootstraps":2}
```

If the retry proves the chat became real, normal bootstrap wins and its stale
receipt is removed.

```ts
const storage = new MemoryStorage();
const receipts = new ReservationReceipts(storage, "paper-cards/test1");
receipts.put({ sessionId: "became-real", contextDir: "papers", engine: "claude" });
const utils = fakeUtils({ bootstraps: [unavailable("became-real"), resumable("became-real", 1)], directory: "papers" });
const result = await resolveConversation({ utils: utils.utils, reserve: async () => ({ kind: "taken" }), receipts,
  request: { kind: "session", sessionId: "became-real" } });
JSON.stringify({ kind: result.selection.kind, receipt: receipts.get("became-real") ?? null })
=> {"kind":"ready","receipt":null}
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
