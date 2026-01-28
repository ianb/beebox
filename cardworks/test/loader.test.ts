import { test } from "tap";
import { MemoryCardLoader } from "../src/loader/loader.js";

test("MemoryCardLoader.load: loads a simple card", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    "/project/cards/Simple.card": `<card version="1.0.0">
  <title>Simple Card</title>
  <description>A test card</description>
</card>`,
  });

  const card = await loader.load("/project/cards/Simple.card");

  t.equal(card.tagName, "card");
  t.equal(card.attrs["version"], "1.0.0");
  t.equal(card.children.length, 2);
  t.equal(card.children[0]?.text, "Simple Card");
});

test("MemoryCardLoader.load: throws on non-existent file", async (t) => {
  const loader = new MemoryCardLoader("/project", {});

  await t.rejects(async () => {
    await loader.load("/project/cards/Missing.card");
  });
});

test("MemoryCardLoader.save: saves a card", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    "/project/cards/Existing.card": `<card version="1.0.0"><title>Original</title></card>`,
  });

  // Load, modify, save
  const card = await loader.load("/project/cards/Existing.card");
  card.children[0]!.text = "Modified";
  card.dirty = true;

  await loader.save("/project/cards/Existing.card", card);

  // Clear cache and reload to verify persistence
  loader.clearCache();
  const reloaded = await loader.load("/project/cards/Existing.card");
  t.equal(reloaded.children[0]?.text, "Modified");
});

test("MemoryCardLoader.resolveRef: resolves cross-card reference", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="1.0.0">
  <section id="intro">Introduction</section>
</card>`,
  });

  const result = await loader.resolveRef(
    "./Other.card#intro",
    "/project/cards/Main.card"
  );

  t.equal(result.exists, true);
  t.ok(result.fragment);
  t.equal(result.fragment?.attrs["id"], "intro");
});

test("MemoryCardLoader.resolveRef: detects version mismatch", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
    "/project/cards/Other.card": `<card version="2.0.0"><title>Other</title></card>`,
  });

  const result = await loader.resolveRef(
    "./Other.card@1.0.0",
    "/project/cards/Main.card"
  );

  t.equal(result.exists, true);
  t.equal(result.versionMismatch, true);
  t.equal(result.requestedVersion, "1.0.0");
  t.equal(result.actualVersion, "2.0.0");
});

test("MemoryCardLoader: full workflow with fixture files", async (t) => {
  const loader = new MemoryCardLoader("/project", {
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

test("MemoryCardLoader: caches loaded cards", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    "/project/cards/Cached.card": `<card version="1.0.0"><title>Original</title></card>`,
  });

  // Load the card
  const first = await loader.load("/project/cards/Cached.card");
  t.equal(first.children[0]?.text, "Original");

  // Modify the underlying file
  loader.setFile(
    "/project/cards/Cached.card",
    `<card version="1.0.0"><title>Modified</title></card>`
  );

  // Load again - should return cached version
  const second = await loader.load("/project/cards/Cached.card");
  t.equal(second.children[0]?.text, "Original", "Should return cached version");
});

test("MemoryCardLoader: clearCache forces reload", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    "/project/cards/Reload.card": `<card version="1.0.0"><title>Original</title></card>`,
  });

  // Load the card
  const first = await loader.load("/project/cards/Reload.card");
  t.equal(first.children[0]?.text, "Original");

  // Modify the underlying file
  loader.setFile(
    "/project/cards/Reload.card",
    `<card version="1.0.0"><title>Modified</title></card>`
  );

  // Clear cache and load again
  loader.clearCache();
  const second = await loader.load("/project/cards/Reload.card");
  t.equal(second.children[0]?.text, "Modified", "Should return new version after cache clear");
});

test("MemoryCardLoader: invalidate removes specific file from cache", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    "/project/cards/A.card": `<card version="1.0.0"><title>A Original</title></card>`,
    "/project/cards/B.card": `<card version="1.0.0"><title>B Original</title></card>`,
  });

  // Load both cards
  await loader.load("/project/cards/A.card");
  await loader.load("/project/cards/B.card");

  // Modify both files
  loader.setFile(
    "/project/cards/A.card",
    `<card version="1.0.0"><title>A Modified</title></card>`
  );
  loader.setFile(
    "/project/cards/B.card",
    `<card version="1.0.0"><title>B Modified</title></card>`
  );

  // Invalidate only A
  loader.invalidate("/project/cards/A.card");

  // A should be reloaded, B should still be cached
  const a = await loader.load("/project/cards/A.card");
  const b = await loader.load("/project/cards/B.card");

  t.equal(a.children[0]?.text, "A Modified", "A should be reloaded");
  t.equal(b.children[0]?.text, "B Original", "B should still be cached");
});

test("MemoryCardLoader.exists: checks if card file exists", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    "/project/cards/Exists.card": `<card version="1.0.0"><title>Exists</title></card>`,
  });

  t.equal(await loader.exists("/project/cards/Exists.card"), true);
  t.equal(await loader.exists("/project/cards/Missing.card"), false);
});

test("MemoryCardLoader: handles absolute project-relative refs", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    "/project/cards/sub/Deep.card": `<card version="1.0.0"><title>Deep</title></card>`,
    "/project/other/Target.card": `<card version="1.0.0"><title>Target</title></card>`,
  });

  const result = await loader.resolveRef(
    "/other/Target.card",
    "/project/cards/sub/Deep.card"
  );

  t.equal(result.exists, true);
  t.equal(result.resolvedPath, "/project/other/Target.card");
});

test("MemoryCardLoader.getProjectRoot: returns project root", (t) => {
  const loader = new MemoryCardLoader("/my/project", {});
  t.equal(loader.getProjectRoot(), "/my/project");
  t.end();
});
