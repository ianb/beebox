---
title: "A shared image or link with no words is saved and then ignored: nothing reads, titles, or files it"
workstream: fabric-research
area: beebox
needs: [design]
resolution: implemented
labels: [capture, ios]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-fabric-research — comparing Fabric's phone photo sync, which reads every synced image
---

**Closed 2026-10-17:** implemented on `worktree-fabric-research` (commits fa73c9c10 through 854813bb, plan `beebox/docs/implemented-plans/file-wordless-captures.md`): a settled burst of word-less captures is queued for an intake job that reads, retitles and files them. Divergence: the plan's knowledge audit was not added, because built-in intake-job instructions are inlined into the reactor prompt, which an audit does not exercise; live reactor runs on a throwaway box stood in for it.

A phone capture with no typed or dictated words is committed to
`_content/captures/` on arrival and is never routed
(`beebox/src/core/quick-capture/source.ts:28-35`; `beebox/docs/mobile-contract.md`,
"Source and work"). That folder is outside the intake inbox, so triage does
not see it. The source doc keeps the placeholder title "Saved capture". A
screenshot sits unread until someone asks about it by other means. The
boxholder (2026-10-17): an image alone should be enough to start work.

The no-routing rule comes from
`beebox/docs/plans/ios-app-intent-capture.md:23`: save the screenshot "without
inventing a task now". That concern is about acting on a guessed request. It
does not require leaving the material unread. Two kinds of work are combined
in the current rule:

- **Filing work.** Read the image (text in it, what it shows), give the doc a
  title, file it by the landmark triage rules, make it findable. This invents
  no request and can run for every capture.
- **Acting work.** Do something the person wants done with the material. This
  still needs the person's words.

## Trickle-in

People often share several screenshots in a row, or share first and add words
a moment later. A per-item job on arrival would split one thought into
several turns, or file an item seconds before its words arrive.

The scan uploader has the same problem and a working answer: a settle window
of two minutes with no new upload ends the batch, then one pass runs
(`beebox/src/core/scan/promote-debounce.ts`, `SCAN_SETTLE_MS`). A possible
shape for captures:

- A capture with no words opens or extends a settle window per device and box.
  Another capture, or Add context on one in the window, restarts it.
- When the window closes, one filing job runs over the group.
- If words arrive inside the window, the group is routed as a request through
  the normal path.
- Words after the job use the existing Add context path by capture ID.

## Open questions

- After filing, is the result silent (filed, searchable, a line on the box
  screen), or does it open a conversation when triage rules do not fit? The
  agent's lean: silent, with a question only when no rule fits.
- Window length. Two minutes matches scans; a phone share session may be
  shorter.
- Cost: one agent turn per group, plus vision on each image, on every
  word-less capture. Is that acceptable by default, or a box setting?
- Do the same rules apply to Clerk sends and web uploads with no words?
- Recordings are committed to `_content/captures/` even with words; check
  whether they share this gap.

Related: [quick drop entry points](../../features/2026-09-25-quick-drop-entry-points.md),
[capture success is invisible](../../bugs/2026-08-20-capture-success-is-invisible.md),
[Fabric review](../../../research/fabric-review.md).
