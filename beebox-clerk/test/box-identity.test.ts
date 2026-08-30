import { test } from "tap";
import { parseBoxIdentity } from "../src/domain/box-identity.js";

const tabUrl = "https://beebox.example.com/main/dashboard";

function identity(overrides: Record<string, unknown>) {
  return JSON.stringify({
    slug: "main",
    title: "Main",
    boxUrl: "https://beebox.example.com/main",
    ...overrides,
  });
}

test("accepts a well-formed same-origin identity", async (t) => {
  const box = parseBoxIdentity({ metaContent: identity({}), tabUrl });
  t.same(box, { boxUrl: "https://beebox.example.com/main", slug: "main", title: "Main" });
});

test("normalizes a trailing slash on boxUrl", async (t) => {
  const box = parseBoxIdentity({
    metaContent: identity({ boxUrl: "https://beebox.example.com/main/" }),
    tabUrl,
  });
  t.equal(box?.boxUrl, "https://beebox.example.com/main");
});

test("accepts dev-router style nested paths and ports", async (t) => {
  const box = parseBoxIdentity({
    metaContent: identity({ boxUrl: "http://localhost:3210/wt/test1", slug: "test1" }),
    tabUrl: "http://localhost:3210/wt/test1/browse/inbox",
  });
  t.equal(box?.boxUrl, "http://localhost:3210/wt/test1");
});

test("rejects a boxUrl on a different origin (spoof guard)", async (t) => {
  const box = parseBoxIdentity({
    metaContent: identity({ boxUrl: "https://attacker.example.com/main" }),
    tabUrl,
  });
  t.equal(box, null);
});

test("rejects a different port as a different origin", async (t) => {
  const box = parseBoxIdentity({
    metaContent: identity({ boxUrl: "http://localhost:9999/wt/test1" }),
    tabUrl: "http://localhost:3210/wt/test1",
  });
  t.equal(box, null);
});

test("rejects non-http(s) boxUrl schemes", async (t) => {
  const box = parseBoxIdentity({
    metaContent: identity({ boxUrl: "file:///etc/passwd" }),
    tabUrl: "file:///etc/passwd",
  });
  t.equal(box, null);
});

test("rejects malformed JSON", async (t) => {
  t.equal(parseBoxIdentity({ metaContent: "{not json", tabUrl }), null);
});

test("rejects non-object payloads", async (t) => {
  t.equal(parseBoxIdentity({ metaContent: '"a string"', tabUrl }), null);
  t.equal(parseBoxIdentity({ metaContent: "null", tabUrl }), null);
});

test("rejects missing or empty fields", async (t) => {
  t.equal(parseBoxIdentity({ metaContent: identity({ slug: "" }), tabUrl }), null);
  t.equal(parseBoxIdentity({ metaContent: identity({ title: "" }), tabUrl }), null);
  t.equal(parseBoxIdentity({ metaContent: identity({ boxUrl: undefined }), tabUrl }), null);
  t.equal(parseBoxIdentity({ metaContent: identity({ boxUrl: "not a url" }), tabUrl }), null);
});
