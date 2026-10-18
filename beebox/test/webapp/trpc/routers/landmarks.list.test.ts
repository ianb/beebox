// # `landmarks.list`: broken landmark cards are reported, not skipped
//
// `landmarks.list` is the Landmarks page's reader — the merged activity surface
// (`docs/implemented-plans/top-nav-ia.md` Track D) renders one section per landmark from it.
// A `*.landmark.card` whose frontmatter doesn't parse used to vanish from that
// page without a trace; now it comes back in `problems`, the same shape
// `chat.byLandmark` reports, so the page can dedupe the two by path and show a
// single warning row.
//
// An unreadable file (an fs error) is a different failure: it warns on the server
// and appears in neither list, since there's nothing to say about a card we never
// read.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { mkdir, symlink } from "node:fs/promises";
import assert from "node:assert/strict";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

// ## The good landmarks load; the broken one is named
void test("The good landmarks load; the broken one is named", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L32
  const box = await makeTmpBox({ git: true });

  // doctest:L34
  await box.write("_content/recipes/Recipes.landmark.card",
    "---\nsymbol:\n  glyph: 🍳\nnavigation:\n  label: Recipes\n---\n\n");
  await box.write("_content/trips/Trips.landmark.card", "no frontmatter here at all\n");

  // doctest:L38
  const { landmarks, problems } = await caller(box.root).landmarks.list();
  print(`landmarks: ${landmarks.map((l) => `${l.label} (${l.dir})`).join(" | ")}`);
  await t.checkText(out.with(print(`problems: ${problems.map((p) => p.path).join(",")}`)), `landmarks: Recipes (_content/recipes)
problems: _content/trips/Trips.landmark.card`);

  // Fixing the card empties `problems` — the report tracks the file, it isn't
  // sticky.

  // doctest:L50
  await box.write("_content/trips/Trips.landmark.card",
    "---\nnavigation:\n  label: Trips\n---\n\n");

  // doctest:L53
  const fixed = await caller(box.root).landmarks.list();
  print(`landmarks: ${fixed.landmarks.map((l) => l.label).join(",")}`);
  await t.checkText(out.with(print(`problems: ${fixed.problems.length}`)), `landmarks: Recipes,Trips
problems: 0`);

  // A label-less card (e.g. a destinations-only triage landmark) falls back to
  // its filename basename — the label is never empty, so the app bar's pill
  // face always has something to render.

  // doctest:L66
  await box.write("_bookkeeping/archive/Old_Mail.landmark.card",
    "---\ndestinations:\n  - for: [triage]\n    rules: \"Old mail.\"\n---\n\n");

  // doctest:L69
  const withArchive = await caller(box.root).landmarks.list();
  await t.checkText(out.with(withArchive.landmarks.map((l) => l.label).join(",")), "Old_Mail,Recipes,Trips");
});

// ## A box with nothing broken reports an empty list
void test("A box with nothing broken reports an empty list", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L81
  const box = await makeTmpBox({ git: true });
  // The v3 root landmark lives at `_content/Box.landmark.card`, not at the
  // literal box root (`root-dir.ts`) — a card sitting directly at the box
  // root is outside every underscore area and, since the namespace fence
  // findings (round 4 hardening), correctly excluded from the scan.
  await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n\n");

  // doctest:L88
  const { landmarks, problems } = await caller(box.root).landmarks.list();
  t.check(`${landmarks.length} landmark(s), ${problems.length} problem(s)`, "1 landmark(s), 0 problem(s)");
});

// ## Nested landmarks: each payload is the same one `forDir` resolves
//
// `list` resolves every landmark in one request, several at once, and walks
// each place's folder tree only once: a nested place's tree serves both its own
// payload and its parent's row for it. Sharing that walk must not change any
// payload. Here Garden holds Herbs, and Shed sits beside Garden.
void test("list resolves every landmark in one request, several at once, and walks each...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L105
  const box = await makeTmpBox({ git: true });
  await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n");
  await box.write("_content/Welcome.doc.card", "---\ntitle: Welcome\nprominence: entry-point\n---\n");
  await box.write("_content/Garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");
  await box.write("_content/Garden/Start.doc.card", "---\ntitle: Start\nprominence: entry-point\n---\n");
  await box.write("_content/Garden/Beds.doc.card", "---\ntitle: Beds\nprominence: primary\n---\n");
  await box.write("_content/Garden/notes/Soil.doc.card", "---\ntitle: Soil\n---\n");
  await box.write("_content/Garden/Herbs/Herbs.landmark.card", "---\nnavigation:\n  label: Herbs\n---\n");
  await box.write("_content/Garden/Herbs/Basil.doc.card", "---\ntitle: Basil\nprominence: primary\n---\n");
  await box.write("_content/Garden/Herbs/Mint.doc.card", "---\ntitle: Mint\n---\n");
  await box.write("_content/Shed/Shed.landmark.card", "---\nnavigation:\n  label: Shed\n---\n");
  await box.write("_content/Shed/Tools.doc.card", "---\ntitle: Tools\n---\n");

  // doctest:L118
  const { landmarks } = await caller(box.root).landmarks.list();
  const view = (l: (typeof landmarks)[number] | undefined) => {
    assert.ok(l);
    return { label: l.label, depth: l.depth, arrival: l.arrival, links: l.links.map((k) => `${k.source} ${k.ref}`) };
  };

  // Home lists its one entry point, then a row per nested place. Garden's row
  // opens Garden's entry point, Start; Shed has no entry point, so its row opens
  // its landmark card. Herbs gets no row here: Garden's walk stops it. Home's
  // arrival is Welcome, its only entry point. Depth is 0 for top-level places
  // (the root does not count as a parent).

  // doctest:L132
  t.check(view(landmarks[0]), {
    label: "Home",
    depth: 0,
    arrival: "_content/Welcome.doc.card",
    links: [
      "derived _content/Welcome.doc.card",
      "place _content/Garden/Start.doc.card",
      "place _content/Shed/Shed.landmark.card",
    ],
  });

  // Garden lists its entry point, then its primary card, then Herbs. Herbs has no
  // entry point, so its row opens its landmark card. Soil is ordinary and is not
  // listed. Garden's own Start card is its arrival.

  // doctest:L141
  t.check(view(landmarks[1]), {
    label: "Garden",
    depth: 0,
    arrival: "_content/Garden/Start.doc.card",
    links: [
      "derived _content/Garden/Start.doc.card",
      "derived _content/Garden/Beds.doc.card",
      "place _content/Garden/Herbs/Herbs.landmark.card",
    ],
  });

  // Herbs is one level under Garden. It lists Basil, its primary card; Mint is
  // ordinary. With no entry point, arrival is the landmark card. Shed lists
  // nothing: its one card is ordinary.

  // doctest:L150
  t.check([view(landmarks[2]), view(landmarks[3])], [
    {
      label: "Herbs",
      depth: 1,
      arrival: "_content/Garden/Herbs/Herbs.landmark.card",
      links: [
        "derived _content/Garden/Herbs/Basil.doc.card",
      ],
    },
    {
      label: "Shed",
      depth: 0,
      arrival: "_content/Shed/Shed.landmark.card",
      links: [],
    },
  ]);

  // `forDir` resolves one landmark alone, with no shared walk. Each `list`
  // payload matches it in everything but depth, which only `list` computes.

  // doctest:L158
  const mismatched = [];
  for (const lm of landmarks) {
    const { landmark } = await caller(box.root).landmarks.forDir({ dir: lm.dir });
    if (JSON.stringify({ ...landmark, depth: lm.depth }) !== JSON.stringify(lm)) mismatched.push(lm.label);
  }
  t.check(mismatched, []);
});

// ## `forDir({ dir: "" })` finds the root landmark under `_content/`
//
// The one-root layout put the ROOT landmark card at `_content/Box.landmark.card`,
// not at the box's physical root — but `dir: ""` still means the box-root chat
// scope. `forDir` must resolve it there, not answer `null`/fall back to a
// placeholder.
void test("The one-root layout put the ROOT landmark card at content/Box.landmark.card,...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L179
  const box = await makeTmpBox({ git: true });
  await box.write("_content/Box.landmark.card", "---\nsymbol:\n  glyph: 🍳\nnavigation:\n  label: Kitchen\n---\n");

  // doctest:L182
  const { landmark } = await caller(box.root).landmarks.forDir({ dir: "" });
  t.check({ path: landmark?.path, dir: landmark?.dir, label: landmark?.label, symbol: landmark?.symbol }, {
    path: "_content/Box.landmark.card",
    dir: "",
    label: "Kitchen",
    symbol: {
      glyph: "🍳",
    },
  });
});

// ## `forDir` rejects a `dir` outside the box namespace
//
// Finding 3 (Track E hardening review, round 3): the input `refine` only
// rejected an escaping form (`..`/leading `/`) — a real, non-underscore
// directory like `src/templates` passed it and named a physical directory the
// landmark reader then read directly. Every landmark procedure taking `dir`
// resolves it through the box namespace fence and rejects a non-namespace `dir`
// with `BAD_REQUEST`.
void test("Finding 3 (Track E hardening review, round 3):", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L201
  const box = await makeTmpBox({ git: true });
  await mkdir(box.path("src/templates"), { recursive: true });
  await box.write("src/templates/Private.landmark.card", "---\nnavigation:\n  label: Private\n---\n");

  // doctest:L205
  async function throwsBadRequest(fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return false;
    } catch (e) {
      return (e instanceof TRPCError && e.code === "BAD_REQUEST") || `${e}`.includes("BAD_REQUEST");
    }
  }

  // doctest:L214
  t.check(await throwsBadRequest(() => caller(box.root).landmarks.forDir({ dir: "src/templates" })), true);
});

// ## A symlinked landmark card that escapes the box namespace is skipped, not read through
//
// Finding 2 (round 4 hardening): `_content/escape/A.landmark.card` is a symlink
// to `src/private.landmark.card` — outside every underscore area. It still
// matches the `**/*.landmark.card` glob `list`/`forDir` scan with, but its
// bytes belong to a file outside the namespace, so it must never be read
// through. A normal (non-symlinked) landmark elsewhere in the box still loads.
void test("Finding 2 (round 4 hardening):", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L231
  const box = await makeTmpBox({ git: true });
  await box.write("src/private.landmark.card", "---\nnavigation:\n  label: Private\n---\n");
  await box.write("_content/recipes/Recipes.landmark.card", "---\nnavigation:\n  label: Recipes\n---\n");
  await mkdir(box.path("_content/escape"), { recursive: true });
  await symlink(box.path("src/private.landmark.card"), box.path("_content/escape/A.landmark.card"));

  // doctest:L237
  const { landmarks, problems } = await caller(box.root).landmarks.list();
  t.check({ labels: landmarks.map((l) => l.label).toSorted(), problemCount: problems.length }, {
    labels: [
      "Recipes",
    ],
    problemCount: 0,
  });

  // `forDir` on the escaping symlink's directory answers `null` (same as any
  // other unreadable card — no landmark to render), while the normal landmark's
  // directory still resolves:

  // doctest:L247
  const { landmark: escaped } = await caller(box.root).landmarks.forDir({ dir: "_content/escape" });
  const { landmark: recipes } = await caller(box.root).landmarks.forDir({ dir: "_content/recipes" });
  t.check({ escaped, recipesLabel: recipes?.label }, {
    escaped: null,
    recipesLabel: "Recipes",
  });
});

// ## `forDir` still answers null for a broken card
//
// The here menu asks for one directory's landmark. A card that doesn't parse
// means there is no landmark to render — `forDir` has no `problems` channel and
// doesn't need one; the page-level surface is where the warning belongs.
void test("The here menu asks for one directory's landmark.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L264
  const box = await makeTmpBox({ git: true });
  await box.write("_content/trips/Trips.landmark.card", "not a card\n");

  // doctest:L267
  const { landmark } = await caller(box.root).landmarks.forDir({ dir: "_content/trips" });
  await t.checkText(`${landmark}`, "null");
});
