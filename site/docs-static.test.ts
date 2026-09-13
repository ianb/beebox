import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHeadersFile, renderNotFoundPage, renderRobotsTxt } from "./docs-static.js";

test("renderHeadersFile: plain text for the docs markdown, every twin, and every entry's .md; HTML for every entry's .txt", () => {
  const out = renderHeadersFile({ base: "/", twinStems: ["index", "walkthrough"], entryStems: ["llms", "llms-dev"] });
  assert.equal(
    out,
    [
      "/docs/*.md\n  Content-Type: text/plain; charset=utf-8",
      "/index.md\n  Content-Type: text/plain; charset=utf-8",
      "/walkthrough.md\n  Content-Type: text/plain; charset=utf-8",
      "/llms.md\n  Content-Type: text/plain; charset=utf-8",
      "/llms-dev.md\n  Content-Type: text/plain; charset=utf-8",
      "/llms.txt\n  Content-Type: text/html; charset=utf-8",
      "/llms-dev.txt\n  Content-Type: text/html; charset=utf-8",
    ].join("\n\n") + "\n",
  );
});

test("renderHeadersFile: rules carry the base on a router build", () => {
  assert.ok(renderHeadersFile({ base: "/x/site/", twinStems: [], entryStems: [] }).startsWith("/x/site/docs/*.md\n"));
});

test("renderHeadersFile: no entry stems means no llms.txt/llms.md rules", () => {
  const out = renderHeadersFile({ base: "/", twinStems: [], entryStems: [] });
  assert.doesNotMatch(out, /llms/);
});

test("static pages: a 404 that points at the index, and a permissive robots.txt", () => {
  assert.match(renderNotFoundPage(), /<title>Not found/);
  assert.match(renderNotFoundPage(), /llms\.txt/);
  assert.equal(renderRobotsTxt(), "User-agent: *\nAllow: /\n");
});
