# `GET /api/external` — dev-only live wrapper

Serves an allowlisted file from **outside** the box root as a JSON envelope
(base64 bytes + content type + version markers), for the commentary surface's
live wrapper. Mounted only when `NODE_ENV !== "production"`.

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

// A committed file under a tmp root, and a sibling outside it.
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ext-route-")));
const file = path.join(root, "doc.md");
writeFileSync(file, "hello\n");
function git(...args: string[]): void {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
git("add", "doc.md");
git("commit", "-q", "-m", "add");
const outside = path.join(os.tmpdir(), `ext-route-outside-${process.pid}.md`);
writeFileSync(outside, "x\n");

// The route reads its allowlist from this env at registration time.
process.env["CALLBACK_EXTERNAL_ROOTS"] = root;

function extUrl(href: string): string {
  return `/api/external?href=${encodeURIComponent(href)}`;
}
```

## An allowed file returns a JSON envelope

```
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: extUrl(`file:${file}`) });
res.statusCode
=> 200
```

``` continue
Buffer.from(res.body.contentBase64, "base64").toString() === "hello\n"
=> true

res.body.contentType
=> text/markdown

res.body.markers.startsWith("sha256:")
=> true
```

``` cleanup
await ctx.cleanup();
```

## A path outside the allowed roots is 404

```
const ctx = await makeTestServer();
(await ctx.request({ method: "GET", url: extUrl(`file:${outside}`) })).statusCode
=> 404
```

``` cleanup
await ctx.cleanup();
```

## A non-`file:` URL is 400

```
const ctx = await makeTestServer();
(await ctx.request({ method: "GET", url: extUrl("https://example.com/x") })).statusCode
=> 400
```

``` cleanup
await ctx.cleanup();
```

## A missing href is 400

```
const ctx = await makeTestServer();
(await ctx.request({ method: "GET", url: "/api/external" })).statusCode
=> 400
```

``` cleanup
await ctx.cleanup();
```

## Not mounted in production (404)

```
process.env.NODE_ENV = "production";
const ctx = await makeTestServer();
const code = (await ctx.request({ method: "GET", url: extUrl(`file:${file}`) })).statusCode;
delete process.env.NODE_ENV;
code
=> 404
```

``` cleanup
await ctx.cleanup();
```
