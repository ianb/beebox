# last-chat — the chat the app bar's back chip returns to

`lib/last-chat.ts` carries the one thing the place-switch menu cannot: *which
session you were in*. The switch menu moves between landmarks and resumes each
one's newest chat, which need not be the chat you left
(`issues/bugs/2026-08-23-no-consistent-way-back-to-chat.md`).

The frontend doctests run under plain Node with no jsdom, so a fake stands in
for `sessionStorage` — the module reads it off `globalThis` per call for exactly
that reason. Each case uses its own box slug: the module caches one snapshot per
box, and a shared slug would leak state between cases.

```ts setup
const store = new Map<string, string>();
let failWrites = false;
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("quota");
      store.set(key, value);
    },
  },
});

const { rememberLastChat, readLastChat, subscribeToLastChat } =
  await import("../../../src/frontend/src/lib/last-chat.js");
```

## What the chat page records is what a later page reads

```ts
rememberLastChat("boxA", { sessionId: "abc-123", label: "Bread notes" });

store.get("bbx:last-chat:boxA")
=> {"sessionId":"abc-123","label":"Bread notes"}
```

A value already in storage — the case that matters, since the page holding the
back chip is a *different* page load from the chat that wrote it — reads back
the same shape:

```ts continue
store.set("bbx:last-chat:boxB", JSON.stringify({ sessionId: "s9", label: "Groceries" }));

JSON.stringify(readLastChat("boxB"))
=> {"sessionId":"s9","label":"Groceries"}
```

A box this tab has never chatted in offers nothing, which is what hides the
chip:

```ts continue
readLastChat("boxUnvisited")
=> null
```

## Subscribers hear a change, and only a real one

The chat page records from an effect keyed on the session id and its label, and
`ChatBarChrome` re-renders on every streamed token. A no-op write must not wake
the app bar.

```ts
let notified = 0;
const unsubscribe = subscribeToLastChat(() => { notified += 1; });

rememberLastChat("boxC", { sessionId: "s1", label: null });
rememberLastChat("boxC", { sessionId: "s1", label: null });
rememberLastChat("boxC", { sessionId: "s1", label: "Named later" });

notified
=> 2
```

```ts continue cleanup
unsubscribe();
```

## Unreadable storage is a missing chip, not a crash

Anything that is not a record with a non-empty `sessionId` is discarded: a
half-written value, a key an older version of the app wrote, a truncated
string. A present-but-wrong `label` degrades to unnamed rather than failing the
whole record — the chip's link still works without a name.

```ts
store.set("bbx:last-chat:boxD", "{ not json");
store.set("bbx:last-chat:boxE", JSON.stringify({ label: "no id" }));
store.set("bbx:last-chat:boxF", JSON.stringify({ sessionId: "" }));
store.set("bbx:last-chat:boxG", JSON.stringify({ sessionId: "s2", label: 7 }));

JSON.stringify([
  readLastChat("boxD"),
  readLastChat("boxE"),
  readLastChat("boxF"),
  readLastChat("boxG"),
])
=> [null,null,null,{"sessionId":"s2","label":null}]
```

## A storage that refuses the write still offers the chip on this page

Losing the write costs surviving a reload, nothing more — the in-memory
snapshot is what the bar reads.

```ts
failWrites = true;
rememberLastChat("boxH", { sessionId: "s3", label: null });

JSON.stringify({ stored: store.get("bbx:last-chat:boxH") ?? null, live: readLastChat("boxH") })
=> {"stored":null,"live":{"sessionId":"s3","label":null}}
```

```ts continue cleanup
failWrites = false;
```
