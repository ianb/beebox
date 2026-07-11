import { test } from "tap";
import {
  boxUrlToMatchPatterns,
  captureErrorReason,
  isUrlUnderBoxUrl,
} from "../src/domain/relay-auth.js";

test("boxUrlToMatchPatterns: dev-router path-scoped box drops the port", async (t) => {
  t.same(boxUrlToMatchPatterns("http://localhost:3210/main/test1"), [
    "http://localhost/main/test1",
    "http://localhost/main/test1/*",
  ]);
});

test("boxUrlToMatchPatterns: deployed path-scoped box", async (t) => {
  t.same(boxUrlToMatchPatterns("https://cb.example.com/main"), [
    "https://cb.example.com/main",
    "https://cb.example.com/main/*",
  ]);
});

test("boxUrlToMatchPatterns: origin-root box owns the whole host", async (t) => {
  t.same(boxUrlToMatchPatterns("https://box.example.com"), ["https://box.example.com/*"]);
  t.same(boxUrlToMatchPatterns("https://box.example.com/"), ["https://box.example.com/*"]);
});

test("boxUrlToMatchPatterns: rejects unparseable / non-http boxUrl", async (t) => {
  t.same(boxUrlToMatchPatterns("not a url"), []);
  t.same(boxUrlToMatchPatterns("file:///etc/passwd"), []);
});

test("isUrlUnderBoxUrl: matches the root and descendants, full origin incl. port", async (t) => {
  const box = "http://localhost:3210/main/test1";
  t.equal(isUrlUnderBoxUrl("http://localhost:3210/main/test1", box), true);
  t.equal(isUrlUnderBoxUrl("http://localhost:3210/main/test1/", box), true);
  t.equal(isUrlUnderBoxUrl("http://localhost:3210/main/test1/browse/inbox", box), true);
  t.equal(isUrlUnderBoxUrl("http://localhost:3210/main/test1/browse?view=grid#x", box), true);
});

test("isUrlUnderBoxUrl: rejects sibling boxes on the same host", async (t) => {
  const box = "http://localhost:3210/main/test1";
  // A prefix that is not a path segment boundary must not match.
  t.equal(isUrlUnderBoxUrl("http://localhost:3210/main/test1-other", box), false);
  t.equal(isUrlUnderBoxUrl("http://localhost:3210/main/test2", box), false);
});

test("isUrlUnderBoxUrl: rejects a different port (real gate, unlike match patterns)", async (t) => {
  t.equal(isUrlUnderBoxUrl("http://localhost:9999/main/test1", "http://localhost:3210/main/test1"), false);
});

test("isUrlUnderBoxUrl: rejects a different origin", async (t) => {
  t.equal(
    isUrlUnderBoxUrl("https://attacker.example.com/main/test1", "https://cb.example.com/main/test1"),
    false,
  );
});

test("isUrlUnderBoxUrl: origin-root box matches any path on its origin", async (t) => {
  t.equal(isUrlUnderBoxUrl("https://box.example.com/anything/here", "https://box.example.com"), true);
});

test("isUrlUnderBoxUrl: unparseable url is not under any box", async (t) => {
  t.equal(isUrlUnderBoxUrl("not a url", "http://localhost:3210/main/test1"), false);
});

test("captureErrorReason: quota error maps to busy", async (t) => {
  t.equal(
    captureErrorReason(
      "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded while calling captureVisibleTab.",
    ),
    "busy",
  );
  t.equal(captureErrorReason("Exceeded quota"), "busy");
});

test("captureErrorReason: anything else is an honest error", async (t) => {
  t.equal(captureErrorReason("No window with id 42."), "error");
  t.equal(captureErrorReason("The tab was closed."), "error");
});
