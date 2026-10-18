// # `status.browse` — the listing carries prominence
//
// Track C of `docs/implemented-plans/card-prominence.md`: `status.browse` adds each
// card's effective `prominence`, each subdirectory's pruned-subtree
// `DirectorySummary` (plus its own landmark identity when it has one), and
// the listed directory's own `background` cascade. No doctest previously
// exercised `status.browse`'s general listing shape (only the namespace-fence
// suite in `box-namespace-fence-traversal.doctest.md` calls it, for security);
// this is that doctest.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { statusRouter } from "../../../../src/webapp/trpc/routers/status.js";

// `browse` reads only boxRoot; the rest is the minimum a TrpcContext requires.
function ctxFor(boxRoot: string): TrpcContext {
  return trpcContext({ boxRoot, boxSlug: "t" });
}

// ## A card's own declared level, and a card's type default
//
// An `entry-point`/`primary`/`background`-declared card reports that level; an
// undeclared card falls back to its type's default — `ordinary` for a doc,
// `background` for a landmark (its type default, per Track A) and for a chat
// husk (`docs/implemented-plans/place-shows-cards.md`, Track A), so Browse folds it into
// "more" when the folder has a primary card.
void test("An entry-point/primary/background-declared card reports that level; an undecl...", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L32
  const server = await makeTestServer();
  await server.seed("_content/Entry.doc.card", "---\ntitle: Entry\nprominence: entry-point\n---\n");
  await server.seed("_content/Primary.doc.card", "---\ntitle: Primary\nprominence: primary\n---\n");
  await server.seed("_content/Plain.doc.card", "---\ntitle: Plain\n---\n");
  await server.seed("_content/Log.contains-backfill-job.card", "---\ndescription: test\nitems: []\n---\n");
  await server.seed("_content/Box.landmark.card", "---\nnavigation:\n  label: Box\n---\n");
  await server.seed("_content/Hello.chat.card", "---\nsession: s1\n---\n");

  // doctest:L40
  const listing = await statusRouter.createCaller(ctxFor(server.boxRoot)).browse({ path: "_content" });
  t.check(
    listing.cards
      .map((c) => `${c.name}:${c.prominence}`)
      .toSorted()
      .join(" "),
    "Box:background Entry:entry-point Hello:background Log:background Plain:ordinary Primary:primary",
  );

  // The listed directory itself is not background — nothing here cascaded it.

  // doctest:L51
  t.check(listing.background, false);
});

// ## A subdirectory's `DirectorySummary` and own landmark identity
//
// A subdirectory holding a primary card reports it in its `summary`; one with
// its own landmark card carries that landmark's label/symbol; a plain
// subdirectory summarizes to nothing prominent.
void test("A subdirectory holding a primary card reports it in its summary; one with its...", async (t) => {
  t.teardown(async () => {
    try {
      await server2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L66
  const server2 = await makeTestServer();
  // "Cookbook", not "recipes": the default test box already scaffolds
  // `_content/recipes/`, and macOS's case-insensitive filesystem would
  // collide a same-named-but-cased directory into it.
  await server2.seed("_content/Cookbook/Cookbook.landmark.card", "---\nnavigation:\n  label: Cookbook\n---\n");
  await server2.seed("_content/Cookbook/Soup.doc.card", "---\ntitle: Soup\nprominence: primary\n---\n");
  await server2.seed("_content/Plain/Notes.doc.card", "---\ntitle: Notes\n---\n");

  // doctest:L74
  const listing2 = await statusRouter.createCaller(ctxFor(server2.boxRoot)).browse({ path: "_content" });
  const byName = new Map(listing2.dirs.map((d) => [d.name, d]));

  // doctest:L77
  t.check(byName.get("Cookbook")?.summary, {
    hasEntryPoint: false,
    primaryCount: 1,
    background: false,
  });

  // doctest:L80
  t.check(byName.get("Cookbook")?.landmark?.label, "Cookbook");

  // doctest:L83
  t.check(byName.get("Plain")?.summary, {
    hasEntryPoint: false,
    primaryCount: 0,
    background: false,
  });

  // doctest:L86
  t.check(byName.get("Plain")?.landmark, undefined);
});

// ## The listed directory's own `background` cascade
//
// A directory whose own landmark is written `background` reports
// `background: true` at the top level — the page folds everything into
// "more" regardless of any individual card's level (Track C's `foldListing`).
void test("A directory whose own landmark is written background reports background:", async (t) => {
  t.teardown(async () => {
    try {
      await server3.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L101
  const server3 = await makeTestServer();
  await server3.seed("_content/Housekeeping/Housekeeping.landmark.card", "---\nprominence: background\n---\n");
  await server3.seed("_content/Housekeeping/Notable.doc.card", "---\ntitle: Notable\nprominence: entry-point\n---\n");

  // doctest:L105
  const bgListing = await statusRouter.createCaller(ctxFor(server3.boxRoot)).browse({ path: "_content/Housekeeping" });
  t.check(bgListing.background, true);

  // doctest:L109
  t.check(bgListing.cards.find((c) => c.name === "Notable")?.prominence, "entry-point");
});

// ## A Drive conflict is the one card fact the entry carries
//
// A synced Doc marked `conflict: true` says so, for the Drive state column and
// the sidebar badge. Other frontmatter, such as a doc's `via`, is not
// copied into the entry.
void test("A synced Doc marked conflict:", async (t) => {
  t.teardown(async () => {
    try {
      await server4.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L124
  const server4 = await makeTestServer();
  await server4.seed("_content/Drive/Contended.gdoc.card", "---\ntitle: Contended\nconflict: true\n---\n");
  await server4.seed("_content/Drive/Settled.gdoc.card", "---\ntitle: Settled\n---\n");
  await server4.seed("_content/Drive/Note.doc.card", "---\ntitle: Note\nvia:\n  channel: email\n---\n");

  // doctest:L129
  const driveListing = await statusRouter.createCaller(ctxFor(server4.boxRoot)).browse({ path: "_content/Drive" });
  await t.checkText(JSON.stringify(driveListing.cards.map((c) => ({ name: c.name, conflict: c.conflict, via: "via" in c }))), "[{\"name\":\"Contended\",\"conflict\":true,\"via\":false},{\"name\":\"Note\",\"via\":false},{\"name\":\"Settled\",\"via\":false}]");
});
