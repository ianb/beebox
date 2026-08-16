# Exhibits API: documents, events, captures

The three file-backed primitives an exhibit page writes through. They ride the
exhibits origin's auth hook, resolve under the store root, and leave ordinary
files behind — `data/<key>.json`, `events.jsonl`, `captures/<name>` — because
the consumer is an agent reading the directory, not another API.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildExhibitsApp } from "../src/server/exhibits/app.js";
import type { ExhibitsAssets } from "../src/server/exhibits/assets.js";
import { EXHIBITS_COOKIE } from "../src/server/exhibits/auth.js";
import { STORE_MARKER } from "../src/server/exhibits/store.js";

const TOKEN = "exhibits-test-token-0123456789";
const authorized = { cookie: `${EXHIBITS_COOKIE}=${TOKEN}` };
const json = { ...authorized, "content-type": "application/json" };

function fakeAssets(): ExhibitsAssets {
  return {
    transformIndexHtml: async (_url, html) => html,
    preflightModule: async () => {},
    noticeExhibit: () => {},
    handle: (_exchange, next) => next(),
    close: async () => {},
  };
}

/** One workstream exhibit; the apps namespace is created by writing to it. */
async function makeStore(): Promise<string> {
  // realpath: containment answers in canonical paths, and macOS tmpdir is a symlink.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "exhibits-api-")));
  await fs.writeFile(path.join(root, STORE_MARKER), "");
  await fs.mkdir(path.join(root, "demo-ws/instrument"), { recursive: true });
  return root;
}

async function makeApp(storeRoot: string) {
  return buildExhibitsApp({
    storeRoot,
    appsRoot: path.join(storeRoot, "unused-apps-root"),
    token: TOKEN,
    createAssets: async () => fakeAssets(),
  });
}

const store = await makeStore();
const app = await makeApp(store);
const scope = "/api/demo-ws/instrument";
```

## The API inherits the origin's auth

The routes are registered on the exhibits instance, so the same cookie hook that
guards pages guards writes. A write surface registered anywhere else would be
unauthenticated — that is the whole reason this is a plugin on that instance.

```ts
const anonymous = await app.inject({
  method: "PUT",
  url: `${scope}/data/settings`,
  headers: { "content-type": "application/json" },
  payload: '{"threshold":0.4}',
});
JSON.stringify({ status: anonymous.statusCode, hint: anonymous.body.includes("bin/exhibits url") })
=> {"status":401,"hint":true}
```

## Documents round-trip

`PUT` replaces a whole JSON document; `GET` hands it back. The key names the
document and the server owns the extension, so a page cannot choose what kind of
file it writes.

```ts continue
const saved = await app.inject({ method: "PUT", url: `${scope}/data/settings`, headers: json, payload: '{"threshold":0.4}' });
const loaded = await app.inject({ method: "GET", url: `${scope}/data/settings`, headers: authorized });
const onDisk = await fs.readFile(path.join(store, "demo-ws/instrument/data/settings.json"), "utf8");
JSON.stringify({
  saved: saved.statusCode,
  loaded: loaded.statusCode,
  type: loaded.headers["content-type"],
  body: loaded.body,
  onDisk,
})
=> {"saved":200,"loaded":200,"type":"application/json; charset=utf-8","body":"{\"threshold\":0.4}","onDisk":"{\"threshold\":0.4}"}
```

A document that was never saved is a 404 with a JSON body, so `Storage.load()`
can return `null` without guessing; a body that is not JSON is refused before
anything is written.

```ts continue
const missing = await app.inject({ method: "GET", url: `${scope}/data/nothing-here`, headers: authorized });
const malformed = await app.inject({ method: "PUT", url: `${scope}/data/settings`, headers: json, payload: "{oops" });
const unchanged = await fs.readFile(path.join(store, "demo-ws/instrument/data/settings.json"), "utf8");
JSON.stringify({
  missing: missing.statusCode,
  missingError: JSON.parse(missing.body).error,
  malformed: malformed.statusCode,
  malformedError: JSON.parse(malformed.body).error.startsWith("The document body must be valid JSON:"),
  unchanged,
})
=> {"missing":404,"missingError":"No document \"nothing-here\" in this exhibit.","malformed":400,"malformedError":true,"unchanged":"{\"threshold\":0.4}"}
```

## A concurrent writer never publishes half a file

Writes are temp-file-plus-rename, so a reader either sees the old document or
the new one. Twenty interleaved writes of two different documents leave a file
that parses, and no temp files behind.

```ts continue
const bodies = [JSON.stringify({ who: "a".repeat(20_000) }), JSON.stringify({ who: "b".repeat(20_000) })];
await Promise.all(
  Array.from({ length: 20 }, (_unused, index) =>
    app.inject({ method: "PUT", url: `${scope}/data/racy`, headers: json, payload: bodies[index % 2] })),
);
const racy = await fs.readFile(path.join(store, "demo-ws/instrument/data/racy.json"), "utf8");
const entries = await fs.readdir(path.join(store, "demo-ws/instrument/data"));
JSON.stringify({
  parses: bodies.includes(racy),
  who: JSON.parse(racy).who.length,
  entries: entries.toSorted(),
})
=> {"parses":true,"who":20000,"entries":["racy.json","settings.json"]}
```

## Events append, and the server stamps them

`POST events` appends one JSON line; the server adds `at` so page clocks never
decide the order of a log. The server never reads the file back — agents do,
from disk.

```ts continue
await app.inject({ method: "POST", url: `${scope}/events`, headers: json, payload: JSON.stringify({ log: "ratings", data: { figure: "A1" } }) });
await app.inject({ method: "POST", url: `${scope}/events`, headers: json, payload: JSON.stringify({ log: "disposition", data: { choice: "A" } }) });
await Promise.all(
  Array.from({ length: 8 }, (_unused, index) =>
    app.inject({ method: "POST", url: `${scope}/events`, headers: json, payload: JSON.stringify({ log: "burst", data: index }) })),
);
const lines = (await fs.readFile(path.join(store, "demo-ws/instrument/events.jsonl"), "utf8")).trim().split("\n");
const parsed = lines.map((line) => JSON.parse(line));
JSON.stringify({
  lines: lines.length,
  logs: parsed.slice(0, 2).map((entry) => entry.log),
  data: parsed[0].data,
  stamped: parsed.every((entry) => typeof entry.at === "string" && !Number.isNaN(Date.parse(entry.at))),
  burst: parsed.filter((entry) => entry.log === "burst").map((entry) => entry.data).toSorted((a, b) => a - b),
})
=> {"lines":10,"logs":["ratings","disposition"],"data":{"figure":"A1"},"stamped":true,"burst":[0,1,2,3,4,5,6,7]}
```

An envelope that is not `{ log, data }` is refused with the Zod issues, not
silently appended.

```ts continue
const bad = await app.inject({ method: "POST", url: `${scope}/events`, headers: json, payload: JSON.stringify({ data: 1 }) });
JSON.stringify({ status: bad.statusCode, body: JSON.parse(bad.body) })
=> {"status":400,"body":{"error":"An event is { \"log\": <name>, \"data\": <anything> }.","issues":["log: Invalid input: expected string, received undefined"]}}
```

## Captures are records

Raw bytes land under `captures/`, once. A repeat of the same name is a conflict
rather than a silent replacement, the extension is allowlisted, and the cap is
the capture cap (25 MB) rather than the document cap.

```ts continue
const first = await app.inject({
  method: "POST",
  url: `${scope}/captures/take-01.png`,
  headers: { ...authorized, "content-type": "image/png" },
  payload: Buffer.from("PNG-ish bytes"),
});
const again = await app.inject({
  method: "POST",
  url: `${scope}/captures/take-01.png`,
  headers: { ...authorized, "content-type": "image/png" },
  payload: Buffer.from("different bytes"),
});
const bytes = await fs.readFile(path.join(store, "demo-ws/instrument/captures/take-01.png"), "utf8");
const big = await app.inject({
  method: "POST",
  url: `${scope}/captures/take-02.webm`,
  headers: { ...authorized, "content-type": "video/webm" },
  payload: Buffer.alloc(2 * 1024 * 1024, 7),
});
JSON.stringify({
  first: first.statusCode,
  again: again.statusCode,
  conflict: JSON.parse(again.body).error,
  bytes,
  overDocumentCap: big.statusCode,
})
=> {"first":201,"again":409,"conflict":"Capture \"take-01.png\" already exists; captures are records and are never replaced.","bytes":"PNG-ish bytes","overDocumentCap":201}
```

Anything the origin might execute is refused by omission from the allowlist, and
so is anything that is not one path segment.

```ts continue
const source = await app.inject({ method: "POST", url: `${scope}/captures/page.tsx`, headers: authorized, payload: "export default 1" });
const page = await app.inject({ method: "POST", url: `${scope}/captures/evil.html`, headers: authorized, payload: "<script>" });
const traversal = await app.inject({ method: "POST", url: `${scope}/captures/..%2f..%2fescape.png`, headers: authorized, payload: "x" });
const keyTraversal = await app.inject({ method: "PUT", url: `${scope}/data/..%2f..%2fescape`, headers: json, payload: "{}" });
const extension = await app.inject({ method: "PUT", url: `${scope}/data/settings.json`, headers: json, payload: "{}" });
JSON.stringify({
  source: source.statusCode,
  sourceError: JSON.parse(source.body).error.startsWith('Capture "page.tsx" is not an allowed kind.'),
  page: page.statusCode,
  traversal: traversal.statusCode,
  keyTraversal: keyTraversal.statusCode,
  extension: extension.statusCode,
  extensionError: JSON.parse(extension.body).error,
  escaped: await fs.readdir(path.dirname(store)).then((names) => names.includes("escape.png")),
})
=> {"source":400,"sourceError":true,"page":400,"traversal":400,"keyTraversal":400,"extension":400,"extensionError":"Invalid document key \"settings.json\": keys carry no extension — the server stores <key>.json.","escaped":false}
```

## Caps name themselves

A document over 1 MB is refused with the cap in the message, so a page that
outgrew the primitive learns which one it hit.

```ts continue
const oversize = await app.inject({
  method: "PUT",
  url: `${scope}/data/huge`,
  headers: json,
  payload: JSON.stringify({ blob: "x".repeat(1024 * 1024) }),
});
JSON.stringify({ status: oversize.statusCode, body: JSON.parse(oversize.body) })
=> {"status":413,"body":{"error":"Request body is too large: this route accepts at most 1 MB."}}
```

## A committed app's data lives in the store

`/apps/<name>/` serves tracked code from the main checkout, but its writes land
in the reserved `apps/` store namespace — created on first write, since nothing
else creates it. Using an app never dirties a checkout.

```ts continue
const appWrite = await app.inject({
  method: "PUT",
  url: "/api/apps/story-eval/data/state",
  headers: json,
  payload: '{"run":"2026-08-15"}',
});
const appData = await fs.readFile(path.join(store, "apps/story-eval/data/state.json"), "utf8");
const unknownExhibit = await app.inject({ method: "PUT", url: "/api/demo-ws/never-created/data/x", headers: json, payload: "{}" });
JSON.stringify({
  status: appWrite.statusCode,
  appData,
  unknownExhibit: unknownExhibit.statusCode,
  unknownError: JSON.parse(unknownExhibit.body).error,
})
=> {"status":200,"appData":"{\"run\":\"2026-08-15\"}","unknownExhibit":404,"unknownError":"No exhibit at demo-ws/never-created in the store."}
```

```ts cleanup
await app.close();
await fs.rm(store, { recursive: true, force: true });
```

## An unmarked directory is not a store

The API fails closed on the marker for the same reason the page routes do: an
unmarked directory is refused rather than adopted.

```ts
const unmarked = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "exhibits-api-unmarked-")));
const refusing = await makeApp(unmarked);
const refused = await refusing.inject({ method: "PUT", url: "/api/demo-ws/x/data/y", headers: json, payload: "{}" });
JSON.stringify({ status: refused.statusCode, marker: JSON.parse(refused.body).error.includes(STORE_MARKER) })
=> {"status":503,"marker":true}
```

```ts cleanup
await refusing.close();
await fs.rm(unmarked, { recursive: true, force: true });
```
