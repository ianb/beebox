// # Presentation catalog route
//
// The frontend loads one box-scoped snapshot: built-in catalog metadata, validated
// box selection rules, schema defaults, and independently resolved chrome.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { clearBoxConfigCache, loadBoxConfig, loadBoxConfigResult } from "../../../../src/core/box/config.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { execFileSync } from "node:child_process";

function caller(boxRoot: string, options?: { authed?: boolean; isOwner?: boolean }): ReturnType<typeof appRouter.createCaller> {
  return appRouter.createCaller(trpcContext({
    boxRoot,
    authed: options?.authed !== false,
    isOwner: options?.isOwner !== false,
    isAuthenticatedOwner: options?.isOwner !== false,
  }));
}

/** Run with console.warn silenced: the degradation these examples cause is logged by design. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.warn = originalWarn;
  }
}

// An absent config is ordinary and exposes the stable built-in catalog.
void test("An absent config is ordinary and exposes the stable built-in catalog.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L28
  const box = await makeTmpBox();
  const first = await caller(box.root).presentation.get({ boxKey: "test" });
  t.check([first.catalog.map((theme) => theme.name), first.presentation, first.chrome, first.configProblems], [
    [
      "plain",
      "spectrum",
      "paper",
      "post-it",
      "candy",
      "letter-set",
      "bloom",
      "ribbon",
      "deck",
      "night-atlas",
      "rose-trellis",
      "gold-thread",
      "goldfish",
      "doodlebit",
      "phosphor",
      "overprint",
      "posy",
      "tempest",
      "veil",
      "gilt",
    ],
    {
      status: "absent",
    },
    {
      choice: {
        name: "plain",
        stock: "neutral",
      },
      origin: "engine",
      problem: null,
    },
    [],
  ]);

  // doctest:L33
  t.check([
    first.canEditCardThemes,
    (await caller(box.root, { isOwner: false }).presentation.get({ boxKey: "test-reader" })).canEditCardThemes,
    (await caller(box.root, { authed: false }).presentation.get({ boxKey: "test-anon" })).canEditCardThemes,
  ], [true, true, false]);

  // Invalid JSON stays distinguishable from absence while legacy callers retain
  // their established empty-object fallback. A corrected edit recovers.

  // doctest:L45
  const configPath = path.join(box.root, "_config", "box.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, "{ broken\n");
  clearBoxConfigCache(box.root);
  const broken = await quietly(() => loadBoxConfigResult(box.root));
  t.check([broken.status, await loadBoxConfig(box.root)], [
    "invalid",
    {},
  ]);

  // doctest:L56
  await fs.writeFile(configPath, JSON.stringify({
    timezone: "America/Chicago",
    presentation: {
      default: { name: "paper", stock: "blue" },
      rules: [{ match: "_content/notes/**", theme: { name: "post-it" } }],
      chrome: { name: "paper", stock: "manila" },
    },
  }));
  clearBoxConfigCache(box.root);
  const recovered = await caller(box.root).presentation.get({ boxKey: "test" });
  t.check([recovered.presentation.status, recovered.chrome.choice, recovered.configProblems], [
    "valid",
    {
      name: "paper",
      stock: "manila",
    },
    [],
  ]);

  // doctest:L69
  await box.write("_content/recipes/Recipes.landmark.card", "---\nnavigation:\n  label: Recipes\nsystem-theme:\n  name: plain\n  stock: neutral\n---\n");
  const landmarkTheme = await caller(box.root).presentation.get({ boxKey: "test", contextDir: "_content/recipes/dinner" });
  t.check([landmarkTheme.chrome, landmarkTheme.systemTheme.landmark], [
    {
      choice: {
        name: "plain",
        stock: "neutral",
      },
      origin: "landmark",
      problem: null,
    },
    {
      path: "_content/recipes/Recipes.landmark.card",
      dir: "_content/recipes",
      label: "Recipes",
      explicitTheme: {
        name: "plain",
        stock: "neutral",
      },
      hasOverride: true,
    },
  ]);

  // doctest:L74
  const inheritedTheme = await caller(box.root).presentation.get({ boxKey: "test", contextDir: "_content/elsewhere" });
  t.check([inheritedTheme.chrome.choice, inheritedTheme.systemTheme.landmark], [
    {
      name: "paper",
      stock: "manila",
    },
    null,
  ]);

  // doctest:L78
  await box.write("_content/recipes/Recipes.landmark.card", "---\nnavigation:\n  label: Recipes\nsystem-theme:\n  name: post-it\n---\n");
  const invalidLandmarkTheme = await caller(box.root).presentation.get({ boxKey: "invalid-landmark", contextDir: "_content/recipes" });
  t.check([invalidLandmarkTheme.chrome.origin, invalidLandmarkTheme.chrome.choice, invalidLandmarkTheme.chrome.problem?.message.includes("does not provide app chrome")], [
    "landmark",
    {
      name: "plain",
      stock: "neutral",
    },
    true,
  ]);

  // doctest:L83
  t.check([invalidLandmarkTheme.systemTheme.boxHasOverride, invalidLandmarkTheme.systemTheme.landmark?.hasOverride, invalidLandmarkTheme.systemTheme.landmark?.explicitTheme], [
    true,
    true,
    null,
  ]);

  // A structurally valid box file with an invalid presentation subtree leaves the
  // unrelated settings readable while the route reports presentation failure.
  //
  // Theme names and stocks are an open set now (any box may author its own), so
  // an unrecognized stock like `purple` is no longer a validation failure — only a
  // malformed shape (a `name` that isn't a string) still counts as invalid.

  // doctest:L95
  await fs.writeFile(configPath, JSON.stringify({
    timezone: "America/Chicago",
    presentation: { default: { name: 42 } },
  }));
  clearBoxConfigCache(box.root);
  const invalidPresentation = await caller(box.root).presentation.get({ boxKey: "test-v2" });
  t.check(
    [
      (await loadBoxConfig(box.root)).timezone,
      invalidPresentation.presentation.status,
      invalidPresentation.configProblems[0]?.includes("expected string"),
      invalidPresentation.chrome.choice,
    ],
    [
    "America/Chicago",
    "invalid",
    true,
    {
      name: "plain",
      stock: "neutral",
    },
  ],
  );
});

// ## Built-in themes save through the same backend validator as the picker
//
// A system theme offered by the frontend must also pass the backend mutation's
// chrome validation. Saving Deck without a stock persists the panels default;
// clearing it restores the engine theme.
void test("A system theme offered by the frontend must also pass the backend mutation's...", async (t) => {
  t.teardown(async () => {
    try {
      await deckBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L121
  const deckBox = await makeTmpBox({ git: true });
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "deck" } });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "deck-saved" })).chrome, {
    choice: {
      name: "deck",
      stock: "panels",
    },
    origin: "box-chrome",
    problem: null,
  });

  // doctest:L127
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "night-atlas" } });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "night-atlas-saved" })).chrome, {
    choice: {
      name: "night-atlas",
      stock: "lights",
    },
    origin: "box-chrome",
    problem: null,
  });

  // doctest:L132
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "rose-trellis" } });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "rose-trellis-saved" })).chrome, {
    choice: {
      name: "rose-trellis",
      stock: "textile",
    },
    origin: "box-chrome",
    problem: null,
  });

  // doctest:L137
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "gold-thread" } });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "gold-thread-saved" })).chrome, {
    choice: {
      name: "gold-thread",
      stock: "textile",
    },
    origin: "box-chrome",
    problem: null,
  });

  // doctest:L142
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "goldfish" } });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "goldfish-saved" })).chrome, {
    choice: {
      name: "goldfish",
      stock: "water",
    },
    origin: "box-chrome",
    problem: null,
  });

  // doctest:L147
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "doodlebit" } });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "doodlebit-saved" })).chrome, {
    choice: {
      name: "doodlebit",
      stock: "ink",
    },
    origin: "box-chrome",
    problem: null,
  });

  // doctest:L152
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "phosphor" } });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "phosphor-saved" })).chrome, {
    choice: {
      name: "phosphor",
      stock: "terminal",
    },
    origin: "box-chrome",
    problem: null,
  });

  // doctest:L157
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "overprint" } });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "overprint-saved" })).chrome, {
    choice: {
      name: "overprint",
      stock: "plate",
    },
    origin: "box-chrome",
    problem: null,
  });

  // doctest:L162
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "posy" } });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "posy-saved" })).chrome, {
    choice: {
      name: "posy",
      stock: "paisley",
    },
    origin: "box-chrome",
    problem: null,
  });

  // doctest:L167
  await caller(deckBox.root).presentation.setSystemTheme({ scope: "box", theme: null });
  clearBoxConfigCache(deckBox.root);
  t.check((await caller(deckBox.root).presentation.get({ boxKey: "deck-reset" })).chrome, {
    choice: {
      name: "plain",
      stock: "neutral",
    },
    origin: "engine",
    problem: null,
  });
});

// ## A swatch choice writes only the theme field
//
// Anyone signed in to the box may set themes; only an anonymous caller is
// refused. The picker validates catalog membership before
// touching the file, then preserves unrelated and currently unknown frontmatter,
// comments, and the body. Clearing the choice restores inheritance.
void test("Anyone signed in to the box may set themes; only an anonymous caller is refused.", async (t) => {
  t.teardown(async () => {
    try {
      await cardBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L185
  const cardBox = await makeTmpBox({ git: true });
  const cardPath = "_content/notes/Keep.doc.card";
  await cardBox.write(cardPath, "---\n# keep this comment\ntitle: Keep\nfuture-field: still here\n---\nBody stays here.\n");
  const landmarkPath = "_content/notes/Notes.landmark.card";
  await cardBox.write(landmarkPath, "---\n# landmark comment\nnavigation:\n  label: Notes\nfuture-field: retained\n---\n");

  // doctest:L191
  await caller(cardBox.root).presentation.setSystemTheme({ scope: "box", theme: { name: "paper", stock: "manila" } });
  clearBoxConfigCache(cardBox.root);
  t.check((await caller(cardBox.root).presentation.get({ boxKey: "box-theme" })).chrome.choice, {
    name: "paper",
    stock: "manila",
  });

  // doctest:L196
  await caller(cardBox.root).presentation.setSystemTheme({ scope: "landmark", path: landmarkPath, theme: { name: "plain" } });
  const landmarkAfterSet = await cardBox.read(landmarkPath);
  t.check(
    [
      landmarkAfterSet.includes("# landmark comment"),
      landmarkAfterSet.includes("future-field: retained"),
      (await caller(cardBox.root).presentation.get({ boxKey: "landmark-theme", contextDir: "_content/notes" })).chrome.origin,
    ],
    [
    true,
    true,
    "landmark",
  ],
  );

  // doctest:L205
  t.check(
    await caller(cardBox.root).presentation.setSystemTheme({ scope: "landmark", path: landmarkPath, theme: { name: "post-it" } })
      .then(() => "accepted", (error) => error.code),
    "BAD_REQUEST",
  );

  // doctest:L209
  t.check(
    await caller(cardBox.root, { authed: false }).presentation.setSystemTheme({ scope: "box", theme: null })
      .then(() => "accepted", (error) => error.code),
    "UNAUTHORIZED",
  );

  // doctest:L213
  await caller(cardBox.root).presentation.setSystemTheme({ scope: "landmark", path: landmarkPath, theme: null });
  clearBoxConfigCache(cardBox.root);
  t.check((await caller(cardBox.root).presentation.get({ boxKey: "landmark-inherits", contextDir: "_content/notes" })).chrome.origin, "box-chrome");

  // doctest:L218
  await caller(cardBox.root).presentation.setSystemTheme({ scope: "box", theme: null });
  clearBoxConfigCache(cardBox.root);
  t.check((await caller(cardBox.root).presentation.get({ boxKey: "box-cleared" })).chrome, {
    choice: {
      name: "plain",
      stock: "neutral",
    },
    origin: "engine",
    problem: null,
  });

  // doctest:L223
  const set = await caller(cardBox.root).card.setTheme({
    path: cardPath,
    theme: { name: "paper", stock: "blue" },
  });
  const afterSet = await cardBox.read(cardPath);
  t.check(
    [
      set.theme,
      typeof set.commit === "string",
      afterSet.includes("# keep this comment"),
      afterSet.includes("future-field: still here"),
      afterSet.includes("name: paper"),
      afterSet.endsWith("Body stays here.\n"),
    ],
    [
    {
      name: "paper",
      stock: "blue",
    },
    true,
    true,
    true,
    true,
    true,
  ],
  );

  // An unrecognized stock is a box-authored choice, not an error — it is accepted
  // and written as given.

  // doctest:L243
  t.check(
    await caller(cardBox.root).card.setTheme({
      path: cardPath,
      theme: { name: "paper", stock: "purple" },
    }).then(() => "accepted", (error) => error.code),
    "accepted",
  );

  // doctest:L249
  await t.checkText((await cardBox.read(cardPath)).includes("stock: purple"), "true");

  // doctest:L254
  await caller(cardBox.root).card.setTheme({ path: cardPath, theme: null });
  const afterClear = await cardBox.read(cardPath);
  t.check(
    [
      afterClear.includes("theme:"),
      afterClear.includes("future-field: still here"),
      afterClear.endsWith("Body stays here.\n"),
    ],
    [
    false,
    true,
    true,
  ],
  );

  // doctest:L265
  t.check(
    await caller(cardBox.root, { authed: false }).card.setTheme({
      path: cardPath,
      theme: { name: "post-it" },
    }).then(() => "accepted", (error) => error.code),
    "UNAUTHORIZED",
  );

  // If Git rejects the focused commit after the atomic write, the mutation reports
  // the partial success and the saved theme remains visible to the caller's normal
  // file-change refresh.

  // doctest:L277
  const hooksPath = path.join(cardBox.root, ".git", "rejecting-hooks");
  await fs.mkdir(hooksPath, { recursive: true });
  await fs.writeFile(path.join(hooksPath, "pre-commit"), "#!/bin/sh\nexit 1\n");
  await fs.chmod(path.join(hooksPath, "pre-commit"), 0o755);
  execFileSync("git", ["config", "core.hooksPath", hooksPath], { cwd: cardBox.root });
  const partial = await caller(cardBox.root).card.setTheme({
    path: cardPath,
    theme: { name: "post-it", stock: "rose" },
  });
  t.check(
    [
      partial.commit,
      partial.commitWarning,
      (await cardBox.read(cardPath)).includes("name: post-it"),
    ],
    [
    null,
    "Saved, but the Git commit failed.",
    true,
  ],
  );
});
