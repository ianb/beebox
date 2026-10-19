// # `chat.byLandmark`: every chat lands somewhere, and broken landmarks say so
//
// The picker groups chats by the landmark their session is bound to. Two things
// used to fall off that grouping silently: a chat bound to a directory with no
// landmark card (the box root before anyone made a root landmark, or a dir whose
// landmark was deleted) was dropped entirely, because the response mapped over
// landmark cards only; and a landmark card whose frontmatter didn't parse
// disappeared along with everything grouped under it.
//
// Now the landmark-less chats come back in a trailing `unassigned` bucket, and the
// unparseable cards come back in `problems`.
//
// Each bucket also carries `freshCount` and `latestActivity`. Those aren't
// derivable from the rendered lists: a non-root landmark shows only its latest
// fresh chat inline and folds the rest into `olderSessions`, so counting
// `sessions` undercounts the bucket. The capping itself is unchanged — the picker
// depends on it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import assert from "node:assert/strict";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { localOrigin } from "../../../../src/core/chat/session/origin.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

/** The ids and bindings of a bucket's session rows. */
function rows(sessions: { sessionId: string; contextDir: string }[]) {
  return sessions.map((s) => ({ sessionId: s.sessionId, contextDir: s.contextDir }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Freshness is the transcript's mtime, so a fixture has to set it: `daysAgo`
// puts a session inside or outside the 7-day fresh window on purpose.
async function seedSession(
  box: TmpBox,
  args: { sessionId: string; contextDir: string; firstMessage: string; daysAgo: number },
) {
  const { sessionId, contextDir, firstMessage, daysAgo } = args;
  const cwd = contextDir === "" ? box.root : box.path(contextDir);
  const logPath = getSessionLogPath(cwd, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  const entry = {
    type: "user",
    uuid: `u-${sessionId}`,
    timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: firstMessage }] },
  };
  await writeFile(logPath, JSON.stringify(entry) + "\n");
  const when = new Date(Date.now() - daysAgo * DAY_MS);
  await utimes(logPath, when, when);
  const binding = contextDir === "" ? "" : `context-dir: ${contextDir}\n`;
  await box.write(
    `_content/chat/web/2026-07-28_${sessionId}.chat.card`,
    `---\nsession: ${sessionId}\n${binding}---\n\n`,
  );
}

// ## Chats with no landmark land in `unassigned`, carrying where they live
//
// The box has one landmark (`_content/recipes`) and no root landmark, so both the
// root chat and the chat bound to a landmark-less directory are unassigned. Each
// unassigned row says which directory it belongs to — the bucket spans
// directories, so the binding can't live on the bucket.
void test("The box has one landmark (content/recipes) and no root landmark, so both the...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L72
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L75
  await box.write("_content/recipes/Recipes.landmark.card",
    "---\nsymbol:\n  glyph: 🍳\nnavigation:\n  label: Recipes\n---\n\n");

  // doctest:L78
  await seedSession(box, { sessionId: "inrecipe1", contextDir: "_content/recipes", firstMessage: "what can I make with lentils", daysAgo: 1 });
  await seedSession(box, { sessionId: "rootchat1", contextDir: "", firstMessage: "how's my week looking", daysAgo: 2 });
  await seedSession(box, { sessionId: "orphaned1", contextDir: "_content/orphan", firstMessage: "leftover thread", daysAgo: 3 });

  // doctest:L82
  const { landmarks, unassigned } = await caller(box.root).chat.byLandmark();
  t.check(
    { landmarks: landmarks.map((l) => ({ label: l.label, sessions: l.sessions.map((s) => s.sessionId) })), unassigned: rows(unassigned.sessions) },
    {
      landmarks: [{ label: "Recipes", sessions: ["inrecipe1"] }],
      unassigned: [
        { sessionId: "rootchat1", contextDir: "" },
        { sessionId: "orphaned1", contextDir: "_content/orphan" },
      ],
    },
  );

  // A root landmark card takes the root chats back — `unassigned` is what's left
  // over, not a second home for the root.

  // doctest:L94
  await box.write("Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n\n");

  // doctest:L96
  const withRoot = await caller(box.root).chat.byLandmark();
  t.check(
    { rootTile: withRoot.landmarks.find((l) => l.dir === "")?.sessions.map((s) => s.sessionId), unassigned: rows(withRoot.unassigned.sessions) },
    { rootTile: ["rootchat1"], unassigned: [{ sessionId: "orphaned1", contextDir: "_content/orphan" }] },
  );
});

// ## `freshCount` and `latestActivity` describe the bucket, not the visible rows
//
// Three fresh chats under one non-root landmark still render as one inline row
// plus two in `olderSessions` (unchanged), and a fourth chat outside the fresh
// window joins them there. `freshCount` says three anyway, and `latestActivity` is
// the newest session's mtime whether or not it's fresh.
void test("Three fresh chats under one non-root landmark still render as one inline row...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L116
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L119
  await box.write("_content/recipes/Recipes.landmark.card",
    "---\nnavigation:\n  label: Recipes\n---\n\n");

  // doctest:L122
  await seedSession(box, { sessionId: "fresh001", contextDir: "_content/recipes", firstMessage: "newest", daysAgo: 1 });
  await seedSession(box, { sessionId: "fresh002", contextDir: "_content/recipes", firstMessage: "middle", daysAgo: 2 });
  await seedSession(box, { sessionId: "fresh003", contextDir: "_content/recipes", firstMessage: "oldest fresh", daysAgo: 3 });
  await seedSession(box, { sessionId: "stale001", contextDir: "_content/recipes", firstMessage: "long ago", daysAgo: 30 });

  // doctest:L127
  const recipes = (await caller(box.root).chat.byLandmark()).landmarks.find((l) => l.dir === "_content/recipes");
  assert.ok(recipes);
  const newest = recipes.sessions[0];
  assert.ok(newest);
  t.check(
    {
      visible: recipes.sessions.map((s) => s.sessionId),
      older: recipes.olderSessions.map((s) => s.sessionId),
      freshCount: recipes.freshCount,
      latestActivity: recipes.latestActivity,
    },
    {
      visible: ["fresh001"],
      older: ["fresh002", "fresh003", "stale001"],
      freshCount: 3,
      // The newest session's activity time.
      latestActivity: newest.lastActivity,
    },
  );

  // An empty bucket reports zero and null rather than inventing an activity time.

  // doctest:L143
  await box.write("_content/trips/Trips.landmark.card",
    "---\nnavigation:\n  label: Trips\n---\n\n");

  // doctest:L146
  const trips = (await caller(box.root).chat.byLandmark()).landmarks.find((l) => l.dir === "_content/trips");
  assert.ok(trips);
  t.check({ freshCount: trips.freshCount, latestActivity: trips.latestActivity }, { freshCount: 0, latestActivity: null });
});

// ## Ordering follows `latestActivity`, not just the visible rows
//
// A landmark whose only chats fell out of the fresh window renders no inline
// rows, but it isn't a landmark nobody has used — it sorts by when it was last
// used, ahead of landmarks with no chats at all. (Sorting on the visible rows
// sank it among the never-used ones, which is what the Landmarks page shows.)
void test("A landmark whose only chats fell out of the fresh window renders no inline ro...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L164
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L167
  await box.write("_content/fresh/Fresh.landmark.card", "---\nnavigation:\n  label: Fresh\n---\n\n");
  await box.write("_content/stale/Stale.landmark.card", "---\nnavigation:\n  label: Stale\n---\n\n");
  await box.write("_content/never/Never.landmark.card", "---\nnavigation:\n  label: Never\n---\n\n");

  // doctest:L171
  await seedSession(box, { sessionId: "freshone", contextDir: "_content/fresh", firstMessage: "today", daysAgo: 1 });
  await seedSession(box, { sessionId: "staleone", contextDir: "_content/stale", firstMessage: "a while back", daysAgo: 30 });

  // doctest:L174
  const ordered = await caller(box.root).chat.byLandmark();
  t.check(ordered.landmarks.map((l) => l.label), ["Fresh", "Stale", "Never"]);
});

// ## A landmark card that doesn't parse is reported, not swallowed
//
// The good landmarks still load. The broken one rides along in `problems` so the
// UI can show a warning row — once a landmark is the only way to reach its chats,
// a hand-edit that breaks the frontmatter must not make them vanish silently.
void test("The good landmarks still load.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L190
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L193
  await box.write("_content/recipes/Recipes.landmark.card",
    "---\nnavigation:\n  label: Recipes\n---\n\n");
  await box.write("_content/trips/Trips.landmark.card", "no frontmatter here at all\n");

  // doctest:L197
  await seedSession(box, { sessionId: "intrips01", contextDir: "_content/trips", firstMessage: "where to in august", daysAgo: 1 });

  // doctest:L199
  const broken = await caller(box.root).chat.byLandmark();
  t.check(
    {
      landmarks: broken.landmarks.map((l) => l.label),
      problems: broken.problems.map((p) => p.path),
      itsChats: rows(broken.unassigned.sessions),
    },
    {
      landmarks: ["Recipes"],
      problems: ["_content/trips/Trips.landmark.card"],
      itsChats: [{ sessionId: "intrips01", contextDir: "_content/trips" }],
    },
  );
});

// ## Dead chats ride in their own bucket, under the landmark they were bound to
//
// A chat whose transcript is gone can't be resumed, so it can't be a `sessions`
// row — every one of those links into `/chat?session=`. It comes back in `dead`
// instead, carrying the husk path the UI links to and the state that names its
// section ("Expired", "On prod", "Unavailable").
void test("A chat whose transcript is gone can't be resumed, so it can't be a sessions r...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L221
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
  const here = await localOrigin();

  // doctest:L225
  await box.write("_content/recipes/Recipes.landmark.card",
    "---\nnavigation:\n  label: Recipes\n---\n\n");
  await seedSession(box, { sessionId: "livechat1", contextDir: "_content/recipes", firstMessage: "what's for dinner", daysAgo: 1 });
  await box.write("_content/chat/web/2026-07-20_gone.chat.card",
    `---\nsession: goneaway1\ntitle: Sourdough attempt\ncontext-dir: _content/recipes\norigin: ${here.id}\norigin-name: ${here.name}\n---\n\n`);
  await box.write("_content/chat/web/2026-07-19_prod.chat.card",
    "---\nsession: elsewhere1\ncontext-dir: _content/recipes\norigin: prod-machine-id\norigin-name: prod\n---\n\n");

  // doctest:L233
  const picked = await caller(box.root).chat.byLandmark();
  const recipes = picked.landmarks.find((l) => l.label === "Recipes");
  assert.ok(recipes);
  t.check(
    {
      live: recipes.sessions.map((s) => s.sessionId),
      dead: recipes.dead.map((d) => ({ label: d.label, state: d.transcript.state, huskPath: d.huskPath })),
    },
    {
      live: ["livechat1"],
      dead: [
        { label: "Sourdough attempt", state: "expired", huskPath: "_content/chat/web/2026-07-20_gone.chat.card" },
        { label: "elsewher", state: "elsewhere", huskPath: "_content/chat/web/2026-07-19_prod.chat.card" },
      ],
    },
  );
});
