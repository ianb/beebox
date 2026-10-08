# Cache headers and precompressed brotli for hashed SPA assets

Vite content-hashes everything under `dist/assets/`, so those URLs can never
change bytes and are safe to cache for a year. `index.html`, `sw.js`, the
manifest, and `icons/` are NOT hashed — a long cache on `sw.js` in particular
would strand a browser on a dead service worker — so the policy is scoped to a
separate `/assets/` mount. Both the hub's fleet-wide root mount
(`src/hub/server/core.ts`) and the standalone box server (`src/webapp/server/app.ts`)
register that mount with `HASHED_ASSET_STATIC_OPTIONS`; this exercises the same
wiring on a bare Fastify instance over a fake `dist/` tree.

```ts setup
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { HASHED_ASSET_STATIC_OPTIONS } from "../../src/webapp/static-cache.js";

async function makeDist() {
  const dist = await mkdtemp(join(tmpdir(), "bbx-dist-"));
  await mkdir(join(dist, "assets"));
  await mkdir(join(dist, "icons"));
  await writeFile(join(dist, "assets/index-a1b2c3d4.js"), "console.log(1)");
  await writeFile(join(dist, "assets/index-a1b2c3d4.js.br"), brotliCompressSync("console.log(1)"));
  await writeFile(join(dist, "assets/index-a1b2c3d4.js.map"), "{}");
  await writeFile(join(dist, "index.html"), "<!doctype html><p>hi");
  await writeFile(join(dist, "sw.js"), "self.addEventListener('fetch', () => {})");
  await writeFile(join(dist, "icons/icon-192.png"), "not-really-a-png");
  return dist;
}

/**
 * The hub's registration shape: a decorator-only mount for `reply.sendFile`
 * FIRST (the decorator carries the first registration's cache options), then
 * the scoped immutable assets mount, then the un-hashed files.
 */
async function makeServer(dist) {
  const app = Fastify();
  await app.register(fastifyStatic, { root: dist, serve: false });
  await app.register(fastifyStatic, {
    root: join(dist, "assets"),
    prefix: "/assets/",
    decorateReply: false,
    ...HASHED_ASSET_STATIC_OPTIONS,
  });
  await app.register(fastifyStatic, { root: join(dist, "icons"), prefix: "/icons/", decorateReply: false });
  for (const file of ["index.html", "sw.js"]) {
    app.get(`/${file}`, (_request, reply) => reply.sendFile(file, dist));
  }
  return app;
}
```

## Hashed assets are immutable for a year

```ts
const dist = await makeDist();
const app = await makeServer(dist);
const asset = await app.inject({ method: "GET", url: "/assets/index-a1b2c3d4.js" });
asset.statusCode
=> 200

asset.headers["cache-control"]
=> public, max-age=31536000, immutable
```

## index.html, sw.js, and icons keep revalidating

A stale `sw.js` is the dangerous one — a year-long cache there would pin the
browser to a dead service worker with no way to ship a fix.

```ts continue
const sw = await app.inject({ method: "GET", url: "/sw.js" });
sw.headers["cache-control"]
=> public, max-age=0

const html = await app.inject({ method: "GET", url: "/index.html" });
html.headers["cache-control"]
=> public, max-age=0

const icon = await app.inject({ method: "GET", url: "/icons/icon-192.png" });
icon.headers["cache-control"]
=> public, max-age=0
```

## Brotli clients get the precompressed file

The build writes `<file>.br` beside each text asset. A client that accepts
brotli gets those bytes with `content-encoding: br`; every response says it
varies by `Accept-Encoding`, so a shared cache keeps the two apart.

```ts continue
const br = await app.inject({ method: "GET", url: "/assets/index-a1b2c3d4.js", headers: { "accept-encoding": "gzip, br" } });
({ encoding: br.headers["content-encoding"], type: br.headers["content-type"], vary: br.headers["vary"], cache: br.headers["cache-control"], body: brotliDecompressSync(br.rawPayload).toString() })
=> { encoding: "br", type: "application/javascript; charset=utf-8", vary: "Accept-Encoding", cache: "public, max-age=31536000, immutable", body: "console.log(1)" }
```

A client without brotli, and a file with no `.br` beside it, get the plain bytes:

```ts continue
const plain = await app.inject({ method: "GET", url: "/assets/index-a1b2c3d4.js", headers: { "accept-encoding": "gzip" } });
({ encoding: plain.headers["content-encoding"] ?? null, vary: plain.headers["vary"], body: plain.body })
=> { encoding: null, vary: "Accept-Encoding", body: "console.log(1)" }

const map = await app.inject({ method: "GET", url: "/assets/index-a1b2c3d4.js.map", headers: { "accept-encoding": "br" } });
({ status: map.statusCode, encoding: map.headers["content-encoding"] ?? null, body: map.body })
=> { status: 200, encoding: null, body: "{}" }
```
