// # `GET /api/external` — dev-only live wrapper
//
// Serves an allowlisted file from **outside** the box root as a JSON envelope
// (base64 bytes + content type + version markers), for the commentary surface's
// live wrapper. Mounted only with the explicit development-surface opt-in.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { makeTestServer } from "../../../../helpers/test-route-server.js";
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

function extUrl(href: string): string {
  return `/api/external?href=${encodeURIComponent(href)}`;
}

// The route reads its allowlist from the requesting box's _config/box.json
// (`externalRoots`), per request. Seed it into the test box.
async function allowRoot(ctx: { seed(p: string, c: string): Promise<void> }): Promise<void> {
  await ctx.seed("_config/box.json", JSON.stringify({ externalRoots: [root] }));
}

function makeExternalServer() {
  return makeTestServer({ devSurfaces: true });
}

// ## An allowed file returns a JSON envelope
void test("An allowed file returns a JSON envelope", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeExternalServer();
  await allowRoot(ctx);
  const res = await ctx.request({ method: "GET", url: extUrl(`file:${file}`) });
  t.check(res, {
    statusCode: 200,
    body: { contentBase64: "aGVsbG8K", contentType: "text/markdown", markers: str`sha256:5891b5b522d5 git:${any(String)}` },
  });
});

// ## The box's own root is always allowed (no config needed)
void test("The box's own root is always allowed (no config needed)", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeExternalServer();
  await ctx.seed("notes/inside.md", "in-box\n");
  const url = extUrl(`file:${path.join(ctx.boxRoot, "notes", "inside.md")}`);
  t.check(await ctx.request({ method: "GET", url }), {
    statusCode: 200,
    body: { contentBase64: "aW4tYm94Cg==", contentType: "text/markdown", markers: "sha256:cd3de7b5c6e7" },
  });
});

// ## A path outside the allowed roots is 404
void test("A path outside the allowed roots is 404", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeExternalServer();
  await allowRoot(ctx);
  t.check(await ctx.request({ method: "GET", url: extUrl(`file:${outside}`) }), {
    statusCode: 404,
    body: { error: "Path is not under an allowed root" },
  });
});

// ## A non-`file:` URL is 400
void test("A non-`file:` URL is 400", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeExternalServer();
  t.check(await ctx.request({ method: "GET", url: extUrl("https://example.com/x") }), {
    statusCode: 400,
    body: { error: "Not a file: URL" },
  });
});

// ## A missing href is 400
void test("A missing href is 400", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeExternalServer();
  t.check(await ctx.request({ method: "GET", url: "/api/external" }), {
    statusCode: 400,
    body: { error: "missing href query parameter" },
  });
});

// ## Omission fails closed (404), regardless of `NODE_ENV`
void test("Omission fails closed (404), regardless of `NODE_ENV`", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const ctx = await makeTestServer();
  const omitted = await ctx.request({ method: "GET", url: extUrl(`file:${file}`) });
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  t.check(omitted, { statusCode: 404, body: { error: "Not found" } });
});
