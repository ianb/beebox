---
title: "A scanned photo's stored rotation can turn it the wrong way"
workstream: bug-burndown-5
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: bug-burndown-5 — the rendering fix for rotated image cards
priority: normal
---

> **Closed 2026-10-27 (bug-burndown-5):** the Claude scan backend now asks a
> second question for each photo page: Haiku sees four copies of the photo,
> turned 0°, 90°, 180°, and 270° clockwise, and names the upright one. That
> copy's turn becomes the page's `rotation`. When the check fails or ends
> without an answer, the batch call's value stays and the page is flagged for
> review ("Orientation check failed; rotation unverified"); the batch still
> succeeds.
> Code: `beebox/src/services/scan-vision-claude/upright.ts`; test:
> `beebox/test/services/scan-vision-claude/upright.test.ts`.

Two test1 scan cards,
`_content/inbox/scan-20260429T0246-6c66f791.attach/photo-001.image.card` and
`_content/inbox/scan-20260429T0320-15d9ae2a.attach/photo-001.image.card`,
store `rotation: "270"`. The photo's top faces its left edge, so it needs 90°
clockwise. With 270 the card shows it upside down. Those cards came from the
Gemini backend in April: their `subject-bbox` is set, and the Claude backend
forces it to null.

The rendering and EXIF handling agree with the stated contract, "degrees
clockwise the image needs to be rotated to view correctly"
(`beebox/src/core/describe-images/gemini.ts`). The wrong values come from the
model answering a question about mental rotation.

## Measurements, 2026-10-27

Photos: the two test1 scans above (needing 90°) and seven upright photos from
`scan-20260429T0249-e0911662.attach`. Each was fed in all four turns.
Scripts were kept out of the repository.

| Method | Right |
|---|---|
| Current Claude batch prompt, photo plus back, Sonnet (4 runs per turn, one scene) | 13 of 16; 3 quarter turns in the wrong direction |
| Current rotation question alone, Sonnet, nine photos | 27 of 28 on the seven upright photos; 16 of 16 on the scans |
| Asking which edge the top of the scene faces, inside the batch prompt | 12 of 16; said "right" for the scan in every run, including when its top faced left |
| Picking the upright copy from four turned copies, Sonnet | 44 of 44 |
| Picking the upright copy from four turned copies, Haiku | 44 of 44 |
| Batch plus the Haiku check, end to end | 20 of 20 |

The cost per three-page batch stayed about the same (about $0.046 against
$0.046 before), since the Haiku check is small beside the Sonnet batch call.

## Not addressed

- The Gemini backend (`BBX_SCAN_VISION=gemini`) still uses its own rotation
  answer.
- No UI corrects a wrong stored value. Cards already imported keep their
  rotation. The two test1 cards were corrected by hand in the
  bug-burndown-5 clone only.
