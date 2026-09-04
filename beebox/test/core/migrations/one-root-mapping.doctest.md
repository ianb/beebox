# one-root migration: the v2 -> v3 path-mapping table

`mapV2Path` (`src/core/migrations/one-root-mapping.ts`) maps a v2
`content/`-relative path to its v3 root-relative destination. It is
exhaustive over the frozen v2 `BOX_LAYOUT` areas (`assertNever`-terminated
internally) — an unrecognized top-level name or subdirectory comes back
`{ kind: "unmapped" }` rather than a guess, so the migration script aborts on
it instead of silently dropping data.

```ts setup
import { mapV2Path } from "../../../src/core/migrations/one-root-mapping.js";
```

## Every v2 area maps to its documented v3 destination

```ts
JSON.stringify(mapV2Path("box/inbox/Foo.memo.card"))
=> {"kind":"move","newPath":"_content/inbox/Foo.memo.card"}

JSON.stringify(mapV2Path("box/inbox/triaged/_unsure/Bar.memo.card"))
=> {"kind":"move","newPath":"_content/inbox/triaged/_unsure/Bar.memo.card"}

JSON.stringify(mapV2Path("box/jobs/2026.job.card"))
=> {"kind":"move","newPath":"_bookkeeping/jobs/2026.job.card"}

JSON.stringify(mapV2Path("box/output/reply.card"))
=> {"kind":"move","newPath":"_bookkeeping/output/reply.card"}

JSON.stringify(mapV2Path("box/questions/q1.question.card"))
=> {"kind":"move","newPath":"_bookkeeping/questions/q1.question.card"}

JSON.stringify(mapV2Path("box/resources/state.json"))
=> {"kind":"move","newPath":"_bookkeeping/resources/state.json"}

JSON.stringify(mapV2Path("box/publish/p1/manifest.json"))
=> {"kind":"move","newPath":"_publish/p1/manifest.json"}

JSON.stringify(mapV2Path("store/archive/done/x.card"))
=> {"kind":"move","newPath":"_bookkeeping/archive/done/x.card"}

JSON.stringify(mapV2Path("store/trash/x.card"))
=> {"kind":"move","newPath":"_bookkeeping/trash/x.card"}

JSON.stringify(mapV2Path("store/usage/session-manifest.jsonl"))
=> {"kind":"move","newPath":"_bookkeeping/usage/session-manifest.jsonl"}

JSON.stringify(mapV2Path("store/recipes/Soup.recipe.card"))
=> {"kind":"move","newPath":"_content/recipes/Soup.recipe.card"}

JSON.stringify(mapV2Path("store/todos/Groceries.todo.card"))
=> {"kind":"move","newPath":"_content/todos/Groceries.todo.card"}

JSON.stringify(mapV2Path("store/drive/x.gsheet.card"))
=> {"kind":"move","newPath":"_content/drive/x.gsheet.card"}

JSON.stringify(mapV2Path("store/calendar/x.ics"))
=> {"kind":"move","newPath":"_content/calendar/x.ics"}

JSON.stringify(mapV2Path("store/chat/web/sess1/Thread.chat-thread.card"))
=> {"kind":"move","newPath":"_content/chat/web/sess1/Thread.chat-thread.card"}

JSON.stringify(mapV2Path("store/reviews/retro/2026-01-01.md"))
=> {"kind":"move","newPath":"_content/reviews/retro/2026-01-01.md"}

JSON.stringify(mapV2Path("people/Dana_Lee.person.card"))
=> {"kind":"move","newPath":"_content/people/Dana_Lee.person.card"}

JSON.stringify(mapV2Path("places/Home.place.card"))
=> {"kind":"move","newPath":"_content/places/Home.place.card"}

JSON.stringify(mapV2Path("docs/some-stray-doc.md"))
=> {"kind":"move","newPath":"_content/docs/some-stray-doc.md"}

JSON.stringify(mapV2Path("tmp/scratch.txt"))
=> {"kind":"move","newPath":"_tmp/scratch.txt"}

JSON.stringify(mapV2Path("config/procedures/foo.procedure.card"))
=> {"kind":"move","newPath":"_config/procedures/foo.procedure.card"}

JSON.stringify(mapV2Path("config/schedules/tick.scheduled-script.card"))
=> {"kind":"move","newPath":"_config/schedules/tick.scheduled-script.card"}

JSON.stringify(mapV2Path("config/schemas/local.ts"))
=> {"kind":"move","newPath":"_config/schemas/local.ts"}

JSON.stringify(mapV2Path("tricks/scripts/helper.ts"))
=> {"kind":"move","newPath":"src/tricks/scripts/helper.ts"}

JSON.stringify(mapV2Path("tricks/lib/util.ts"))
=> {"kind":"move","newPath":"src/tricks/lib/util.ts"}

JSON.stringify(mapV2Path(".claude/rules/foo.md"))
=> {"kind":"move","newPath":".claude/rules/foo.md"}
```

## Root files move into `_content/`; `CLAUDE.md` merges instead

```ts
JSON.stringify(mapV2Path("briefing.briefing.card"))
=> {"kind":"move","newPath":"_content/briefing.briefing.card"}

JSON.stringify(mapV2Path("briefing.md"))
=> {"kind":"move","newPath":"_content/briefing.md"}

JSON.stringify(mapV2Path("Box.landmark.card"))
=> {"kind":"move","newPath":"_content/Box.landmark.card"}

JSON.stringify(mapV2Path("MAP.md"))
=> {"kind":"move","newPath":"_content/MAP.md"}

JSON.stringify(mapV2Path("CLAUDE.md"))
=> {"kind":"merge-claude-md"}
```

## A root card's `<name>.attach/` sibling scope carries along to the same v3 destination

Finding 10 (round 3 hardening): `Box.landmark.card` maps to
`_content/Box.landmark.card`, but its sibling attach directory
`Box.attach/` had no case at all before this fix — the migration aborted
preflight on it. Derived from `V2_ROOT_FILE_TARGETS` (every mapped root
CARD), not hand-enumerated a second time.

```ts
JSON.stringify(mapV2Path("Box.attach/photo.png"))
=> {"kind":"move","newPath":"_content/Box.attach/photo.png"}

JSON.stringify(mapV2Path("Box.attach/nested/photo.png"))
=> {"kind":"move","newPath":"_content/Box.attach/nested/photo.png"}

JSON.stringify(mapV2Path("briefing.attach/note.txt"))
=> {"kind":"move","newPath":"_content/briefing.attach/note.txt"}
```

A root file that ISN'T a card (`briefing.md`, `MAP.md`) has no attach scope —
its bare name (without `.attach`) still falls through to `unmapped`, same as
any other unrecognized top-level name:

```ts
JSON.stringify(mapV2Path("briefing.md.attach/x"))
=> {"kind":"unmapped"}
```

## Connector state splits from config into bookkeeping

```ts
JSON.stringify(mapV2Path("config/connectors/gmail.state.json"))
=> {"kind":"move","newPath":"_bookkeeping/connectors/gmail.state.json"}

JSON.stringify(mapV2Path("config/connectors/google-calendar-state.json"))
=> {"kind":"move","newPath":"_bookkeeping/connectors/google-calendar-state.json"}
```

Connector CONFIG and secrets stay together under `_config/connectors/`:

```ts
JSON.stringify(mapV2Path("config/connectors/gmail.json"))
=> {"kind":"move","newPath":"_config/connectors/gmail.json"}

JSON.stringify(mapV2Path("config/connectors/gmail.secret.json"))
=> {"kind":"move","newPath":"_config/connectors/gmail.secret.json"}
```

## Undocumented-but-real `procedure/runs/` is mapped, not dropped

```ts
JSON.stringify(mapV2Path("procedure/runs/2026-01-01T00-00-00/run.json"))
=> {"kind":"move","newPath":"_bookkeeping/procedure/runs/2026-01-01T00-00-00/run.json"}
```

## v2's own ignore/annex files are discarded, superseded by the regenerated v3 root versions

```ts
JSON.stringify(mapV2Path(".gitignore"))
=> {"kind":"discard"}

JSON.stringify(mapV2Path(".gitattributes"))
=> {"kind":"discard"}
```

## Free-form `store/<anything>` defaults to content, not an abort

`store/` was always user content in v2 — an ad hoc bucket this table doesn't
name explicitly (e.g. `store/notes/`) defaults to `_content/<name>` rather
than aborting the migration.

```ts
JSON.stringify(mapV2Path("store/notes/idea.md"))
=> {"kind":"move","newPath":"_content/notes/idea.md"}

JSON.stringify(mapV2Path("store/notes"))
=> {"kind":"move","newPath":"_content/notes"}
```

## Anything unrecognized under `box/`, or with no top-level home at all, comes back unmapped

`box/` is machinery, not user content — an unrecognized subdirectory there
needs a human, not a guess. A path with no top-level segment at all (a bare
root file this table doesn't name) is unmapped too.

```ts
JSON.stringify(mapV2Path("box/commands/whatever.card"))
=> {"kind":"unmapped"}

JSON.stringify(mapV2Path("box/bookmarks/whatever.card"))
=> {"kind":"unmapped"}

JSON.stringify(mapV2Path("interview.md"))
=> {"kind":"unmapped"}

JSON.stringify(mapV2Path(""))
=> {"kind":"unmapped"}
```
