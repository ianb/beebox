# Exhibits surface

The exhibits listener is a second Fastify instance on its own origin: it serves
the persistent exhibit store (and the main checkout's committed apps) to the
developer, and it is the only origin on which agent-written pages script. The
compile half is injected, so these tests exercise routing, auth, containment,
and manifest handling without starting a dev server.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildExhibitsApp } from "../src/server/exhibits/app.js";
import type { ExhibitsAssets } from "../src/server/exhibits/assets.js";
import { EXHIBITS_COOKIE } from "../src/server/exhibits/auth.js";
import { STORE_MARKER } from "../src/server/exhibits/store.js";

const TOKEN = "exhibits-test-token-0123456789";
const EXHIBITS_PORT = 3230;

interface FakeAssets extends ExhibitsAssets {
  noticed: string[];
  compileError: string | null;
}

function fakeAssets(): FakeAssets {
  const assets: FakeAssets = {
    noticed: [],
    compileError: null,
    transformIndexHtml: async (_url, html) => html.replace("<body>", '<body data-vite="1">'),
    preflightModule: async () => {
      if (assets.compileError !== null) throw new Error(assets.compileError);
    },
    noticeExhibit: (dir) => {
      if (!assets.noticed.includes(dir)) assets.noticed.push(dir);
    },
    handle: (exchange, next) => next(),
    close: async () => {},
  };
  return assets;
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

function manifest(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    title: "A title",
    created: "2026-08-15T00:00:00Z",
    ask: { type: "fyi", prose: "Nothing needed." },
    ...overrides,
  });
}

/** A store fixture with one exhibit of every tier plus two broken ones. */
async function makeStore(): Promise<string> {
  // realpath: containment answers in canonical paths, and macOS tmpdir is a symlink.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "exhibits-store-")));
  await writeFile(path.join(root, STORE_MARKER), "");
  const ws = path.join(root, "demo-ws");

  await writeFile(path.join(ws, "passive/exhibit.json"), manifest({
    title: "Six screenshots",
    ask: { type: "decide", prose: "Which layout ships?", options: ["A", "B"] },
    figures: [{ label: "A1", file: "shot.png", caption: "Wide layout" }],
  }));
  await writeFile(path.join(ws, "passive/doc.md"), "# Notes\n\nA1 is the wide one.\n");
  await writeFile(path.join(ws, "passive/shot.png"), "not-really-a-png");

  await writeFile(path.join(ws, "instrument/exhibit.json"), manifest({ title: "Threshold tuner" }));
  await writeFile(path.join(ws, "instrument/index.tsx"), "export default function Page() { return null; }\n");

  await writeFile(path.join(ws, "plain/exhibit.json"), manifest({ title: "Vanilla page" }));
  await writeFile(path.join(ws, "plain/index.html"), "<!doctype html><p>plain</p>\n");
  await writeFile(path.join(ws, "plain/data.json"), '{"ok":true}\n');

  await writeFile(path.join(ws, "malformed/exhibit.json"), JSON.stringify({ title: "No ask", created: "x" }));
  await writeFile(path.join(ws, "malformed/index.html"), "<p>content without an ask</p>\n");

  await writeFile(path.join(ws, "unmanifested/index.tsx"), "export default function Page() { return null; }\n");
  return root;
}

async function makeApp(storeRoot: string, assets: ExhibitsAssets) {
  return buildExhibitsApp({
    storeRoot,
    appsRoot: path.join(storeRoot, "apps"),
    token: TOKEN,
    port: EXHIBITS_PORT,
    createAssets: async () => assets,
  });
}

const authorized = { cookie: `${EXHIBITS_COOKIE}=${TOKEN}` };
```

## Token, then cookie

Access follows Jupyter's handshake. A request with no credential is refused with
a real page carrying the command that prints an authorized URL — never a silent
empty page, and never a bare text/plain line, because this refusal is the first
thing most developers see on this origin. `?token=` on a GET exchanges the
machine-scoped token for an origin-scoped session cookie and redirects to the
clean URL, so the capability leaves the address bar.

```ts
const store = await makeStore();
const assets = fakeAssets();
const app = await makeApp(store, assets);

const anonymous = await app.inject({ method: "GET", url: "/" });
JSON.stringify({
  status: anonymous.statusCode,
  type: anonymous.headers["content-type"],
  title: anonymous.body.includes("<title>Exhibits need a token</title>"),
  command: anonymous.body.includes("<code>bin/exhibits url &lt;workstream&gt;/&lt;exhibit&gt;</code>"),
})
=> {"status":401,"type":"text/html; charset=utf-8","title":true,"command":true}

const wrongToken = await app.inject({ method: "GET", url: "/?token=not-the-token" });
const wrongCookie = await app.inject({ method: "GET", url: "/", headers: { cookie: `${EXHIBITS_COOKIE}=nope` } });
JSON.stringify({ query: wrongToken.statusCode, cookie: wrongCookie.statusCode })
=> {"query":401,"cookie":401}

const exchanged = await app.inject({ method: "GET", url: `/demo-ws/?token=${TOKEN}&keep=1` });
JSON.stringify({
  status: exchanged.statusCode,
  location: exchanged.headers.location,
  cookie: exchanged.headers["set-cookie"],
})
=> {"status":302,"location":"/demo-ws/?keep=1","cookie":"cb_exhibits_session=exhibits-test-token-0123456789; Path=/; HttpOnly; SameSite=Lax"}
```

## Listings

The root lists workstreams; a workstream lists its exhibits with ask badges and
names the ones whose manifest is unusable rather than hiding them.

```ts continue
const root = await app.inject({ method: "GET", url: "/", headers: authorized });
JSON.stringify({ status: root.statusCode, hasWorkstream: root.body.includes('href="/demo-ws/"') })
=> {"status":200,"hasWorkstream":true}

const listing = await app.inject({ method: "GET", url: "/demo-ws/", headers: authorized });
JSON.stringify({
  status: listing.statusCode,
  decide: listing.body.includes("badge-decide"),
  title: listing.body.includes("Six screenshots"),
  malformed: listing.body.includes("ask: Invalid input"),
})
=> {"status":200,"decide":true,"title":true,"malformed":true}
```

## Page tiers

`index.tsx` gets the container shell booting the module through `/@fs`;
`index.html` is served as-is (this origin exists so agent pages can script);
neither gets the default renderer, with the manifest and `doc.md` handed to the
container in the boot payload. Serving a not-yet-seen exhibit invalidates the
Tailwind CSS module, because nothing in the store is in Vite's module graph
until it is imported.

```ts continue
const instrument = await app.inject({ method: "GET", url: "/demo-ws/instrument/", headers: authorized });
JSON.stringify({
  status: instrument.statusCode,
  module: instrument.body.includes(`"module":"/@fs${path.join(store, "demo-ws/instrument/index.tsx")}"`),
  transformed: instrument.body.includes('data-vite="1"'),
  noticed: assets.noticed.length,
})
=> {"status":200,"module":true,"transformed":true,"noticed":1}

const passive = await app.inject({ method: "GET", url: "/demo-ws/passive/", headers: authorized });
JSON.stringify({
  status: passive.statusCode,
  module: passive.body.includes('"module":null'),
  doc: passive.body.includes("A1 is the wide one."),
  scope: passive.body.includes('"scope":"demo-ws/passive"'),
})
=> {"status":200,"module":true,"doc":true,"scope":true}

const plain = await app.inject({ method: "GET", url: "/demo-ws/plain/", headers: authorized });
JSON.stringify({ status: plain.statusCode, body: plain.body.trim(), type: plain.headers["content-type"] })
=> {"status":200,"body":"<!doctype html><p>plain</p>","type":"text/html; charset=utf-8"}

const sibling = await app.inject({ method: "GET", url: "/demo-ws/plain/data.json", headers: authorized });
JSON.stringify({ status: sibling.statusCode, type: sibling.headers["content-type"], body: sibling.body.trim() })
=> {"status":200,"type":"application/json; charset=utf-8","body":"{\"ok\":true}"}
```

A page that fails to compile becomes a real error page. In middleware mode Vite
logs transform errors and calls `next()` without them, so the shell route
preflights the module to get the error at all.

```ts continue
assets.compileError = "Unexpected token (3:1)";
const broken = await app.inject({ method: "GET", url: "/demo-ws/instrument/", headers: authorized });
assets.compileError = null;
JSON.stringify({ status: broken.statusCode, named: broken.body.includes("Unexpected token (3:1)") })
=> {"status":500,"named":true}
```

## Every exhibit carries its ask

An invalid manifest names the file and the Zod issues; a directory with content
but no manifest is not served as an anonymous page. Neither ever renders as a
bare listing.

```ts continue
const malformed = await app.inject({ method: "GET", url: "/demo-ws/malformed/", headers: authorized });
JSON.stringify({
  status: malformed.statusCode,
  file: malformed.body.includes("demo-ws/malformed/exhibit.json"),
  issue: malformed.body.includes("ask:"),
})
=> {"status":500,"file":true,"issue":true}

const unmanifested = await app.inject({ method: "GET", url: "/demo-ws/unmanifested/", headers: authorized });
JSON.stringify({
  status: unmanifested.statusCode,
  missing: unmanifested.body.includes("exhibit.json is missing"),
})
=> {"status":404,"missing":true}
```

## Containment

Traversal, symlink escape, and page source are all refused at the store
boundary. Source is a build input, not content — Vite already serves the
compiled form through `/@fs`.

```ts continue
const secret = path.join(store, "..", `exhibits-secret-${process.pid}.txt`);
await fs.writeFile(secret, "not yours");
await fs.symlink(secret, path.join(store, "demo-ws/plain/escape.txt"));

const traversal = await app.inject({
  method: "GET",
  url: "/demo-ws/plain/..%2f..%2f..%2fetc%2fpasswd",
  headers: authorized,
});
const escape = await app.inject({ method: "GET", url: "/demo-ws/plain/escape.txt", headers: authorized });
const source = await app.inject({ method: "GET", url: "/demo-ws/instrument/index.tsx", headers: authorized });
const dotfile = await app.inject({ method: "GET", url: `/demo-ws/plain/${encodeURIComponent(".env")}`, headers: authorized });
JSON.stringify({
  traversal: traversal.statusCode,
  escape: escape.statusCode,
  source: source.statusCode,
  sourceBody: source.body.includes("Page source is not served as content."),
  dotfile: dotfile.statusCode,
})
=> {"traversal":404,"escape":404,"source":404,"sourceBody":true,"dotfile":404}

await fs.rm(secret, { force: true });
```

A symlinked *entry* is refused the same way, and — this is the part a scan can
get wrong — it is refused consistently. Listings and the ask queue enumerate the
store and then read `exhibit.json` and `data/disposition.json` from the names
they find, so following a link there would read (and advertise) a directory
outside the store that the direct routes already 404. `lstat`, not `stat`.

```ts continue
const outside = path.join(store, "..", `exhibits-outside-${String(process.pid)}`);
await writeFile(path.join(outside, "exhibit.json"), manifest({ title: "Planted from outside the store" }));
await writeFile(path.join(outside, "data/disposition.json"), JSON.stringify({
  askType: "fyi",
  decidedAt: "2026-08-15T00:00:00Z",
}));
// An exhibit-shaped link inside a workstream, and a whole workstream-shaped one.
await fs.symlink(outside, path.join(store, "demo-ws/planted"));
await fs.symlink(outside, path.join(store, "planted-ws"));
// A link where the manifest itself is the symlink: the directory is real.
await fs.mkdir(path.join(store, "demo-ws/borrowed"));
await fs.symlink(path.join(outside, "exhibit.json"), path.join(store, "demo-ws/borrowed/exhibit.json"));

const { createExhibitsQueueService } = await import("../src/server/exhibits-queue-service.js");
const queue = await createExhibitsQueueService({
  storeRoot: store,
  appsRoot: path.join(store, "apps"),
  origin: `http://127.0.0.1:${String(EXHIBITS_PORT)}`,
}).askQueue();

const workstreams = await app.inject({ method: "GET", url: "/", headers: authorized });
const exhibits = await app.inject({ method: "GET", url: "/demo-ws/", headers: authorized });
const planted = await app.inject({ method: "GET", url: "/demo-ws/planted/", headers: authorized });
const borrowed = await app.inject({ method: "GET", url: "/demo-ws/borrowed/", headers: authorized });
JSON.stringify({
  workstreamListed: workstreams.body.includes("planted-ws"),
  exhibitListed: exhibits.body.includes("planted"),
  plantedRoute: planted.statusCode,
  borrowedRoute: borrowed.statusCode,
  borrowedRefusesTheLink: borrowed.body.includes("is a symlink"),
  outsideTitleAnywhere: [workstreams.body, exhibits.body, planted.body, borrowed.body, JSON.stringify(queue)]
    .some((body) => body.includes("Planted from outside the store")),
  queueSlugs: queue.entries.map((entry) => entry.slug),
})
=> {"workstreamListed":false,"exhibitListed":false,"plantedRoute":404,"borrowedRoute":500,"borrowedRefusesTheLink":true,"outsideTitleAnywhere":false,"queueSlugs":["borrowed","instrument","malformed","passive","plain","unmanifested"]}

await fs.rm(outside, { recursive: true, force: true });
```

```ts cleanup
await app.close();
await fs.rm(store, { recursive: true, force: true });
```

## An unmarked directory is not a store

The store root must carry the marker `bin/lib/exhibits-store.sh` writes. Without
it, the app refuses to serve rather than adopting whatever directory it was
pointed at — the same posture the mount takes.

```ts
const unmarked = await fs.mkdtemp(path.join(os.tmpdir(), "exhibits-unmarked-"));
await fs.mkdir(path.join(unmarked, "demo-ws"), { recursive: true });
const refusing = await makeApp(unmarked, fakeAssets());

const refused = await refusing.inject({ method: "GET", url: "/", headers: authorized });
JSON.stringify({
  status: refused.statusCode,
  marker: refused.body.includes(STORE_MARKER),
  root: refused.body.includes(unmarked),
})
=> {"status":503,"marker":true,"root":true}
```

Committed apps are the other root on the same contract, and the tier is
legible from the URL. `dev/apps/` need not exist yet.

```ts continue
const apps = await refusing.inject({ method: "GET", url: "/apps/", headers: authorized });
JSON.stringify({ status: apps.statusCode, empty: apps.body.includes("No exhibits here yet.") })
=> {"status":200,"empty":true}
```

```ts cleanup
await refusing.close();
await fs.rm(unmarked, { recursive: true, force: true });
```
