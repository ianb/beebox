---
read-when: Something you remember fails, a note or procedure of yours disagrees with the docs, or before you say Bee Box cannot do something.
---

# What changed for box agents

This list started on 2026-11-01. Its first entries were gathered from the
month before that, so older changes are not here.

Newest first. Each line says what changed; the doc it names has the details.
If an entry and a note of yours disagree, check the current docs or command,
then fix what is out of date.

- 2026-11-12 (339551c2a): canvas-loop brushes vary their colour per dab or bristle (`hueJitter`, `lightJitter`), and two new presets move paint already drawn: `smudge` and `wet`. See `canvas-loop.md`.
- 2026-11-12 (d2fad3a5f): canvas-loop figures play recorded sounds by name (`kind: "sample"`, `name: "ding"`) and instrument notes (`kind: "note"`, `instrument: "marimba"`, `u.scaleNote(step)`). "Choosing sounds" says which to use. See `canvas-loop.md`.
- 2026-11-12 (5af9fc687): Views and figures import shared code as `@/src/lib/…` from the box root. A view shows a figure with `<CardRef cardRef=… embed />`. See `views.md`.
- 2026-11-12 (8942fdb9e): `bbx figure run <card>` renders a canvas-loop figure headlessly: transcript and frames. Shared figure and view code goes in `src/lib/`. See `card-figure.md`.
- 2026-11-10 (f92ece238): `bbx notify --target` takes `chat:new:<place directory>` (a new chat there) and `place:<place directory>` (its latest chat); the place needs its landmark card. See **REACHING_THE_BOXHOLDER**.
- 2026-11-10 (b6a56d34b): TeX math renders in chat, card bodies, and published pages: `$…$`, `$$…$$`, and `\ce{}` chemistry. A note saying math is unsupported is out of date. See `markdown.md`.
- 2026-11-09 (7e42666b9): `bbx view check` now runs effects and renders each card type, so views it passed before can fail. Views declare `checkStates`; `bbx view states <slug>` lists them. See `views.md`.
- 2026-11-09 (45413ab02): Chat links to a view take `?viewState=` (percent-encoded JSON) to move the open view. The keys come from the view's source. See `views.md`.
- 2026-11-08 (f233c3fdb): To see your own card or view, run `bbx browser open /views/<card path>`, then `bbx browser screenshot --card`. `bbx chat screenshot` shows only the person's screen. See **TOOLS**.
- 2026-11-01 (6a7be17bc): `bbx search` skips `_tmp/` and areas set in `_config/box.json`, so a miss may not mean absent. `--area all` includes them. See **SEARCHING**.
- 2026-11-01 (6a7be17bc): New: `bbx browser` for pages needing a login, `bbx webpage save`, `bbx pdf save`, and `bbx refs` to find what cites a card. See **TOOLS**.
- 2026-10-30 (4a541cf78): `scan-uploader` is gone. Photos albums and scans go through Bee Box Desktop, paired in Settings. See `phone-photos.md`.
- 2026-10-29 (53362e5ee): Each synced calendar is a `.calendar.card`. Write new events as `.ics` in its attach folder; a file directly in `_content/calendar/` is not pushed.
- 2026-10-27 (ca4699775): `bbx view test` is gone. Use `bbx view check`. See `bbx-commands.md`.
- 2026-10-20 (b28d11ae2): `bbx todos --now` replaces `--on-plate`, and `bbx query todos --group status` replaces `--group plate`. See `todos.md`.
- 2026-10-18 (7256fd038): The chat `<schedule>` tag is gone. `bbx remind --here 20m "..."` sets a check-in in this chat; `--in` and `--at` make a reminder that reaches the person.
- 2026-10-16 (0f0aa9e85): The `memo` card type is gone. Captured notes and voice notes are `.doc.card`.
- 2026-10-11 (1db131732): Telegram is gone: `bbx notify --channel telegram` is invalid. Channels are apns and web-push. See **REACHING_THE_BOXHOLDER**.
- 2026-10-10 (d117d8c79): `{% purpose %}`, `{% correction %}`, `{% image %}`, and `{% silence %}` are gone. Purpose is the briefing's `purpose:` field; captures link image cards.
- 2026-10-10 (d2ea7a94c): `recipe`, `course`, `lesson-plan`, `progress`, `concept-map`, and `exposition-plan` are plugin types. `bbx plugins list` shows state. See `schemas.md`.
- 2026-10-09 (55d385e3a): Box instruction files are `AGENTS.md`. `bbx validate` reports a `CLAUDE.md` in a converted box as an error.
- 2026-10-06 (6477c8377): A publication is a `.publication.card` with site files in its attach folder. `bbx pub prepare` takes the card path; `src/publications/` is gone. See `publishing.md`.
