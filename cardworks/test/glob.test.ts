import { test } from "tap";
import { MemoryFileSystem } from "../src/fs/memory-fs.js";

test("glob: matches files with **/*.ext pattern", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/a.card": "content",
    "/project/dir/b.card": "content",
    "/project/dir/sub/c.card": "content",
    "/project/other.txt": "content",
  });

  const results = await fs.glob("/project", "**/*.card");

  t.same(results.sort(), [
    "/project/a.card",
    "/project/dir/b.card",
    "/project/dir/sub/c.card",
  ]);
});

test("glob: matches files in root with **/*.ext", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/root.card": "content",
  });

  const results = await fs.glob("/project", "**/*.card");

  t.same(results, ["/project/root.card"]);
});

test("glob: matches with single * wildcard", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/foo.card": "content",
    "/project/bar.card": "content",
    "/project/baz.txt": "content",
    "/project/sub/nested.card": "content",
  });

  const results = await fs.glob("/project", "*.card");

  t.same(results.sort(), ["/project/bar.card", "/project/foo.card"]);
});

test("glob: matches specific directory", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/a.card": "content",
    "/project/cards/b.card": "content",
    "/project/other/c.card": "content",
  });

  const results = await fs.glob("/project", "cards/*.card");

  t.same(results.sort(), ["/project/cards/a.card", "/project/cards/b.card"]);
});

test("glob: matches with ? wildcard", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/a1.card": "content",
    "/project/a2.card": "content",
    "/project/abc.card": "content",
  });

  const results = await fs.glob("/project", "a?.card");

  t.same(results.sort(), ["/project/a1.card", "/project/a2.card"]);
});

test("glob: escapes regex special characters in pattern", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/file.test.card": "content",
    "/project/file-test.card": "content",
  });

  const results = await fs.glob("/project", "file.test.card");

  t.same(results, ["/project/file.test.card"]);
});

test("glob: matches all files with **/*", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/a.txt": "content",
    "/project/dir/b.card": "content",
    "/project/dir/sub/c.json": "content",
  });

  const results = await fs.glob("/project", "**/*");

  t.equal(results.length, 3);
});
