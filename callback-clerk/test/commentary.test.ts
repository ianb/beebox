import { test } from "tap";
import {
  buildCommentaryPayload,
  commentaryOpenUrl,
  type ReadablePage,
} from "../src/domain/commentary.js";

const fullPage: ReadablePage = {
  title: "An Article",
  siteName: "Example Site",
  byline: "A. Author",
  excerpt: "Summary.",
  markdown: "# An Article\n\nBody.",
  url: "https://example.com/article",
};

test("buildCommentaryPayload passes a full page through", async (t) => {
  const payload = buildCommentaryPayload({
    page: fullPage,
    frozenHtml: "<html>frozen</html>",
    destinationDir: "store/reading",
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.same(payload, {
    url: "https://example.com/article",
    title: "An Article",
    siteName: "Example Site",
    byline: "A. Author",
    excerpt: "Summary.",
    readableMarkdown: "# An Article\n\nBody.",
    frozenHtml: "<html>frozen</html>",
    destinationDir: "store/reading",
    timestamp: "2026-06-11T00:00:00Z",
  });
});

test("buildCommentaryPayload omits null/empty optionals", async (t) => {
  const payload = buildCommentaryPayload({
    page: { ...fullPage, siteName: null, byline: "", excerpt: null },
    frozenHtml: null,
    destinationDir: null,
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.same(payload, {
    url: "https://example.com/article",
    title: "An Article",
    readableMarkdown: "# An Article\n\nBody.",
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.notOk("frozenHtml" in payload);
  t.notOk("destinationDir" in payload);
});

test("buildCommentaryPayload falls back to a link when no readable markdown", async (t) => {
  const payload = buildCommentaryPayload({
    page: { ...fullPage, markdown: "" },
    frozenHtml: null,
    destinationDir: null,
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.equal(payload.readableMarkdown, "[An Article](https://example.com/article)");
});

test("buildCommentaryPayload falls back to url for an empty title", async (t) => {
  const payload = buildCommentaryPayload({
    page: { ...fullPage, title: "", markdown: "" },
    frozenHtml: null,
    destinationDir: null,
    timestamp: "2026-06-11T00:00:00Z",
  });
  t.equal(payload.title, "https://example.com/article");
  t.equal(
    payload.readableMarkdown,
    "[https://example.com/article](https://example.com/article)",
  );
});

test("commentaryOpenUrl joins box URL and relative open path", async (t) => {
  t.equal(
    commentaryOpenUrl("http://localhost:3210/main/test1", "chat?session=new&companion=view%3Ax"),
    "http://localhost:3210/main/test1/chat?session=new&companion=view%3Ax",
  );
});

test("commentaryOpenUrl tolerates trailing/leading slashes", async (t) => {
  t.equal(
    commentaryOpenUrl("https://cb.example.org/test1/", "/chat?session=new"),
    "https://cb.example.org/test1/chat?session=new",
  );
});
