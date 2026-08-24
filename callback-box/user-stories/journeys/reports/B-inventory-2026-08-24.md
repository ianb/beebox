# B-inventory, 2026-08-24

| | |
|---|---|
| Journey | B-inventory — "I never know what I've got" |
| Box | `journey-b` (shared path; the per-run box naming landed after this walk) |
| Harness | `a377c30c`, first walk with `cb-` id driving and the actionability check |
| Walker | Opus, ~127 tool calls |

## What the walk achieved

Read from the box, not the notes. **The two agree throughout, which had not
happened before.**

Eight commits. Workroom tray 1 catalogued: 20 record cards, each with name,
location, description and provenance, all moved from `draft` to `reviewed` after
the walker checked them. Corrections applied and verified by re-asking — a
chopstick that had been recorded as a stylus, a carabiner that had moved to a
backpack, a guitar-pick count. A monthly check-in scheduled for the 1st. An
inventory-conventions file written so the naming rules survive the session.

The shop-style lookup worked, which is the job this journey exists to test: *"do
I have a glue stick?"* → *"Yes — four… Don't buy a fifth."*

Two paths left uncommitted: a modified `briefing.md` and the chat directory.

## Timing

**13 turns, 7.1 minutes of waiting, median 19s, slowest 108s** (reading the two
photographs).

The 66.6-minute wall clock is instrument overhead — the walker composing notes,
which no real person does.

The walk itself reported 32 turns and 11.3 minutes, and said so in its notes,
because `clock.ts` handed it that number. See harness defect 1.

## Findings

| # | What the walk reported | Bucket | Where it went |
|---|---|---|---|
| 1 | Capture dead: 401, mic and finalize disabled | harness | browse key is not the box owner; `capture.ts:135`. Preflight added. |
| 2 | Landmarks leaks other boxes' chats; strangers' names in a blank slate | harness | stale transcripts, defect 2 |
| 3 | Off-screen unreachability is systemic | harness | the walker was never told `bin/browse` can scroll; defect 3 |
| 4 | Counts kept in prose; agent promised a quantity field that doesn't exist | **product**, reduced | [issue](../../../../issues/bugs/2026-08-24-agent-records-counts-in-prose-though-measures-exists.md) — the field exists and was used on 2 of 20 |
| 5 | Sent photos become `[image unavailable]` | **product** | [issue](../../../../issues/bugs/2026-08-24-reloaded-conversation-hides-the-photos-you-sent.md); wording fixed, root question open |
| 6 | Transcript re-renders out of order while streaming; answer parks above the viewport | **product** | not yet filed |
| 7 | "Upload file" deposits into the composer behind the capture overlay | **product** | not yet filed |
| 8 | Vocabulary: `draft`, `Landmarks` (expected places), `.record.card`, `measures` | **product** | appended to [the vocabulary issue](../../../../issues/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md) |
| 9 | `daemon may be busy or unresponsive` near the end | harness | known, `watch/` |

Finding 4 is the one worth reading twice. It was first filed as a missing schema
field, which was wrong: `record.tsx` has `measures`, taking natural-language values
like `"4 sticks"`, and the walk's glue-stick record used it correctly. The claim
came from reading one record and generalising. The true finding is smaller and more
actionable — the agent populates the field about a tenth of the time — and it
survived only because a second record got checked.

## What the app did well

Worth protecting, and easy to lose in a list of defects.

It asked eight located questions rather than guessing, and honoured "mark it
unknown" without inventing contents. Asked whether it had a soldering iron, it
said: *"Not in what we've catalogued — so far that's only workroom tray 1… 'no'
here really means 'not sure yet.'"* Asked how this scales, it named staleness
rather than duplicates as the real failure, gave one habit that prevents them, and
wrote the conventions to a file unprompted.

## Harness defects this run found

1. **Transcripts survived the box wipe.** Claude Code keys them by working
   directory, outside the box. The app backfilled a chat husk per surviving
   transcript, so a "fresh" box opened carrying every previous walk's
   conversations — read by the walker as a data leak — and `agentTiming` summed
   turns across all of them, inflating the clock it hands the walker. Fixed:
   each run now gets its own box path (`24c98daf`).
2. **The walker did not know it could scroll.** `bin/browse` has had `scroll` and
   `scrollintoview` throughout; the prompt never listed them, so every
   `refused: offscreen` read as the app being unreachable. Fixed.
3. **Owner-gated surfaces are unreachable and say nothing.** Auth is always on by
   design, so this cannot be fixed from the harness. `prepare.ts` now records
   `captureBlind` and warns that such a run's capture findings are not product
   findings. Closing it needs a saved browse login.

## Not verified

- **Everything owner-gated**, capture included. This run could not reach it.
- **Voice and TTS**: the box had no Deepgram or OpenAI credentials. The health
  warnings are in `prepare.ts` output; nothing the walk says about voice is about
  the product.
- Findings 6 and 7 were seen on screen but not traced to a mechanism.
- The scale prediction behind finding 4 — that prose counts rot over months — is
  the walker's inference. One tray is not evidence for it.
