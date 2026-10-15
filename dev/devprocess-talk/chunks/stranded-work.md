---
kind: contrast
cue: it never came back, ran the tests in the background, left half-done, run long commands in the foreground
with: launchd-came-back, schedules-at-a-glance
source: slide 11d; inventory.md "Scheduled workstreams and stranded-work handling" (Aug 24 → Oct 6)
---
# Unwatched agents leave work half-done. Something has to notice.
## Agents nobody watches
Before: an agent started tests in the background and quit; its leftovers blocked merges, commits sat unmerged for weeks
After: the job runner sets leftovers aside, lists unmerged commits, can hand off again; long commands run in the foreground
