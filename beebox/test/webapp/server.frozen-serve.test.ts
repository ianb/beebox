// Serving frozen page snapshots, checked as whole responses with
// TestServer.response, so the status and headers are checked with the body.

import { test } from "tap";
import { any, others, str } from "@ianbicking/tap-check/check";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "../helpers/test-route-server.js";

const FROZEN = "<html><head><title>X</title></head><body><img src=\"https://example.com/a.png\"></body></html>";

// A frozen page is untrusted HTML: it is served with a hash-pinned CSP that
// allows only the injected image-fallback script, and with nosniff.
void test("a frozen page's response, status and headers included", async (t) => {
  const server = await makeTestServer();
  t.teardown(() => server.cleanup());
  await mkdir(join(server.boxRoot, "_content"), { recursive: true });
  await writeFile(join(server.boxRoot, "_content/Page.frozen"), FROZEN);

  t.check(await server.response({ method: "GET", url: "/api/files/_content/Page.frozen" }), {
    status: 200,
    headers: {
      "content-type": any(String).startsWith("text/html"),
      "content-security-policy": str`sandbox allow-scripts; script-src '${any(String).startsWith("sha256-")}'`,
      "x-content-type-options": "nosniff",
      [others]: any(String),
    },
    // The fallback script is injected before `</body>`; the image URL is left intact.
    body: any(String).matches(/\/api\/proxy-image\?url=[\S\s]*<\/body>/).includes("bbxProxied").includes("https://example.com/a.png"),
  });
});
