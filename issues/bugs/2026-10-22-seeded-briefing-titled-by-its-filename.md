---
title: "A new box lists its briefing card as \"briefing\", the filename"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — A-lending, G-paperwork, H-handover and I-deciding walks, 2026-10-22
---

The root page of a new box has an "Also here" group with two tiles: "Todos" and "briefing". The briefing card is also headed "briefing" when it opens. "briefing" is lowercase and is an internal word, and a newcomer sees it on the first screen.

Four walks met it:

- A-lending: shot 01 shows the tile.
- G-paperwork: "'box', 'briefing', 'Todos' mean nothing to me yet."
- I-deciding: the walker listed "briefing" among words it did not understand and did not open it.
- H-handover: the walker opened "briefing" to find "a summary of the month" and found the box's notification policy in the first person. She read it as her partner's note to the app: "The word 'briefing' misled me."

Reports: [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-22.md) (R1), [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (row 2), [H-handover](../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (row 25), [I-deciding](../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (rows 3, 48).

## Mechanism

A tile title comes from the card's `title:`, else from what its type derives, else from the filename (`beebox/src/core/landmark/resolve/link-build.ts:101`, `titleFromFilename` in `beebox/src/core/file-summary.ts:70-76`). The seeded `_content/briefing.briefing.card` has no `title:`, and the briefing schema (`beebox/src/schemas/briefing.tsx`) derives none. So the filename stem "briefing" shows. The [landmark link fix](../closed/bugs/2026-10-08-landmark-links-titled-from-filename.md) uses `title:` when present; this card has none.

## Why the fix is not obvious

Decide first whether the briefing belongs in the person's "Also here" list at all. It is the agent's standing context for the box. If it stays, it needs a person-facing title, for example "About this box". A title on the seed changes a card that the agent also reads, and template sync tracks the seed's stock hash; check `briefing.tsx` and the seed's stock hashes in `beebox/src/core/box/structure/defaults.ts` before adding one.

Related: [question heading is its filename](2026-10-22-question-heading-is-its-filename.md) (same symptom on the seeded question card, different code path).
