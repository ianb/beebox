---
title: "AssetsStillIgnoredError reports ignore rules as though they were assets, so a zero-asset box is told it has 17"
workstream: full-embrace-annex
area: beebox
labels: [annex]
filed-by: agent
discovered-by: agent
discovered-in: worktree-full-embrace-annex — converting the last manifest-scheme box
---

`bbx attachments to-annex` on a box with **no assets at all** printed:

```
Error: 17 asset(s) are still gitignored, so git-annex would never see them.
Run `bbx attachments unignore` first (and clear any hand-written asset rules
it reports):
  /_content/**/*.attach/**/*.jpg
  /_content/**/*.attach/**/*.jpeg
  ...
```

The 17 are gitignore **rules**, not assets — the listed values are glob
patterns, and the box had zero files under any `.attach/` scope.
`AssetsStillIgnoredError` (`src/core/annex/to-annex-errors.ts:95-105`) takes a
`paths` array and renders `paths.length` as an asset count.

The precondition itself is correct and the remedy it names is correct. Only
the count and the noun are wrong.

Worth fixing rather than tolerating because of where it sits. This is the seam
where `c47fd2be1` found three checks failing open at once, and the doc comment
on this very error calls it "the root cause of the worst failure this migration
can have." An operator auditing a box for stranded assets, told "17 assets are
still gitignored" when the true answer is zero, will go looking for bytes that
do not exist — or, worse, will read a later "0 assets" report as a
contradiction and distrust the right one.

`bbx attachments unignore` reports the same condition correctly:
`Error: 17 unmanaged asset ignore rule(s)`. That is the wording to match.
