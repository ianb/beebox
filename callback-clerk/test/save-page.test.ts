import { test } from "tap";
import {
  buildLinkSavePayload,
  buildSavePagePayload,
  type PageExtract,
} from "../src/domain/save-page.js";

const fullExtract: PageExtract = {
  title: "An Article",
  siteName: "Example Site",
  byline: "A. Author",
  excerpt: "Summary.",
  markdown: "# An Article\n\nBody.",
  selectedText: "Body.",
  url: "https://example.com/article",
};

test("buildSavePagePayload passes a full extraction through", async (t) => {
  const payload = buildSavePagePayload({
    intent: "save",
    extract: fullExtract,
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.same(payload, {
    intent: "save",
    url: "https://example.com/article",
    title: "An Article",
    siteName: "Example Site",
    byline: "A. Author",
    excerpt: "Summary.",
    markdown: "# An Article\n\nBody.",
    selectedText: "Body.",
    timestamp: "2026-06-11T00:00:00Z",
  });
});

test("buildSavePagePayload omits null/empty optional fields", async (t) => {
  const payload = buildSavePagePayload({
    intent: "do",
    extract: { ...fullExtract, siteName: null, byline: "", excerpt: null, selectedText: null },
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.notOk("siteName" in payload);
  t.notOk("byline" in payload);
  t.notOk("excerpt" in payload);
  t.notOk("selectedText" in payload);
});

test("buildSavePagePayload never sends empty markdown (server requires min 1)", async (t) => {
  const payload = buildSavePagePayload({
    intent: "save",
    extract: { ...fullExtract, markdown: "" },
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.equal(payload.markdown, "[An Article](https://example.com/article)");
});

test("buildSavePagePayload falls back to the URL for an empty title", async (t) => {
  const payload = buildSavePagePayload({
    intent: "save",
    extract: { ...fullExtract, title: "" },
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.equal(payload.title, "https://example.com/article");
});

test("buildLinkSavePayload produces a markdown-link save", async (t) => {
  const payload = buildLinkSavePayload({
    intent: "save",
    url: "https://example.com/x",
    title: "A Link",
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.same(payload, {
    intent: "save",
    url: "https://example.com/x",
    title: "A Link",
    markdown: "[A Link](https://example.com/x)",
    timestamp: "2026-06-11T00:00:00Z",
  });
});

test("buildLinkSavePayload falls back to the URL for an empty title", async (t) => {
  const payload = buildLinkSavePayload({
    intent: "do",
    url: "https://example.com/x",
    title: "",
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.equal(payload.title, "https://example.com/x");
  t.equal(payload.markdown, "[https://example.com/x](https://example.com/x)");
});
