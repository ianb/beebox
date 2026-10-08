---
title: "spirit.md and the architecture narrative describe behaviour that shipped differently or never shipped; boxholder rulings needed"
workstream: skills-review
area: beebox
labels: [docs, design]
filed-by: agent
discovered-by: agent
discovered-in: skills-review — review of docs/architecture and docs/design for rot (2026-10-08)
resolution: implemented
---

**Done 2026-10-08** (boxholder ruling: "just a bunch of accuracy things, just
lots of fixes"). Fixed every row in "Claims that are now false" except the
spirit-phrased last row, in `01-what-is-this.md`, `02-cards-and-memory.md`,
`outline.md`, `spirit.md`, and `writing-style.md`: capture pages became the
chat composer's capture mode; private-content claims removed; notifications
are pushes to the boxholder on iPhone or browser at dot/quiet/loud; RSS
removed; "every change a commit" became "most", chat messages excepted; the
`list`/`event` types became a `doc` card with inline todos and `.ics`
events; provenance requirement made conditional; XML, attachments, wakeup
cycle, email forwarding, publishing, web-as-main-UI, agent engine, and
question states corrected; the six-member chat became each person talking
with the box plus one family Telegram group. Design docs: dated notes in
`trust.md` (optional `memo`/`directive`; full vocabulary list),
`identity.md` (Admin card), and `interface-as-cards-background.md` (stale
present tense). `extensibility.md` already carried the modes note. Left: the
`architecture-overview.png` diagram prompt still says "Capture Pages"
(changing it forces an image regeneration).

These are the boxholder's voice and were left unedited except for paths. Each
item is a claim the code no longer matches, with the current truth. Rule on
each: fix the sentence, mark it aspiration, or keep it as spirit. Confidence
in brackets.

## Claims that are now false

- **Capture pages** (`01-what-is-this.md:17,39,59`, `outline.md:13,18`,
  `writing-style.md:50`): standalone capture pages. `/capture` redirects to
  chat; capture is the chat composer's capture mode
  (`implemented-plans/capture-mode.md`). [high]
- **Private content** (`01:25`, `writing-style.md:38`): "some are private,
  just for the box". Ruling 2 of the design reconciliation: one sharing
  granularity, everyone in a box shares everything. [high]
- **Notifications** (`01:43`): "through the group chat or as direct
  messages". They are pushes to the boxholder (`notifyBoxholder`) over
  iPhone, browser push, or Telegram at dot/quiet/loud; no per-member
  targeting. [medium-high]
- **RSS** (`01:57`): no RSS connector exists; connectors are gmail,
  google-calendar, google-drive, telegram. [high]
- **Every change a commit** (`01:61`, `spirit.md:29`, `02:85`): chat
  messages are not committed (ruling 13). [medium]
- **Card types** (`02:46,48`): `Costco_List.list.card`, "an event card has
  a date, a time, a location". No `list` or `event` type; events are `.ics`
  in `_content/calendar/`, todos are inline items. [high]
- **Required provenance** (`02:50`): `memo.source` is optional; provenance
  is aspiration (ruling 14). [medium]
- **XML is the format** (`outline.md:38`): cards are YAML frontmatter plus
  markdown. Flagged in the reconciliation appendix, never fixed. [high]
- **Attachments need a directory** (`outline.md:42-43`): `Name.attach/`
  shipped. [high]
- **Wakeup cycle** (`outline.md:67`): "sync, process inbox, execute
  commands, archive". No commands; the reactor runs jobs, then
  `bbx finalize`. [high]
- **Email forwarding as primary intake** (`outline.md:60,64,115,125`): the
  Gmail connector reads the boxholder's own account by query or label; no
  forwarding mechanism. [medium-high]
- **"No webpage publishing yet"** (`outline.md:166`): publications shipped
  (`docs/publishing.md`). [high]
- **Web is a surface, not the product** (`outline.md:175`): rulings 1 and 6
  make the web UI the privileged main UI. [high]
- **Agents are Claude Code** (`outline.md:73`): `agentEngine` can be Codex
  (`docs/model-policy.md`). [medium]
- **Question lifecycle** (`outline.md:98`): "asked, answered, moot,
  expired". Shipped: pending, answered, dismissed, expired. [medium]
- **Six-member group chat** (`01:9-11`, `outline.md:17`): works in a
  Telegram group; the web chat has no multi-human thread. [medium-low]
- **Every input surface is open-ended** (`spirit.md:37`): question cards
  have select and confirm inputs. Phrased as spirit; may stand. [low]

## Vignettes

- Retired: the capture-page vignettes (the 5:45am memo, kitchen inventory
  narration); the memo itself works through chat capture mode.
- Never shipped: story cards from audio cards (already marked aspiration),
  cooking pages, swim-time charts, the GM tool, the "why is tahini on here"
  trace (ruling 14), cross-language translation "without a separate step"
  (`01:25`).
- Partly shipped: cooking timers (chat schedule timers with alarm and TTS),
  the build-journal page (publications), questions going moot (30-day
  expiry).

## Design-doc flags not fixed in place

- `trust.md:11-12`: `memo` and `directive` given as fields an agent must
  fill; both optional (`src/schemas/question.ts:139,143`).
- `trust.md` "three confidence vocabularies" is incomplete; see the
  companion issue on rules the design layer omits.
- `identity.md:20` "Admin/OAuth stays shell": Admin has a card at
  `_config/interface/admin.card`; authorization is still backend-enforced.
- `extensibility.md:39`: the UI says "narration mode" and "Capture mode";
  ruling 19 ("modes don't surface to users") may need revisiting.
- `interface-as-cards-background.md:283-287`: stale present tense
  (`ViewPage.tsx`, `looksLikeFilePath` are gone; `view:` scheme retired;
  the "Becomes" column predates the dedicated system schemas).
