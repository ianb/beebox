---
title: "tmp-capture annex ignore glob swallows child cards + manifests — capture commits are silently lossy"
area: callback-box
filed-by: agent
discovered-in: capture-agent-driven worktree — capture-latency measurement pass
resolution: implemented
---

Fixed in `b94a282f`. The managed annex block now re-includes capture metadata,
and rerunning `cb attachments unignore` refreshes stale blocks in existing boxes.

The managed cb-assets ignore block writes `**/tmp-capture/**/*.attach/**` (the
capture-staging annex exception). The intent is to keep pre-triage *media
bytes* out of the annex, but the glob matches **everything** inside a
capture's attach scope — including the child `.image.card`/`.audio.card`/
`.file.card` files and each child's `manifest.json`:

```
$ git check-ignore -v content/tmp-capture/foo.attach/manifest.json content/tmp-capture/foo.attach/bar.card
content/.gitignore:37:**/tmp-capture/**/*.attach/**    …/foo.attach/manifest.json
content/.gitignore:37:**/tmp-capture/**/*.attach/**    …/foo.attach/bar.card
```

This is the same rule that wedged every box-family capture until `6e9860f3`
(commit only what actually staged). Post-fix, captures **deliver**, but the
"Capture:" commit contains only the top-level `.capture-session.card` — the
child cards and manifests are silently uncommitted until (unless) the capture
is filed. History/backup/remotes see a capture document with dangling refs.

Fix direction (either):
- Add negations to the managed block (`!**/…/*.card`,
  `!**/…/manifest.json`) and re-run the unignore writer on existing annex
  boxes; or
- Adopt the "never commit tmp-capture; filing makes the first commit" option
  from `callback-box/docs/plans/capture-fast-landing.md`, which makes the
  glob's over-match harmless by design.

Related: `2026-08-02-annex-doctor-misses-half-migrated-gitignore.md` (doctor
blindness to gitignore/annex disagreement — a doctor check for "capture child
cards ignored" would have caught this too).
