import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHeadersFile, renderNotFoundPage, renderRobotsTxt } from "./docs-static.js";

test("renderHeadersFile: plain text for the docs tree, both entry files, and every twin", () => {
  const out = renderHeadersFile({ base: "/", twinStems: ["index", "walkthrough"] });
  assert.equal(
    out,
    [
      "/docs/*\n  Content-Type: text/plain; charset=utf-8",
      "/llms.txt\n  Content-Type: text/plain; charset=utf-8",
      "/llms-dev.txt\n  Content-Type: text/plain; charset=utf-8",
      "/index.md\n  Content-Type: text/plain; charset=utf-8",
      "/walkthrough.md\n  Content-Type: text/plain; charset=utf-8",
    ].join("\n\n") + "\n",
  );
});

test("renderHeadersFile: rules carry the base on a router build", () => {
  assert.ok(renderHeadersFile({ base: "/x/site/", twinStems: [] }).startsWith("/x/site/docs/*\n"));
});

test("static pages: a 404 that points at the index, and a permissive robots.txt", () => {
  assert.match(renderNotFoundPage(), /<title>Not found/);
  assert.match(renderNotFoundPage(), /llms\.txt/);
  assert.equal(renderRobotsTxt(), "User-agent: *\nAllow: /\n");
});
