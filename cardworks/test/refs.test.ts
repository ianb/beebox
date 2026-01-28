import { test } from "tap";
import { parseRef, parseRefs } from "../src/refs/parse-ref.js";
import { resolveRef, resolveRefs, type RefResolver } from "../src/refs/resolve.js";
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

// Tests for parseRefs (multiple whitespace-separated references)

test("parseRefs: single reference", (t) => {
  const refs = parseRefs("./Other.card");

  t.equal(refs.length, 1);
  t.equal(refs[0]?.path, "./Other.card");

  t.end();
});

test("parseRefs: multiple space-separated references", (t) => {
  const refs = parseRefs("./A.card ./B.card ./C.card");

  t.equal(refs.length, 3);
  t.equal(refs[0]?.path, "./A.card");
  t.equal(refs[1]?.path, "./B.card");
  t.equal(refs[2]?.path, "./C.card");

  t.end();
});

test("parseRefs: multiple references with versions", (t) => {
  const refs = parseRefs("./A.card@1.0.0 ./B.card@2.0.0");

  t.equal(refs.length, 2);
  t.equal(refs[0]?.path, "./A.card");
  t.equal(refs[0]?.version, "1.0.0");
  t.equal(refs[1]?.path, "./B.card");
  t.equal(refs[1]?.version, "2.0.0");

  t.end();
});

test("parseRefs: handles extra whitespace", (t) => {
  const refs = parseRefs("  ./A.card   ./B.card  ");

  t.equal(refs.length, 2);
  t.equal(refs[0]?.path, "./A.card");
  t.equal(refs[1]?.path, "./B.card");

  t.end();
});

test("parseRefs: handles newlines and tabs", (t) => {
  const refs = parseRefs("./A.card\n./B.card\t./C.card");

  t.equal(refs.length, 3);
  t.equal(refs[0]?.path, "./A.card");
  t.equal(refs[1]?.path, "./B.card");
  t.equal(refs[2]?.path, "./C.card");

  t.end();
});

test("parseRefs: empty string returns empty array", (t) => {
  const refs = parseRefs("");

  t.equal(refs.length, 0);

  t.end();
});

test("parseRefs: whitespace only returns empty array", (t) => {
  const refs = parseRefs("   \n\t  ");

  t.equal(refs.length, 0);

  t.end();
});

// Tests for resolveRefs (resolve multiple references)

test("resolveRefs: resolves multiple references", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/A.card": `<card version="1.0.0"><title>A</title></card>`,
    "/project/cards/B.card": `<card version="2.0.0"><title>B</title></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const results = await resolveRefs("./A.card ./B.card", resolver);

  t.equal(results.length, 2);
  t.equal(results[0]?.exists, true);
  t.equal(results[0]?.resolvedPath, "/project/cards/A.card");
  t.equal(results[1]?.exists, true);
  t.equal(results[1]?.resolvedPath, "/project/cards/B.card");

  t.end();
});

test("resolveRefs: handles mix of existing and missing", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Exists.card": `<card version="1.0.0"><title>Exists</title></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const results = await resolveRefs("./Exists.card ./Missing.card", resolver);

  t.equal(results.length, 2);
  t.equal(results[0]?.exists, true);
  t.equal(results[1]?.exists, false);

  t.end();
});

test("resolveRefs: tracks versions for each reference", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/A.card": `<card version="1.0.0"><title>A</title></card>`,
    "/project/cards/B.card": `<card version="3.0.0"><title>B</title></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const results = await resolveRefs("./A.card@1.0.0 ./B.card@2.0.0", resolver);

  t.equal(results.length, 2);
  t.equal(results[0]?.versionMismatch, false); // A matches
  t.equal(results[1]?.versionMismatch, true);  // B requested 2.0.0, has 3.0.0

  t.end();
});

// Tests for parseRef with query-all

test("parseRef: path with query-all fragment", (t) => {
  const ref = parseRef("./Other.card#query-all(//example)");

  t.equal(ref.path, "./Other.card");
  t.equal(ref.fragment?.type, "query-all");
  t.equal(ref.fragment?.value, "//example");

  t.end();
});

// Tests for XPath query resolution

test("resolveRef: #query() finds single element", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0">
      <section id="intro">Introduction</section>
      <section id="body">Body</section>
    </card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card#query(//section[@id='intro'])", resolver);

  t.equal(result.exists, true);
  t.ok(result.fragment);
  t.equal(result.fragment?.tagName, "section");
  t.equal(result.fragment?.attrs["id"], "intro");
  t.equal(result.fragmentError, undefined);
  t.equal(result.fragmentWarning, undefined);

  t.end();
});

test("resolveRef: #query() warns on multiple matches", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0">
      <section>First</section>
      <section>Second</section>
      <section>Third</section>
    </card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card#query(//section)", resolver);

  t.equal(result.exists, true);
  t.ok(result.fragment); // Still returns first match
  t.equal(result.fragment?.tagName, "section");
  t.ok(result.fragmentWarning?.includes("matched 3 elements"));
  t.equal(result.fragmentError, undefined);

  t.end();
});

test("resolveRef: #query() errors on no match", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0">
      <section>Content</section>
    </card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card#query(//nonexistent)", resolver);

  t.equal(result.exists, true);
  t.equal(result.fragment, undefined);
  t.ok(result.fragmentError?.includes("Fragment not found"));

  t.end();
});

test("resolveRef: #query-all() returns multiple elements", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0">
      <example>First</example>
      <content>Not an example</content>
      <example>Second</example>
      <example>Third</example>
    </card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card#query-all(//example)", resolver);

  t.equal(result.exists, true);
  t.ok(result.fragments);
  t.equal(result.fragments?.length, 3);
  t.equal(result.fragments?.[0]?.tagName, "example");
  t.equal(result.fragments?.[0]?.text, "First");
  t.equal(result.fragments?.[1]?.text, "Second");
  t.equal(result.fragments?.[2]?.text, "Third");
  t.equal(result.fragmentError, undefined);
  t.equal(result.fragmentWarning, undefined);

  t.end();
});

test("resolveRef: #query-all() warns on no matches", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0">
      <section>Content</section>
    </card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card#query-all(//nonexistent)", resolver);

  t.equal(result.exists, true);
  t.ok(result.fragments);
  t.equal(result.fragments?.length, 0);
  t.ok(result.fragmentWarning?.includes("No elements matched"));
  t.equal(result.fragmentError, undefined);

  t.end();
});

test("resolveRef: #query() handles complex XPath", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0">
      <content>
        <section type="intro">Intro</section>
        <section type="body">Body</section>
      </content>
    </card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card#query(//section[@type='body'])", resolver);

  t.equal(result.exists, true);
  t.ok(result.fragment);
  t.equal(result.fragment?.attrs["type"], "body");
  t.equal(result.fragment?.text, "Body");

  t.end();
});

test("resolveRef: #query() with invalid XPath returns error", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0"><section>Content</section></card>`,
  });

  const resolver: RefResolver = {
    fs,
    projectRoot: "/project",
    currentFile: "/project/cards/Main.card",
  };

  const result = await resolveRef("./Other.card#query([invalid xpath)", resolver);

  t.equal(result.exists, true);
  t.equal(result.fragment, undefined);
  t.ok(result.fragmentError?.includes("XPath error"));

  t.end();
});
