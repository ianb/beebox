// # one-root migration: the v2 -> v3 path-mapping table
//
// `mapV2Path` (`src/core/migrations/one-root-mapping.ts`) maps a v2
// `content/`-relative path to its v3 root-relative destination. It is
// exhaustive over the frozen v2 `BOX_LAYOUT` areas (`assertNever`-terminated
// internally) — an unrecognized top-level name or subdirectory comes back
// `{ kind: "unmapped" }` rather than a guess, so the migration script aborts on
// it instead of silently dropping data.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mapV2Path, v2ContentPathsFor } from "../../../src/core/migrations/one-root-mapping.js";

// ## Every v2 area maps to its documented v3 destination
void test("Every v2 area maps to its documented v3 destination", async (t) => {
  // doctest:L17
  t.check(mapV2Path("box/inbox/Foo.doc.card"), {
    kind: "move",
    newPath: "_content/inbox/Foo.doc.card",
  });

  // doctest:L20
  t.check(mapV2Path("box/inbox/triaged/_unsure/Bar.doc.card"), {
    kind: "move",
    newPath: "_content/inbox/triaged/_unsure/Bar.doc.card",
  });

  // doctest:L23
  t.check(mapV2Path("box/jobs/2026.job.card"), {
    kind: "move",
    newPath: "_bookkeeping/jobs/2026.job.card",
  });

  // doctest:L26
  t.check(mapV2Path("box/output/reply.card"), {
    kind: "move",
    newPath: "_bookkeeping/output/reply.card",
  });

  // doctest:L29
  t.check(mapV2Path("box/questions/q1.question.card"), {
    kind: "move",
    newPath: "_bookkeeping/questions/q1.question.card",
  });

  // doctest:L32
  t.check(mapV2Path("box/resources/state.json"), {
    kind: "move",
    newPath: "_bookkeeping/resources/state.json",
  });

  // doctest:L35
  t.check(mapV2Path("box/publish/p1/manifest.json"), {
    kind: "move",
    newPath: "_publish/p1/manifest.json",
  });

  // doctest:L38
  t.check(mapV2Path("store/archive/done/x.card"), {
    kind: "move",
    newPath: "_bookkeeping/archive/done/x.card",
  });

  // doctest:L41
  t.check(mapV2Path("store/trash/x.card"), {
    kind: "move",
    newPath: "_bookkeeping/trash/x.card",
  });

  // doctest:L44
  t.check(mapV2Path("store/usage/session-manifest.jsonl"), {
    kind: "move",
    newPath: "_bookkeeping/usage/session-manifest.jsonl",
  });

  // doctest:L47
  t.check(mapV2Path("store/recipes/Soup.recipe.card"), {
    kind: "move",
    newPath: "_content/recipes/Soup.recipe.card",
  });

  // doctest:L50
  t.check(mapV2Path("store/todos/Groceries.todo.card"), {
    kind: "move",
    newPath: "_content/todos/Groceries.todo.card",
  });

  // doctest:L53
  t.check(mapV2Path("store/drive/x.gsheet.card"), {
    kind: "move",
    newPath: "_content/drive/x.gsheet.card",
  });

  // doctest:L56
  t.check(mapV2Path("store/calendar/x.ics"), {
    kind: "move",
    newPath: "_content/calendar/x.ics",
  });

  // doctest:L59
  t.check(mapV2Path("store/chat/web/sess1/Thread.chat-thread.card"), {
    kind: "move",
    newPath: "_content/chat/web/sess1/Thread.chat-thread.card",
  });

  // doctest:L62
  t.check(mapV2Path("store/reviews/retro/2026-01-01.md"), {
    kind: "move",
    newPath: "_content/reviews/retro/2026-01-01.md",
  });

  // doctest:L65
  t.check(mapV2Path("people/Dana_Lee.person.card"), {
    kind: "move",
    newPath: "_content/people/Dana_Lee.person.card",
  });

  // doctest:L68
  t.check(mapV2Path("places/Home.place.card"), {
    kind: "move",
    newPath: "_content/places/Home.place.card",
  });

  // doctest:L71
  t.check(mapV2Path("docs/some-stray-doc.md"), {
    kind: "move",
    newPath: "_content/docs/some-stray-doc.md",
  });

  // doctest:L74
  t.check(mapV2Path("tmp/scratch.txt"), {
    kind: "move",
    newPath: "_tmp/scratch.txt",
  });

  // doctest:L77
  t.check(mapV2Path("config/procedures/foo.procedure.card"), {
    kind: "move",
    newPath: "_config/procedures/foo.procedure.card",
  });

  // doctest:L80
  t.check(mapV2Path("config/schedules/tick.scheduled-script.card"), {
    kind: "move",
    newPath: "_config/schedules/tick.scheduled-script.card",
  });

  // doctest:L83
  t.check(mapV2Path("config/schemas/local.ts"), {
    kind: "move",
    newPath: "_config/schemas/local.ts",
  });

  // doctest:L86
  t.check(mapV2Path("tricks/scripts/helper.ts"), {
    kind: "move",
    newPath: "src/tricks/scripts/helper.ts",
  });

  // doctest:L89
  t.check(mapV2Path("tricks/lib/util.ts"), {
    kind: "move",
    newPath: "src/tricks/lib/util.ts",
  });

  // doctest:L92
  t.check(mapV2Path(".claude/rules/foo.md"), {
    kind: "move",
    newPath: ".claude/rules/foo.md",
  });
});

// ## Root files move into `_content/`; `CLAUDE.md` merges instead
void test("Root files move into `_content/`; `CLAUDE.md` merges instead", async (t) => {
  // doctest:L99
  t.check(mapV2Path("briefing.briefing.card"), {
    kind: "move",
    newPath: "_content/briefing.briefing.card",
  });

  // doctest:L102
  t.check(mapV2Path("briefing.md"), {
    kind: "move",
    newPath: "_content/briefing.md",
  });

  // doctest:L105
  t.check(mapV2Path("Box.landmark.card"), {
    kind: "move",
    newPath: "_content/Box.landmark.card",
  });

  // doctest:L108
  t.check(mapV2Path("MAP.md"), {
    kind: "move",
    newPath: "_content/MAP.md",
  });

  // doctest:L111
  t.check(mapV2Path("CLAUDE.md"), {
    kind: "merge-claude-md",
  });
});

// ## A root card's `<name>.attach/` sibling scope carries along to the same v3 destination
//
// Finding 10 (round 3 hardening): `Box.landmark.card` maps to
// `_content/Box.landmark.card`, but its sibling attach directory
// `Box.attach/` had no case at all before this fix — the migration aborted
// preflight on it. Derived from `V2_ROOT_FILE_TARGETS` (every mapped root
// CARD), not hand-enumerated a second time.
void test("Finding 10 (round 3 hardening):", async (t) => {
  // doctest:L124
  t.check(mapV2Path("Box.attach/photo.png"), {
    kind: "move",
    newPath: "_content/Box.attach/photo.png",
  });

  // doctest:L127
  t.check(mapV2Path("Box.attach/nested/photo.png"), {
    kind: "move",
    newPath: "_content/Box.attach/nested/photo.png",
  });

  // doctest:L130
  t.check(mapV2Path("briefing.attach/note.txt"), {
    kind: "move",
    newPath: "_content/briefing.attach/note.txt",
  });
});

// A root file that ISN'T a card (`briefing.md`, `MAP.md`) has no attach scope —
// its bare name (without `.attach`) still falls through to `unmapped`, same as
// any other unrecognized top-level name:
void test("A root file that ISN'T a card (briefing.md, MAP.md) has no attach scope — its...", async (t) => {
  // doctest:L139
  t.check(mapV2Path("briefing.md.attach/x"), {
    kind: "move",
    newPath: "_content/briefing.md.attach/x",
  });
});

// ## Connector state splits from config into bookkeeping
void test("Connector state splits from config into bookkeeping", async (t) => {
  // doctest:L146
  t.check(mapV2Path("config/connectors/gmail.state.json"), {
    kind: "move",
    newPath: "_bookkeeping/connectors/gmail.state.json",
  });

  // doctest:L149
  t.check(mapV2Path("config/connectors/google-calendar-state.json"), {
    kind: "move",
    newPath: "_bookkeeping/connectors/google-calendar-state.json",
  });
});

// Connector CONFIG and secrets stay together under `_config/connectors/`:
void test("Connector CONFIG and secrets stay together under config/connectors/:", async (t) => {
  // doctest:L156
  t.check(mapV2Path("config/connectors/gmail.json"), {
    kind: "move",
    newPath: "_config/connectors/gmail.json",
  });

  // doctest:L159
  t.check(mapV2Path("config/connectors/gmail.secret.json"), {
    kind: "move",
    newPath: "_config/connectors/gmail.secret.json",
  });
});

// ## Undocumented-but-real `procedure/runs/` is mapped, not dropped
void test("Undocumented-but-real `procedure/runs/` is mapped, not dropped", async (t) => {
  // doctest:L166
  t.check(mapV2Path("procedure/runs/2026-01-01T00-00-00/run.json"), {
    kind: "move",
    newPath: "_bookkeeping/procedure/runs/2026-01-01T00-00-00/run.json",
  });
});

// ## v2's own ignore/annex files are discarded, superseded by the regenerated v3 root versions
void test("v2's own ignore/annex files are discarded, superseded by the regenerated v3 root versions", async (t) => {
  // doctest:L173
  t.check(mapV2Path(".gitignore"), {
    kind: "discard",
  });

  // doctest:L176
  t.check(mapV2Path(".gitattributes"), {
    kind: "discard",
  });
});

// ## Free-form `store/<anything>` defaults to content, not an abort
//
// `store/` was always user content in v2 — an ad hoc bucket this table doesn't
// name explicitly (e.g. `store/notes/`) defaults to `_content/<name>` rather
// than aborting the migration.
void test("store/ was always user content in v2 — an ad hoc bucket this table doesn't na...", async (t) => {
  // doctest:L187
  t.check(mapV2Path("store/notes/idea.md"), {
    kind: "move",
    newPath: "_content/notes/idea.md",
  });

  // doctest:L190
  t.check(mapV2Path("store/notes"), {
    kind: "move",
    newPath: "_content/notes",
  });
});

// ## Anything unrecognized under `box/`, or with no top-level home at all, comes back unmapped
//
// `box/` is machinery, not user content — an unrecognized subdirectory there
// needs a human, not a guess. A path with no top-level segment at all (a bare
// root file this table doesn't name) is unmapped too.
void test("box/ is machinery, not user content — an unrecognized subdirectory there need...", async (t) => {
  // doctest:L201
  t.check(mapV2Path("box/commands/whatever.card"), {
    kind: "unmapped",
  });

  // doctest:L204
  t.check(mapV2Path("box/bookmarks/whatever.card"), {
    kind: "unmapped",
  });

  // doctest:L207
  await t.checkText(
    // Ad hoc loose content file — defaults into `_content/` (round-10 rule).
    JSON.stringify(mapV2Path("interview.md")),
    "{\"kind\":\"move\",\"newPath\":\"_content/interview.md\"}",
  );

  // doctest:L211
  t.check(mapV2Path(""), {
    kind: "unmapped",
  });
});

// ## Unknown content-root entries default into `_content/` (ad hoc user dirs)
//
// v2 allowed loose top-level content dirs (`content/images/…` on a real box);
// v3's `_content/` is open vocabulary, so they move in wholesale. Dotfiles stay
// unmapped (unknown runtime state needs a human).
void test("v2 allowed loose top-level content dirs (content/images/… on a real box); v3'...", async (t) => {
  // doctest:L222
  t.check(
    [
      mapV2Path("images/portrait.image.card"),
      mapV2Path("notes.md"),
      mapV2Path(".mystery-state.json"),
    ],
    [
    {
      kind: "move",
      newPath: "_content/images/portrait.image.card",
    },
    {
      kind: "move",
      newPath: "_content/notes.md",
    },
    {
      kind: "unmapped",
    },
  ],
  );
});

// ## The inverse: which v2 paths moved to a v3 path
//
// Runtime records outside the box, such as a Codex thread's cwd, still name
// v2 paths. `v2ContentPathsFor` answers "what was this v3 path called in v2",
// and every answer maps forward to the input. A v3 path can have two origins,
// since both a loose top-level dir and a free-form `store/` bucket landed in
// `_content/`. A path with no v2 origin answers nothing, and so does the box
// root, which v2's `content/` root mapped to as a whole.
void test("Runtime records outside the box, such as a Codex thread's cwd, still name v2...", async (t) => {
  // doctest:L240
  t.check(
    {
      recipes: v2ContentPathsFor("_content/recipes/soups"),
      notes: v2ContentPathsFor("_content/notes"),
      runs: v2ContentPathsFor("_bookkeeping/procedure/runs"),
      tricks: v2ContentPathsFor("src/tricks/weather"),
      v3Only: v2ContentPathsFor("notes"),
      root: v2ContentPathsFor(""),
    },
    {
    recipes: [
      "recipes/soups",
      "store/recipes/soups",
    ],
    notes: [
      "notes",
      "store/notes",
    ],
    runs: [
      "procedure/runs",
    ],
    tricks: [
      "tricks/weather",
    ],
    v3Only: [],
    root: [],
  },
  );

  // doctest:L250
  t.check(v2ContentPathsFor("_content/recipes/soups").map(mapV2Path), [
    { kind: "move", newPath: "_content/recipes/soups" },
    { kind: "move", newPath: "_content/recipes/soups" },
  ]);
});
