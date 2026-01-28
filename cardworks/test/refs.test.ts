import { test } from "tap";
import { parseRef } from "../src/refs/parse-ref.js";
import { resolveRef, type RefResolver } from "../src/refs/resolve.js";
import { MemoryFileSystem } from "../src/fs/memory-fs.js";

// Tests for parseRef

test("parseRef: simple path", (t) => {
  const ref = parseRef("./Other.card");

  t.equal(ref.path, "./Other.card");
  t.equal(ref.version, undefined);
  t.equal(ref.fragment, undefined);

  t.end();
});

test("parseRef: path with version", (t) => {
  const ref = parseRef("./Other.card@1.0.0");

  t.equal(ref.path, "./Other.card");
  t.equal(ref.version, "1.0.0");
  t.equal(ref.fragment, undefined);

  t.end();
});

test("parseRef: path with fragment (ID)", (t) => {
  const ref = parseRef("./Other.card#section");

  t.equal(ref.path, "./Other.card");
  t.equal(ref.version, undefined);
  t.equal(ref.fragment?.type, "id");
  t.equal(ref.fragment?.value, "section");

  t.end();
});

test("parseRef: path with version and fragment", (t) => {
  const ref = parseRef("./Other.card@1.0.0#section");

  t.equal(ref.path, "./Other.card");
  t.equal(ref.version, "1.0.0");
  t.equal(ref.fragment?.type, "id");
  t.equal(ref.fragment?.value, "section");

  t.end();
});

test("parseRef: path with query fragment", (t) => {
  const ref = parseRef("./Other.card#query(//element[@id='test'])");

  t.equal(ref.path, "./Other.card");
  t.equal(ref.fragment?.type, "query");
  t.equal(ref.fragment?.value, "//element[@id='test']");

  t.end();
});

test("parseRef: absolute path", (t) => {
  const ref = parseRef("/cards/Other.card@2.0.0");

  t.equal(ref.path, "/cards/Other.card");
  t.equal(ref.version, "2.0.0");
  t.equal(ref.isAbsolute, true);

  t.end();
});

test("parseRef: relative path with parent directory", (t) => {
  const ref = parseRef("../sibling/Other.card");

  t.equal(ref.path, "../sibling/Other.card");
  t.equal(ref.isAbsolute, false);

  t.end();
});

test("parseRef: semver-like versions", (t) => {
  const ref1 = parseRef("./card@1.0.0");
  t.equal(ref1.version, "1.0.0");

  const ref2 = parseRef("./card@2.3.4-beta.1");
  t.equal(ref2.version, "2.3.4-beta.1");

  const ref3 = parseRef("./card@0.0.1+build.123");
  t.equal(ref3.version, "0.0.1+build.123");

  t.end();
});

// Tests for resolveRef

test("resolveRef: resolve relative path", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0"><title>Other</title></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card", resolver);

  t.equal(result.resolvedPath, "/project/cards/Other.card");
  t.equal(result.exists, true);

  t.end();
});

test("resolveRef: resolve absolute path", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/other/Target.card": `<card version="1.0.0"><title>Target</title></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("/other/Target.card", resolver);

  t.equal(result.resolvedPath, "/project/other/Target.card");
  t.equal(result.exists, true);

  t.end();
});

test("resolveRef: detect broken link", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./NonExistent.card", resolver);

  t.equal(result.exists, false);
  t.ok(result.error);

  t.end();
});

test("resolveRef: resolve fragment by ID", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0">
      <section id="intro">Introduction</section>
      <section id="body">Body content</section>
    </card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card#intro", resolver);

  t.equal(result.exists, true);
  t.ok(result.fragment);
  t.equal(result.fragment?.tagName, "section");
  t.equal(result.fragment?.attrs["id"], "intro");

  t.end();
});

test("resolveRef: fragment not found", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0"><section>No ID</section></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card#missing", resolver);

  t.equal(result.exists, true); // File exists
  t.equal(result.fragment, undefined);
  t.ok(result.fragmentError); // But fragment doesn't

  t.end();
});

test("resolveRef: version tracking", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="2.0.0"><title>Other</title></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  // Reference version 1.0.0 but file has 2.0.0
  const result = await resolveRef("./Other.card@1.0.0", resolver);

  t.equal(result.exists, true);
  t.equal(result.requestedVersion, "1.0.0");
  t.equal(result.actualVersion, "2.0.0");
  t.equal(result.versionMismatch, true);

  t.end();
});

test("resolveRef: version matches", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0"><title>Other</title></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card@1.0.0", resolver);

  t.equal(result.requestedVersion, "1.0.0");
  t.equal(result.actualVersion, "1.0.0");
  t.equal(result.versionMismatch, false);

  t.end();
});

test("resolveRef: parent directory traversal", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/sub/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0"><title>Other</title></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/sub/Main.card",
  };

  const result = await resolveRef("../Other.card", resolver);

  t.equal(result.resolvedPath, "/project/cards/Other.card");
  t.equal(result.exists, true);

  t.end();
});
