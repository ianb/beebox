// # Landmark feature seeds
//
// Landmarks can declare default chat-feature values via a `navigation.chat-app`
// mapping. When a chat is started from a landmark, those defaults seed the
// session's features; the user can still toggle afterward.
//
// See `src/core/landmark/features.ts` for the readers and
// `docs/plans/narration-mode.md` for the design.

import { test } from "tap";
import "agent-doctest/tap";
import {
  readLandmarkFeatures,
  readLandmarkFeaturesForDir,
  seedFeaturesForNewChat,
} from "../../../src/core/landmark/features.js";
import type { LandmarkNavigationData } from "../../../src/schemas/landmark.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

// ## readLandmarkFeatures — read from a navigation role
void test("readLandmarkFeatures — read from a navigation role", async (t) => {
  // doctest:L23
  const navigation = { label: "Daily dump", "chat-app": { narration: "on", prose: "off" } } as const;
  t.check(readLandmarkFeatures(navigation), {
    narration: "on",
    prose: "off",
  });
});

// A navigation without a `chat-app` mapping returns an empty map.
void test("A navigation without a chat-app mapping returns an empty map.", async (t) => {
  // doctest:L31
  t.check(readLandmarkFeatures({ label: "Plain" }), {});
});

// Unknown features and invalid values are dropped silently (defense in
// depth — the schema rejects them at parse time, but hand-edited cards
// might bypass validation).
void test("Unknown features and invalid values are dropped silently (defense in depth —...", async (t) => {
  // doctest:L40
  // Hand-edited card values that bypass schema validation, so they cannot satisfy the parsed type.
  const navigation: LandmarkNavigationData = JSON.parse(
    '{"label":"x","chat-app":{"narration":"on","bogus":"yes","prose":"maybe"}}',
  );
  t.check(readLandmarkFeatures(navigation), {
    narration: "on",
  });
});

// ## readLandmarkFeaturesForDir — find the landmark in a directory
void test("readLandmarkFeaturesForDir — find the landmark in a directory", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L50
  const box = await makeTmpBox();
  await box.write(
    "_content/store/dump/Daily.landmark.card",
    "---\nsymbol:\n  glyph: 🎙️\nnavigation:\n  label: Daily dump\n  chat-app:\n    narration: on\n---\n",
  );
  t.check(await readLandmarkFeaturesForDir(box.root, "_content/store/dump"), {
    narration: "on",
  });
});

// ## Complete new-chat inheritance
//
// The shared resolver applies root-landmark values, then explicit chat values.
// Root landmarks use the empty context directory rather than being silently
// skipped by one creation path. A retired `hq-dictation` key on an older card
// (every dictated message gets the HQ pass now, docs/plans/hq-always.md) and a
// stale `hqDictation` in `box.json` are ignored.
void test("The shared resolver applies root-landmark values, then explicit chat values.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L72
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ hqDictation: "on" }));
  await box.write(
    "_content/Home.landmark.card",
    "---\nnavigation:\n  label: Home\n  chat-app:\n    narration: on\n    hq-dictation: off\n---\n",
  );
  t.check(await seedFeaturesForNewChat({ boxRoot: box.root, contextDir: null }), {});

  // doctest:L81
  t.check(await seedFeaturesForNewChat({ boxRoot: box.root, contextDir: "" }), {
    narration: "on",
  });

  // doctest:L84
  t.check(
    await seedFeaturesForNewChat({
      boxRoot: box.root,
      contextDir: "",
      request: { narration: "off", "hq-dictation": "on" },
    }),
    {
    narration: "off",
  },
  );
});

// A directory with no landmark card returns null.
void test("A directory with no landmark card returns null.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L99
  const box = await makeTmpBox();
  await box.write("_content/store/empty/Notes.md", "no landmark here\n");
  t.check(await readLandmarkFeaturesForDir(box.root, "_content/store/empty"), null);
});

// A landmark without `chat-app` returns null too — empty seeds and no
// landmark look the same to callers.
void test("A landmark without chat-app returns null too — empty seeds and no landmark lo...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L113
  const box = await makeTmpBox();
  await box.write(
    "_content/store/plain/Plain.landmark.card",
    "---\nsymbol:\n  glyph: 📁\nnavigation:\n  label: Plain\n---\n",
  );
  t.check(await readLandmarkFeaturesForDir(box.root, "_content/store/plain"), null);
});

// A `contextDir` that would resolve outside the box fails closed: same `null`
// as a missing directory, not a read of whatever the path escapes to. This is
// the box-containment floor for a value that arrives from the tRPC layer
// already string-shape-checked (`boxRelativePathSchema` in
// `core/landmark/nearest.ts`) — this check is the defense-in-depth layer for
// any other caller.
void test("A contextDir that would resolve outside the box fails closed:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L134
  const box = await makeTmpBox();
  await box.write(
    "../outside-marker.landmark.card",
    "---\nnavigation:\n  label: Outside\n  chat-app:\n    narration: on\n---\n",
  );
  t.check(await readLandmarkFeaturesForDir(box.root, "../"), null);
});
