// # Exhibits surface and inventory
//
// The exhibits listener is a second Fastify instance on its own origin: it serves
// the persistent exhibit store (and the main checkout's committed apps) to the
// developer, and it is the only origin on which agent-written pages script. The
// compile half is injected, so these tests exercise routing, auth, containment,
// and manifest handling without starting a dev server.

import { test, type Test } from "tap";
import "agent-doctest/tap";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildExhibitsApp } from "../../../src/server/exhibits/app/handler.js";
import type { ExhibitsAssets } from "../../../src/server/exhibits/assets.js";
import { EXHIBITS_COOKIE } from "../../../src/server/exhibits/app/auth.js";
import { STORE_MARKER } from "../../../src/server/exhibits/store.js";

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
    created: "2026-08-17T00:00:00Z",
    prose: "The wide layout next to the narrow one.",
    figures: [{ label: "A1", file: "shot.png", caption: "Wide layout" }],
  }));
  await writeFile(path.join(ws, "passive/doc.md"), "# Notes\n\nA1 is the wide one.\n");
  await writeFile(path.join(ws, "passive/shot.png"), "not-really-a-png");

  await writeFile(path.join(ws, "instrument/exhibit.json"), manifest({ title: "Threshold tuner" }));
  await writeFile(path.join(ws, "instrument/index.tsx"), "export default function Page() { return null; }\n");

  await writeFile(path.join(ws, "plain/exhibit.json"), manifest({ title: "Vanilla page" }));
  await writeFile(path.join(ws, "plain/index.html"), "<!doctype html><p>plain</p>\n");
  await writeFile(path.join(ws, "plain/data.json"), '{"ok":true}\n');

  await writeFile(path.join(ws, "malformed/exhibit.json"), JSON.stringify({ title: "No created date" }));
  await writeFile(path.join(ws, "malformed/index.html"), "<p>content without a created date</p>\n");

  await writeFile(path.join(ws, "unmanifested/index.tsx"), "export default function Page() { return null; }\n");
  // CODING_FEEDBACK entries (bin/coding-feedback) share the workstream directory.
  await writeFile(path.join(ws, "coding-feedback/20261007T000000Z-landed.md"), "---\n---\n\nretro note\n");
  return root;
}

async function makeApp(storeRoot: string, assets: ExhibitsAssets) {
  return buildExhibitsApp({
    storeRoot,
    appsRoot: path.join(storeRoot, "apps"),
    token: TOKEN,
    port: EXHIBITS_PORT,
    runFocus: async () => {},
    comments: { add: async () => ({ id: "c-unused" }) },
    transcribe: { transcribe: async () => ({ text: "" }) },
    createAssets: async () => assets,
  });
}

const authorized = { cookie: `${EXHIBITS_COOKIE}=${TOKEN}` };

interface Ctx {
  store: string;
  app: Awaited<ReturnType<typeof makeApp>>;
  assets: FakeAssets;
}

// ## Token, then cookie
//
// Access follows Jupyter's handshake. A request with no credential is refused with
// a real page carrying the command that prints an authorized URL — never a silent
// empty page, and never a bare text/plain line, because this refusal is the first
// thing most developers see on this origin. `?token=` on a GET exchanges the
// machine-scoped token for an origin-scoped session cookie and redirects to the
// clean URL, so the capability leaves the address bar.
void test("Access follows Jupyter's handshake.", async (t) => {
  t.teardown(async () => {
    try {
      await app.close();
      await fs.rm(store, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L115
  const store = await makeStore();
  const assets = fakeAssets();
  const app = await makeApp(store, assets);

  const ctx: Ctx = { store, assets, app };
  await checkAnonymousAccess(t, ctx);
  await checkListings(t, ctx);
  await checkPageTiers(t, ctx);
  await checkManifests(t, ctx);
  await checkContainment(t, ctx);
});

async function checkAnonymousAccess(t: Test, ctx: Ctx): Promise<void> {
  const { app } = ctx;
  // doctest:L119
  const anonymous = await app.inject({ method: "GET", url: "/" });
  t.check(
    {
      status: anonymous.statusCode,
      type: anonymous.headers["content-type"],
      title: anonymous.body.includes("<title>Exhibits need a token</title>"),
      command: anonymous.body.includes("<code>bin/exhibits url &lt;workstream&gt;/&lt;exhibit&gt;</code>"),
    },
    {
    status: 401,
    type: "text/html; charset=utf-8",
    title: true,
    command: true,
  },
  );

  // doctest:L128
  const wrongToken = await app.inject({ method: "GET", url: "/?token=not-the-token" });
  const wrongCookie = await app.inject({ method: "GET", url: "/", headers: { cookie: `${EXHIBITS_COOKIE}=nope` } });
  t.check({ query: wrongToken.statusCode, cookie: wrongCookie.statusCode }, {
    query: 401,
    cookie: 401,
  });

  // doctest:L133
  const exchanged = await app.inject({ method: "GET", url: `/demo-ws/?token=${TOKEN}&keep=1` });
  t.check(
    {
      status: exchanged.statusCode,
      location: exchanged.headers.location,
      cookie: exchanged.headers["set-cookie"],
    },
    {
    status: 302,
    location: "/demo-ws/?keep=1",
    cookie: "bbx_exhibits_session=exhibits-test-token-0123456789; Path=/; HttpOnly; SameSite=Lax",
  },
  );
}

async function checkListings(t: Test, ctx: Ctx): Promise<void> {
  const { app } = ctx;
  // ## Listings
  //
  // The root lists workstreams; a workstream lists its exhibits and names the ones
  // whose manifest is unusable rather than hiding them.

  // doctest:L148
  const root = await app.inject({ method: "GET", url: "/", headers: authorized });
  t.check({ status: root.statusCode, hasWorkstream: root.body.includes('href="/demo-ws/"') }, {
    status: 200,
    hasWorkstream: true,
  });

  // doctest:L152
  const listing = await app.inject({ method: "GET", url: "/demo-ws/", headers: authorized });
  t.check(
    {
      status: listing.statusCode,
      title: listing.body.includes("Six screenshots"),
      malformed: listing.body.includes("created: Invalid input"),
      noAskState: !listing.body.includes("waiting") && !listing.body.includes("answered"),
    },
    {
    status: 200,
    title: true,
    malformed: true,
    noAskState: true,
  },
  );

  // The `coding-feedback/` directory beside the exhibits holds retrospective notes
  // that are not exhibits: it is neither listed nor served.

  // doctest:L166
  const feedbackPage = await app.inject({ method: "GET", url: "/demo-ws/coding-feedback/", headers: authorized });
  const feedbackFile = await app.inject({ method: "GET", url: "/demo-ws/coding-feedback/20261007T000000Z-landed.md", headers: authorized });
  t.check(
    {
      listed: listing.body.includes("coding-feedback"),
      page: feedbackPage.statusCode === 200 || feedbackPage.body.includes("retro note"),
      file: feedbackFile.statusCode === 200 || feedbackFile.body.includes("retro note"),
    },
    {
    listed: false,
    page: false,
    file: false,
  },
  );
}

async function checkPageTiers(t: Test, ctx: Ctx): Promise<void> {
  const { store, app, assets } = ctx;
  // ## Page tiers
  //
  // `index.tsx` gets the container shell booting the module through `/@fs`;
  // `index.html` is served as-is (this origin exists so agent pages can script);
  // neither gets the default renderer, with the manifest and `doc.md` handed to the
  // container in the boot payload. Serving a not-yet-seen exhibit invalidates the
  // Tailwind CSS module, because nothing in the store is in Vite's module graph
  // until it is imported.

  // doctest:L186
  const instrument = await app.inject({ method: "GET", url: "/demo-ws/instrument/", headers: authorized });
  t.check(
    {
      status: instrument.statusCode,
      module: instrument.body.includes(`"module":"/@fs${path.join(store, "demo-ws/instrument/index.tsx")}"`),
      transformed: instrument.body.includes('data-vite="1"'),
      noticed: assets.noticed.length,
    },
    {
    status: 200,
    module: true,
    transformed: true,
    noticed: 1,
  },
  );

  // doctest:L195
  const passive = await app.inject({ method: "GET", url: "/demo-ws/passive/", headers: authorized });
  t.check(
    {
      status: passive.statusCode,
      module: passive.body.includes('"module":null'),
      doc: passive.body.includes("A1 is the wide one."),
      scope: passive.body.includes('"scope":"demo-ws/passive"'),
    },
    {
    status: 200,
    module: true,
    doc: true,
    scope: true,
  },
  );

  // doctest:L204
  const plain = await app.inject({ method: "GET", url: "/demo-ws/plain/", headers: authorized });
  t.check({ status: plain.statusCode, body: plain.body.trim(), type: plain.headers["content-type"] }, {
    status: 200,
    body: "<!doctype html><p>plain</p>",
    type: "text/html; charset=utf-8",
  });

  // doctest:L208
  const sibling = await app.inject({ method: "GET", url: "/demo-ws/plain/data.json", headers: authorized });
  t.check({ status: sibling.statusCode, type: sibling.headers["content-type"], body: sibling.body.trim() }, {
    status: 200,
    type: "application/json; charset=utf-8",
    body: "{\"ok\":true}",
  });

  // A page that fails to compile becomes a real error page. In middleware mode Vite
  // logs transform errors and calls `next()` without them, so the shell route
  // preflights the module to get the error at all.

  // doctest:L218
  assets.compileError = "Unexpected token (3:1)";
  const broken = await app.inject({ method: "GET", url: "/demo-ws/instrument/", headers: authorized });
  assets.compileError = null;
  t.check({ status: broken.statusCode, named: broken.body.includes("Unexpected token (3:1)") }, {
    status: 500,
    named: true,
  });
}

async function checkManifests(t: Test, ctx: Ctx): Promise<void> {
  const { app } = ctx;
  // ## Every exhibit carries a manifest
  //
  // An invalid manifest names the file and the Zod issues; a directory with content
  // but no manifest is not served as an anonymous page. Neither ever renders as a
  // bare listing.

  // doctest:L232
  const malformed = await app.inject({ method: "GET", url: "/demo-ws/malformed/", headers: authorized });
  t.check(
    {
      status: malformed.statusCode,
      file: malformed.body.includes("demo-ws/malformed/exhibit.json"),
      issue: malformed.body.includes("created:"),
      shape: malformed.body.includes("&quot;prose&quot;?") || malformed.body.includes('"prose"?'),
    },
    {
    status: 500,
    file: true,
    issue: true,
    shape: true,
  },
  );

  // doctest:L241
  const unmanifested = await app.inject({ method: "GET", url: "/demo-ws/unmanifested/", headers: authorized });
  t.check(
    {
      status: unmanifested.statusCode,
      missing: unmanifested.body.includes("exhibit.json is missing"),
    },
    {
    status: 404,
    missing: true,
  },
  );
}

async function checkContainment(t: Test, ctx: Ctx): Promise<void> {
  const { store, app } = ctx;
  // ## Containment
  //
  // Traversal, symlink escape, and page source are all refused at the store
  // boundary. Source is a build input, not content — Vite already serves the
  // compiled form through `/@fs`.

  // doctest:L256
  const secret = path.join(store, "..", `exhibits-secret-${process.pid}.txt`);
  await fs.writeFile(secret, "not yours");
  await fs.symlink(secret, path.join(store, "demo-ws/plain/escape.txt"));

  // doctest:L260
  const traversal = await app.inject({
    method: "GET",
    url: "/demo-ws/plain/..%2f..%2f..%2fetc%2fpasswd",
    headers: authorized,
  });
  const escape = await app.inject({ method: "GET", url: "/demo-ws/plain/escape.txt", headers: authorized });
  const source = await app.inject({ method: "GET", url: "/demo-ws/instrument/index.tsx", headers: authorized });
  const dotfile = await app.inject({ method: "GET", url: `/demo-ws/plain/${encodeURIComponent(".env")}`, headers: authorized });
  t.check(
    {
      traversal: traversal.statusCode,
      escape: escape.statusCode,
      source: source.statusCode,
      sourceBody: source.body.includes("Page source is not served as content."),
      dotfile: dotfile.statusCode,
    },
    {
    traversal: 404,
    escape: 404,
    source: 404,
    sourceBody: true,
    dotfile: 404,
  },
  );

  // doctest:L277
  await fs.rm(secret, { force: true });

  // A symlinked *entry* is refused the same way, and — this is the part a scan can
  // get wrong — it is refused consistently. Listings and the inventory enumerate the
  // store and then read `exhibit.json` from the names they find, so following a link there would read (and advertise) a directory
  // outside the store that the direct routes already 404. `lstat`, not `stat`.

  // doctest:L286
  const outside = path.join(store, "..", `exhibits-outside-${String(process.pid)}`);
  await writeFile(path.join(outside, "exhibit.json"), manifest({ title: "Planted from outside the store" }));
  // An exhibit-shaped link inside a workstream, and a whole workstream-shaped one.
  await fs.symlink(outside, path.join(store, "demo-ws/planted"));
  await fs.symlink(outside, path.join(store, "planted-ws"));
  // A link where the manifest itself is the symlink: the directory is real.
  await fs.mkdir(path.join(store, "demo-ws/borrowed"));
  await fs.symlink(path.join(outside, "exhibit.json"), path.join(store, "demo-ws/borrowed/exhibit.json"));

  // doctest:L295
  const { createExhibitsInventoryService } = await import("../../../src/server/main/exhibits-inventory-service.js");
  const queue = await createExhibitsInventoryService({
    storeRoot: store,
    origin: `http://127.0.0.1:${String(EXHIBITS_PORT)}`,
  }).inventory();

  // doctest:L301
  const workstreams = await app.inject({ method: "GET", url: "/", headers: authorized });
  const exhibits = await app.inject({ method: "GET", url: "/demo-ws/", headers: authorized });
  const planted = await app.inject({ method: "GET", url: "/demo-ws/planted/", headers: authorized });
  const borrowed = await app.inject({ method: "GET", url: "/demo-ws/borrowed/", headers: authorized });
  t.check(
    {
      workstreamListed: workstreams.body.includes("planted-ws"),
      exhibitListed: exhibits.body.includes("planted"),
      plantedRoute: planted.statusCode,
      borrowedRoute: borrowed.statusCode,
      borrowedRefusesTheLink: borrowed.body.includes("is a symlink"),
      outsideTitleAnywhere: [workstreams.body, exhibits.body, planted.body, borrowed.body, JSON.stringify(queue)]
        .some((body) => body.includes("Planted from outside the store")),
      inventorySlugs: queue.entries.map((entry) => entry.slug),
    },
    {
    workstreamListed: false,
    exhibitListed: false,
    plantedRoute: 404,
    borrowedRoute: 500,
    borrowedRefusesTheLink: true,
    outsideTitleAnywhere: false,
    inventorySlugs: [
      "borrowed",
      "instrument",
      "malformed",
      "passive",
      "plain",
      "unmanifested",
    ],
  },
  );

  // doctest:L317
  await fs.rm(outside, { recursive: true, force: true });
}


// ## The inventory
//
// The dashboard's per-workstream exhibit list is a plain scan: each store exhibit
// becomes `{ workstream, slug, path, title, created, problem }`. A manifest that
// does not parse keeps its row with a null title and date plus the problem, so an
// incomplete inventory is never mistaken for a complete one. Committed apps belong
// to no workstream and are not listed.
void test("The dashboard's per-workstream exhibit list is a plain scan:", async (t) => {
  // doctest:L334
  const { createExhibitsInventoryService } = await import("../../../src/server/main/exhibits-inventory-service.js");
  const invStore = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "exhibits-inventory-")));
  await writeFile(path.join(invStore, STORE_MARKER), "");
  await writeFile(path.join(invStore, "ws-a/good/exhibit.json"), JSON.stringify({ title: "Good one", created: "2026-08-17T00:00:00Z" }));
  await writeFile(path.join(invStore, "ws-a/broken/exhibit.json"), '{"title":"No date"}');
  await writeFile(path.join(invStore, "ws-a/bare/index.html"), "<p>no manifest</p>");
  await writeFile(path.join(invStore, "apps/an-app/exhibit.json"), JSON.stringify({ title: "An app", created: "2026-01-01T00:00:00Z" }));

  // doctest:L342
  const inv = await createExhibitsInventoryService({ storeRoot: invStore, origin: "http://127.0.0.1:3230" }).inventory();
  t.check(
    {
      origin: inv.origin,
      storeProblem: inv.storeProblem,
      entries: inv.entries.map((entry) => [entry.workstream, entry.slug, entry.path, entry.title, entry.created, entry.problem]),
    },
    {
    origin: "http://127.0.0.1:3230",
    storeProblem: null,
    entries: [
      [
        "ws-a",
        "bare",
        "/ws-a/bare/",
        null,
        null,
        "broken manifest: exhibit.json is missing",
      ],
      [
        "ws-a",
        "broken",
        "/ws-a/broken/",
        null,
        null,
        "broken manifest: created: Invalid input: expected string, received undefined",
      ],
      [
        "ws-a",
        "good",
        "/ws-a/good/",
        "Good one",
        "2026-08-17T00:00:00Z",
        null,
      ],
    ],
  },
  );

  // A store root with no marker is reported as a `storeProblem`, not as an empty
  // inventory.

  // doctest:L355
  const missing = await createExhibitsInventoryService({
    storeRoot: path.join(invStore, "nowhere"),
    origin: "http://127.0.0.1:3230",
  }).inventory();
  t.check({ entries: missing.entries.length, problem: missing.storeProblem?.startsWith("No exhibit store yet:") }, {
    entries: 0,
    problem: true,
  });

  // doctest:L362
  await fs.rm(invStore, { recursive: true, force: true });
});

// ## Manifests written before the ask was removed
//
// Old manifests carry `ask: { type, prose, options? }`. The read side lifts
// `ask.prose` into a missing top-level `prose` and drops `ask` without ever
// validating its contents; nothing writes `ask` any more.
void test("Old manifests carry ask:", async (t) => {
  // doctest:L372
  const { liftLegacyManifest, readManifest } = await import("../../../src/server/exhibits/store.js");
  const base = { title: "Old", created: "2026-08-01T00:00:00Z" };
  t.check(
    [
      liftLegacyManifest({ ...base, ask: { type: "decide", prose: "Which layout?", options: ["A", "B"] } }),
      liftLegacyManifest({ ...base, prose: "Kept", ask: { type: "fyi", prose: "Dropped" } }),
      liftLegacyManifest({ ...base, ask: "garbage" }),
      liftLegacyManifest({ ...base, ask: { type: "nonsense", prose: 4 } }),
      liftLegacyManifest({ ...base, prose: "", ask: { type: "fyi", prose: "Lifted over empty" } }),
    ],
    [
    {
      title: "Old",
      created: "2026-08-01T00:00:00Z",
      prose: "Which layout?",
    },
    {
      title: "Old",
      created: "2026-08-01T00:00:00Z",
      prose: "Kept",
    },
    {
      title: "Old",
      created: "2026-08-01T00:00:00Z",
    },
    {
      title: "Old",
      created: "2026-08-01T00:00:00Z",
    },
    {
      title: "Old",
      created: "2026-08-01T00:00:00Z",
      prose: "Lifted over empty",
    },
  ],
  );

  // Through `readManifest`, a legacy file reads as the new shape, and a legacy
  // `ask: "garbage"` is stripped without an error.

  // doctest:L388
  const legacyDir = await fs.mkdtemp(path.join(os.tmpdir(), "exhibits-legacy-"));
  await writeFile(path.join(legacyDir, "exhibit.json"), JSON.stringify({ ...base, ask: { type: "decide", prose: "Which layout?", options: ["A", "B"] } }));
  const lifted = await readManifest(legacyDir);
  await writeFile(path.join(legacyDir, "exhibit.json"), JSON.stringify({ ...base, ask: "garbage" }));
  const garbage = await readManifest(legacyDir);
  await fs.rm(legacyDir, { recursive: true, force: true });
  t.check([lifted, garbage], [
    {
      ok: true,
      manifest: {
        title: "Old",
        created: "2026-08-01T00:00:00Z",
        prose: "Which layout?",
      },
    },
    {
      ok: true,
      manifest: {
        title: "Old",
        created: "2026-08-01T00:00:00Z",
      },
    },
  ]);
});

// ## An unmarked directory is not a store
//
// The store root must carry the marker `bin/lib/exhibits-store.sh` writes. Without
// it, the app refuses to serve rather than adopting whatever directory it was
// pointed at — the same posture the mount takes.
void test("The store root must carry the marker bin/lib/exhibits-store.sh writes.", async (t) => {
  t.teardown(async () => {
    try {
      await refusing.close();
      await fs.rm(unmarked, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L405
  const unmarked = await fs.mkdtemp(path.join(os.tmpdir(), "exhibits-unmarked-"));
  await fs.mkdir(path.join(unmarked, "demo-ws"), { recursive: true });
  const refusing = await makeApp(unmarked, fakeAssets());

  // doctest:L409
  const refused = await refusing.inject({ method: "GET", url: "/", headers: authorized });
  t.check(
    {
      status: refused.statusCode,
      marker: refused.body.includes(STORE_MARKER),
      root: refused.body.includes(unmarked),
    },
    {
    status: 503,
    marker: true,
    root: true,
  },
  );

  // Committed apps are the other root on the same contract, and the tier is
  // legible from the URL. `dev/apps/` need not exist yet.

  // doctest:L422
  const apps = await refusing.inject({ method: "GET", url: "/apps/", headers: authorized });
  t.check({ status: apps.statusCode, empty: apps.body.includes("No exhibits here yet.") }, {
    status: 200,
    empty: true,
  });
});

// ## The dev server's two invisible settings
//
// Both Vite servers in this package would otherwise share
// `node_modules/.vite/deps` with different configs, and each start invalidates the
// other's optimized deps — which hands a page a second copy of React and kills it
// with "Invalid hook call" until a cache happens to be warm. And `doc.md` renders
// with `prose` classes that generate nothing unless the typography plugin is in
// the inline Tailwind config. Neither is visible at runtime until a page breaks,
// so both are asserted here.
void test("Both Vite servers in this package would otherwise share nodemodules/.vite/dep...", async (t) => {
  // doctest:L443
  const http = await import("node:http");
  const typography = (await import("@tailwindcss/typography")).default;
  const { exhibitsTailwindConfig, exhibitsViteConfig } = await import("../../../src/server/exhibits/vite-assets.js");

  // doctest:L447
  const assetOptions = {
    server: http.createServer(),
    frontendRoot: "/pkg/src/frontend/exhibits",
    packageRoot: "/pkg",
    repoRoot: "/repo",
    contentRoots: ["/store", "/repo/dev/apps"],
  };
  const viteConfig = exhibitsViteConfig(assetOptions);
  t.check(
    {
      cacheDir: viteConfig.cacheDir,
      sharedWithTheOtherServer: viteConfig.cacheDir === undefined || viteConfig.cacheDir.endsWith("node_modules/.vite"),
      dedupe: viteConfig.resolve?.dedupe,
      typography: exhibitsTailwindConfig(assetOptions).plugins?.includes(typography),
    },
    {
    cacheDir: "/pkg/node_modules/.vite-exhibits",
    sharedWithTheOtherServer: false,
    dedupe: [
      "react",
      "react-dom",
    ],
    typography: true,
  },
  );
});
