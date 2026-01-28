import { test } from "tap";
import { MemoryCardLoader, ValidationError } from "../src/loader/loader.js";
import { element } from "../src/schema/element.js";
import { z } from "zod";

test("MemoryCardLoader.load: loads a simple card", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Simple.card": `<card version="1.0.0">
  <title>Simple Card</title>
  <description>A test card</description>
</card>`,
    },
  });

  const card = await loader.load("/project/cards/Simple.card");

  t.equal(card.tagName, "card");
  t.equal(card.attrs["version"], "1.0.0");
  t.equal(card.children.length, 2);
  t.equal(card.children[0]?.text, "Simple Card");
});

test("MemoryCardLoader.load: throws on non-existent file", async (t) => {
  const loader = new MemoryCardLoader("/project");

  await t.rejects(async () => {
    await loader.load("/project/cards/Missing.card");
  });
});

test("MemoryCardLoader.save: saves a card", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Existing.card": `<card version="1.0.0"><title>Original</title></card>`,
    },
  });

  // Load, modify, save
  const card = await loader.load("/project/cards/Existing.card");
  card.children[0]!.text = "Modified";
  card.dirty = true;

  await loader.save("/project/cards/Existing.card", card);

  // Reload to verify persistence
  const reloaded = await loader.load("/project/cards/Existing.card");
  t.equal(reloaded.children[0]?.text, "Modified");
});

test("MemoryCardLoader.resolveRef: resolves cross-card reference", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
      "/project/cards/Other.card": `<card version="1.0.0">
  <section id="intro">Introduction</section>
</card>`,
    },
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
    files: {
      "/project/cards/Main.card": `<card version="1.0.0"><title>Main</title></card>`,
      "/project/cards/Other.card": `<card version="2.0.0"><title>Other</title></card>`,
    },
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
    files: {
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
    },
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

test("MemoryCardLoader.exists: checks if card file exists", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Exists.card": `<card version="1.0.0"><title>Exists</title></card>`,
    },
  });

  t.equal(await loader.exists("/project/cards/Exists.card"), true);
  t.equal(await loader.exists("/project/cards/Missing.card"), false);
});

test("MemoryCardLoader: handles absolute project-relative refs", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/sub/Deep.card": `<card version="1.0.0"><title>Deep</title></card>`,
      "/project/other/Target.card": `<card version="1.0.0"><title>Target</title></card>`,
    },
  });

  const result = await loader.resolveRef(
    "/other/Target.card",
    "/project/cards/sub/Deep.card"
  );

  t.equal(result.exists, true);
  t.equal(result.resolvedPath, "/project/other/Target.card");
});

test("MemoryCardLoader.getProjectRoot: returns project root", (t) => {
  const loader = new MemoryCardLoader("/my/project");
  t.equal(loader.getProjectRoot(), "/my/project");
  t.end();
});

// Schema validation tests

const CardSchema = element("card", {
  children: z.array(
    z.union([
      element("title", { text: z.string() }),
      element("description", { text: z.string() }),
    ])
  ),
});

test("MemoryCardLoader: validates against registered schema", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Valid.card": `<card version="1.0.0">
  <title>Valid Card</title>
</card>`,
    },
    schemas: [CardSchema],
  });

  const card = await loader.load("/project/cards/Valid.card");
  t.equal(card.tagName, "card");
  t.equal(card.children[0]?.text, "Valid Card");
});

test("MemoryCardLoader: throws ValidationError on schema mismatch", async (t) => {
  const StrictSchema = element("card", {
    children: z.array(element("title", { text: z.string().min(10) })),
  });

  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Invalid.card": `<card version="1.0.0">
  <title>Short</title>
</card>`,
    },
    schemas: [StrictSchema],
  });

  await t.rejects(
    async () => {
      await loader.load("/project/cards/Invalid.card");
    },
    ValidationError,
    "Should throw ValidationError"
  );
});

test("MemoryCardLoader: skips validation for unregistered tag names", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Unknown.card": `<unknown version="1.0.0">
  <anything>goes</anything>
</unknown>`,
    },
    schemas: [CardSchema], // Only CardSchema registered, not "unknown"
  });

  // Should load without error since "unknown" has no registered schema
  const card = await loader.load("/project/cards/Unknown.card");
  t.equal(card.tagName, "unknown");
});

// Move tests

test("MemoryCardLoader.move: moves a card file", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/OldName.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
  });

  const result = await loader.move(
    "/project/cards/OldName.card",
    "/project/cards/NewName.card"
  );

  t.equal(result.movedFiles.length, 1);
  t.equal(result.movedFiles[0]?.from, "/project/cards/OldName.card");
  t.equal(result.movedFiles[0]?.to, "/project/cards/NewName.card");

  // Old path should not exist
  t.equal(await loader.exists("/project/cards/OldName.card"), false);

  // New path should exist
  const card = await loader.load("/project/cards/NewName.card");
  t.equal(card.tagName, "card");
});

test("MemoryCardLoader.move: moves related files with same basename", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Recipe.card": `<card version="1.0.0"><title>Recipe</title></card>`,
      "/project/cards/Recipe.png": "image data",
      "/project/cards/Recipe.json": '{"meta": true}',
      "/project/cards/Other.card": `<card version="1.0.0"><title>Other</title></card>`,
    },
  });

  const result = await loader.move(
    "/project/cards/Recipe.card",
    "/project/cards/Pasta.card"
  );

  // Should move all Recipe.* files
  t.equal(result.movedFiles.length, 3);

  const movedPaths = result.movedFiles.map((f) => f.to).sort();
  t.same(movedPaths, [
    "/project/cards/Pasta.card",
    "/project/cards/Pasta.json",
    "/project/cards/Pasta.png",
  ]);

  // Other.card should still exist
  t.equal(await loader.exists("/project/cards/Other.card"), true);
});

test("MemoryCardLoader.move: updates references in other cards", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Main.card": `<card version="1.0.0">
  <ref ref="./Target.card"/>
  <ref ref="./Target.card@1.0.0"/>
  <ref ref="./Target.card#section"/>
</card>`,
      "/project/cards/Target.card": `<card version="1.0.0"><title>Target</title></card>`,
    },
  });

  const result = await loader.move(
    "/project/cards/Target.card",
    "/project/cards/sub/Moved.card"
  );

  t.equal(result.updatedCards.length, 1);
  t.equal(result.updatedCards[0]?.path, "/project/cards/Main.card");
  t.equal(result.updatedCards[0]?.refsUpdated, 3);

  // Check the updated refs
  const main = await loader.load("/project/cards/Main.card");
  t.equal(main.children[0]?.attrs["ref"], "./sub/Moved.card");
  t.equal(main.children[1]?.attrs["ref"], "./sub/Moved.card@1.0.0");
  t.equal(main.children[2]?.attrs["ref"], "./sub/Moved.card#section");
});

test("MemoryCardLoader.move: throws if extension changes", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Test.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
  });

  await t.rejects(
    async () => {
      await loader.move("/project/cards/Test.card", "/project/cards/Test.xml");
    },
    /Cannot change extension/
  );
});

test("MemoryCardLoader.move: throws if source doesn't exist", async (t) => {
  const loader = new MemoryCardLoader("/project");

  await t.rejects(
    async () => {
      await loader.move("/project/cards/Missing.card", "/project/cards/New.card");
    },
    /Source file does not exist/
  );
});

test("MemoryCardLoader.move: handles move to different directory", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/recipes/Pasta.card": `<card version="1.0.0"><title>Pasta</title></card>`,
      "/project/cards/Main.card": `<card version="1.0.0">
  <ref ref="./recipes/Pasta.card"/>
</card>`,
    },
  });

  const result = await loader.move(
    "/project/cards/recipes/Pasta.card",
    "/project/cards/archive/OldPasta.card"
  );

  t.equal(result.movedFiles.length, 1);
  t.equal(result.updatedCards.length, 1);

  const main = await loader.load("/project/cards/Main.card");
  t.equal(main.children[0]?.attrs["ref"], "./archive/OldPasta.card");
});
