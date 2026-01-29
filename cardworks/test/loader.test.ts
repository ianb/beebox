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

  t.equal(card.path, "/project/cards/Simple.card");
  t.equal(card.element.tagName, "card");
  t.equal(card.element.attrs["version"], "1.0.0");
  t.equal(card.version, "1.0.0");
  t.equal(card.element.children.length, 2);
  t.equal(card.element.children[0]?.text, "Simple Card");
  t.ok(card.loadedAt instanceof Date);
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
  card.element.children[0]!.text = "Modified";
  card.element.dirty = true;

  await loader.save(card);

  // Reload to verify persistence
  const reloaded = await loader.load("/project/cards/Existing.card");
  t.equal(reloaded.element.children[0]?.text, "Modified");
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

  t.equal(audience.element.tagName, "audience");
  t.equal(technique.element.tagName, "technique");
  t.equal(tutorial.element.tagName, "tutorial");

  // Verify structure
  t.equal(technique.element.children.length, 4);
  t.equal(technique.element.children[2]?.tagName, "prompts");

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
  t.equal(card.element.tagName, "card");
  t.equal(card.element.children[0]?.text, "Valid Card");
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
  t.equal(card.element.tagName, "unknown");
});

// Move tests

test("MemoryCardLoader.move: moves a card file", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/OldName.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
  });

  const card = await loader.load("/project/cards/OldName.card");
  const { card: movedCard, result } = await loader.move(
    card,
    "/project/cards/NewName.card"
  );

  t.equal(result.movedFiles.length, 1);
  t.equal(result.movedFiles[0]?.from, "/project/cards/OldName.card");
  t.equal(result.movedFiles[0]?.to, "/project/cards/NewName.card");

  // Moved card has new path
  t.equal(movedCard.path, "/project/cards/NewName.card");

  // Old path should not exist
  t.equal(await loader.exists("/project/cards/OldName.card"), false);

  // New path should exist
  const reloaded = await loader.load("/project/cards/NewName.card");
  t.equal(reloaded.element.tagName, "card");
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

  const card = await loader.load("/project/cards/Recipe.card");
  const { result } = await loader.move(card, "/project/cards/Pasta.card");

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

  const targetCard = await loader.load("/project/cards/Target.card");
  const { result } = await loader.move(targetCard, "/project/cards/sub/Moved.card");

  t.equal(result.updatedCards.length, 1);
  t.equal(result.updatedCards[0]?.path, "/project/cards/Main.card");
  t.equal(result.updatedCards[0]?.refsUpdated, 3);

  // Check the updated refs
  const main = await loader.load("/project/cards/Main.card");
  t.equal(main.element.children[0]?.attrs["ref"], "./sub/Moved.card");
  t.equal(main.element.children[1]?.attrs["ref"], "./sub/Moved.card@1.0.0");
  t.equal(main.element.children[2]?.attrs["ref"], "./sub/Moved.card#section");
});

test("MemoryCardLoader.move: throws if extension changes", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Test.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
  });

  const card = await loader.load("/project/cards/Test.card");
  await t.rejects(
    async () => {
      await loader.move(card, "/project/cards/Test.xml");
    },
    /Cannot change extension/
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

  const card = await loader.load("/project/cards/recipes/Pasta.card");
  const { result } = await loader.move(card, "/project/cards/archive/OldPasta.card");

  t.equal(result.movedFiles.length, 1);
  t.equal(result.updatedCards.length, 1);

  const main = await loader.load("/project/cards/Main.card");
  t.equal(main.element.children[0]?.attrs["ref"], "./archive/OldPasta.card");
});

// Tests for findIncomingRefs and findOutgoingRefs

test("MemoryCardLoader.findIncomingRefs: finds cards that reference target", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Target.card": `<card version="1.0.0"><title>Target</title></card>`,
      "/project/RefA.card": `<card version="1.0.0">
  <source ref="./Target.card"/>
</card>`,
      "/project/RefB.card": `<card version="1.0.0">
  <link ref="./Target.card@1.0.0#section"/>
</card>`,
      "/project/NoRef.card": `<card version="1.0.0"><title>No refs</title></card>`,
    },
  });

  const refs = await loader.findIncomingRefs("/project/Target.card");

  t.equal(refs.length, 2);
  t.ok(refs.some((r) => r.fromPath === "/project/RefA.card"));
  t.ok(refs.some((r) => r.fromPath === "/project/RefB.card"));
});

test("MemoryCardLoader.findIncomingRefs: includes ref details", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Target.card": `<card version="1.0.0"><title>Target</title></card>`,
      "/project/Source.card": `<card version="1.0.0">
  <source ref="./Target.card@1.0.0#intro">Explanation</source>
</card>`,
    },
  });

  const refs = await loader.findIncomingRefs("/project/Target.card");

  t.equal(refs.length, 1);
  t.equal(refs[0]?.elementTagName, "source");
  t.equal(refs[0]?.attributeName, "ref");
  t.equal(refs[0]?.version, "1.0.0");
  t.equal(refs[0]?.fragment, "intro");
});

test("MemoryCardLoader.findIncomingRefs: finds refs from refs attribute", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Target.card": `<card version="1.0.0"><title>Target</title></card>`,
      "/project/Other.card": `<card version="1.0.0"><title>Other</title></card>`,
      "/project/Source.card": `<card version="1.0.0">
  <derived refs="./Target.card ./Other.card"/>
</card>`,
    },
  });

  const refs = await loader.findIncomingRefs("/project/Target.card");

  t.equal(refs.length, 1);
  t.equal(refs[0]?.attributeName, "refs");
  t.equal(refs[0]?.elementTagName, "derived");
});

test("MemoryCardLoader.findOutgoingRefs: finds all references from a card", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Source.card": `<card version="1.0.0">
  <source ref="./A.card"/>
  <related refs="./B.card ./C.card"/>
</card>`,
      "/project/A.card": `<card version="1.0.0"><title>A</title></card>`,
      "/project/B.card": `<card version="1.0.0"><title>B</title></card>`,
      "/project/C.card": `<card version="1.0.0"><title>C</title></card>`,
    },
  });

  const refs = await loader.findOutgoingRefs("/project/Source.card");

  t.equal(refs.length, 3);
  t.ok(refs.some((r) => r.toPath === "/project/A.card" && r.attributeName === "ref"));
  t.ok(refs.some((r) => r.toPath === "/project/B.card" && r.attributeName === "refs"));
  t.ok(refs.some((r) => r.toPath === "/project/C.card" && r.attributeName === "refs"));
});

test("MemoryCardLoader.findOutgoingRefs: handles nested elements", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Source.card": `<card version="1.0.0">
  <content>
    <section>
      <link ref="./Deep.card"/>
    </section>
  </content>
</card>`,
      "/project/Deep.card": `<card version="1.0.0"><title>Deep</title></card>`,
    },
  });

  const refs = await loader.findOutgoingRefs("/project/Source.card");

  t.equal(refs.length, 1);
  t.equal(refs[0]?.toPath, "/project/Deep.card");
  t.equal(refs[0]?.elementTagName, "link");
});

test("MemoryCardLoader.move: updates refs attribute", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Target.card": `<card version="1.0.0"><title>Target</title></card>`,
      "/project/Other.card": `<card version="1.0.0"><title>Other</title></card>`,
      "/project/Source.card": `<card version="1.0.0">
  <derived refs="./Target.card ./Other.card"/>
</card>`,
    },
  });

  const targetCard = await loader.load("/project/Target.card");
  const { result } = await loader.move(targetCard, "/project/Renamed.card");

  t.equal(result.updatedCards.length, 1);
  t.equal(result.updatedCards[0]?.refsUpdated, 1);

  const source = await loader.load("/project/Source.card");
  const refsAttr = source.element.children[0]?.attrs["refs"];
  t.ok(refsAttr?.includes("./Renamed.card"));
  t.ok(refsAttr?.includes("./Other.card"));
});

// Card interface tests

test("Card.isDirty: returns false for unmodified card", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Test.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
  });

  const card = await loader.load("/project/Test.card");
  t.equal(card.isDirty(), false);
});

test("Card.isDirty: returns true after modification", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Test.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
  });

  const card = await loader.load("/project/Test.card");
  card.element.children[0]!.text = "Modified";

  t.equal(card.isDirty(), true);
});

test("Card.isStale: returns false immediately after load", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Test.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
  });

  const card = await loader.load("/project/Test.card");
  t.equal(await card.isStale(), false);
});

test("Card.isStale: returns true after file is modified", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Test.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
  });

  const card = await loader.load("/project/Test.card");

  // Simulate external modification by updating mtime
  // We need to access the internal memoryFs - let's use setFile which updates mtime
  await new Promise((r) => setTimeout(r, 10)); // Small delay to ensure different mtime
  loader.setFile("/project/Test.card", `<card version="1.0.0"><title>Changed</title></card>`);

  t.equal(await card.isStale(), true);
});

test("Card.version: returns version from root element", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Test.card": `<card version="2.5.3"><title>Test</title></card>`,
    },
  });

  const card = await loader.load("/project/Test.card");
  t.equal(card.version, "2.5.3");
});

test("Card.getMedia: finds accompanying media files", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Recipe.card": `<card version="1.0.0"><title>Recipe</title></card>`,
      "/project/Recipe.png": "image data",
      "/project/Recipe.m4a": "audio data",
      "/project/Other.png": "other image",
    },
  });

  const card = await loader.load("/project/Recipe.card");
  const media = await card.getMedia();

  t.equal(media["png"], "/project/Recipe.png");
  t.equal(media["m4a"], "/project/Recipe.m4a");
  t.notOk(media["card"]); // Should not include the card file itself
  t.notOk(media["Other"]); // Should not include files with different basename
});

test("Card.getMedia: returns empty object when no media files", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Test.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
  });

  const card = await loader.load("/project/Test.card");
  const media = await card.getMedia();

  t.same(media, {});
});

test("MemoryCardLoader.saveAs: creates new card at different path", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Original.card": `<card version="1.0.0"><title>Original</title></card>`,
    },
  });

  const original = await loader.load("/project/Original.card");
  const copy = await loader.saveAs(original, "/project/Copy.card");

  // Original still exists
  t.equal(await loader.exists("/project/Original.card"), true);

  // Copy exists with new path
  t.equal(copy.path, "/project/Copy.card");
  t.equal(await loader.exists("/project/Copy.card"), true);

  // Copy has same content
  t.equal(copy.element.children[0]?.text, "Original");
});
