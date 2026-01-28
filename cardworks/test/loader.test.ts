import { test } from "tap";
import { CardLoader } from "../src/loader/loader.js";
import { MemoryFileSystem } from "../src/fs/memory-fs.js";

test("CardLoader.load: loads a simple card", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Simple.card": `<card version="1.0.0">
  <title>Simple Card</title>
  <description>A test card</description>
</card>`,
  });

  const loader = new CardLoader(fs, "/project");
  const card = await loader.load("/project/cards/Simple.card");

  t.equal(card.tagName, "card");
  t.equal(card.attrs["version"], "1.0.0");
  t.equal(card.children.length, 2);
  t.equal(card.children[0]?.text, "Simple Card");
});

test("CardLoader.load: throws on non-existent file", async (t) => {
  const fs = new MemoryFileSystem({});

  const loader = new CardLoader(fs, "/project");

  await t.rejects(async () => {
    await loader.load("/project/cards/Missing.card");
  });
});

test("CardLoader.save: saves a card", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Existing.card": `<card version="1.0.0"><title>Original</title></card>`,
  });

  const loader = new CardLoader(fs, "/project");

  // Load, modify, save
  const card = await loader.load("/project/cards/Existing.card");
  card.children[0]!.text = "Modified";
  card.dirty = true;

  await loader.save("/project/cards/Existing.card", card);

  // Reload and verify
  const reloaded = await loader.load("/project/cards/Existing.card");
  t.equal(reloaded.children[0]?.text, "Modified");
});

test("CardLoader.resolveRef: resolves cross-card reference", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0">
  <section id="intro">Introduction</section>
</card>`,
  });

  const loader = new CardLoader(fs, "/project");
  const result = await loader.resolveRef(
    "./Other.card#intro",
    "/project/cards/Main.card"
  );

  t.equal(result.exists, true);
  t.ok(result.fragment);
  t.equal(result.fragment?.attrs["id"], "intro");
});

test("CardLoader.resolveRef: detects version mismatch", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="2.0.0"><title>Other</title></card>`,
  });

  const loader = new CardLoader(fs, "/project");
  const result = await loader.resolveRef(
    "./Other.card@1.0.0",
    "/project/cards/Main.card"
  );

  t.equal(result.exists, true);
  t.equal(result.versionMismatch, true);
  t.equal(result.requestedVersion, "1.0.0");
  t.equal(result.actualVersion, "2.0.0");
});

test("CardLoader: full workflow with fixture files", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Audience.card": `<audience version="1.0.0">
  <selection-text>Test audience</selection-text>
  <short-description>A simple test card</short-description>
</audience>`,
    "/project/cards/Technique.card": `<technique version="1.0.0">
  <purpose>Test technique</purpose>
  <guidance>First guidance</guidance>
  <prompts title="Test">
    <prompt>A prompt</prompt>
  </prompts>
  <guidance match="special">Second guidance</guidance>
</technique>`,
    "/project/cards/Tutorial.card": `<tutorial version="1.0.0">
  <content>
    See [other card](ref:./Audience.card@1.0.0#section).
  </content>
  <source ref="./Technique.card@1.0.0">Reference explanation</source>
</tutorial>`,
  });

  const loader = new CardLoader(fs, "/project");

  // Load all cards
  const audience = await loader.load("/project/cards/Audience.card");
  const technique = await loader.load("/project/cards/Technique.card");
  const tutorial = await loader.load("/project/cards/Tutorial.card");

  t.equal(audience.tagName, "audience");
  t.equal(technique.tagName, "technique");
  t.equal(tutorial.tagName, "tutorial");

  // Verify structure
  t.equal(technique.children.length, 4);
  t.equal(technique.children[2]?.tagName, "prompts");

  // Resolve reference from tutorial
  const techRef = await loader.resolveRef(
    "./Technique.card@1.0.0",
    "/project/cards/Tutorial.card"
  );
  t.equal(techRef.exists, true);
  t.equal(techRef.versionMismatch, false);
});

test("CardLoader: caches loaded cards", async (t) => {
  let readCount = 0;
  const fs = new MemoryFileSystem({
    "/project/cards/Cached.card": `<card version="1.0.0"><title>Cached</title></card>`,
  });

  // Wrap read to count calls
  const originalRead = fs.read.bind(fs);
  fs.read = async (path: string): Promise<string> => {
    readCount++;
    return originalRead(path);
  };

  const loader = new CardLoader(fs, "/project");

  // Load same card twice
  await loader.load("/project/cards/Cached.card");
  await loader.load("/project/cards/Cached.card");

  // Should only have read once (cached)
  t.equal(readCount, 1);
});

test("CardLoader: clearCache forces reload", async (t) => {
  let readCount = 0;
  const fs = new MemoryFileSystem({
    "/project/cards/Reload.card": `<card version="1.0.0"><title>Original</title></card>`,
  });

  const originalRead = fs.read.bind(fs);
  fs.read = async (path: string): Promise<string> => {
    readCount++;
    return originalRead(path);
  };

  const loader = new CardLoader(fs, "/project");

  // Load, clear cache, load again
  await loader.load("/project/cards/Reload.card");
  loader.clearCache();
  await loader.load("/project/cards/Reload.card");

  // Should have read twice
  t.equal(readCount, 2);
});

test("CardLoader.exists: checks if card file exists", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/Exists.card": `<card version="1.0.0"><title>Exists</title></card>`,
  });

  const loader = new CardLoader(fs, "/project");

  t.equal(await loader.exists("/project/cards/Exists.card"), true);
  t.equal(await loader.exists("/project/cards/Missing.card"), false);
});

test("CardLoader: handles absolute project-relative refs", async (t) => {
  const fs = new MemoryFileSystem({
    "/project/cards/sub/Deep.card": `<card version="1.0.0"><title>Deep</title></card>`,
    "/project/other/Target.card": `<card version="1.0.0"><title>Target</title></card>`,
  });

  const loader = new CardLoader(fs, "/project");
  const result = await loader.resolveRef(
    "/other/Target.card",
    "/project/cards/sub/Deep.card"
  );

  t.equal(result.exists, true);
  t.equal(result.resolvedPath, "/project/other/Target.card");
});
