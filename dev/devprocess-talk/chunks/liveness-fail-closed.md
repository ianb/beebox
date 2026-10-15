---
kind: contrast
cue: unknown counts as still working, fail closed, force does not override it, the check that deleted when unsure
with: cull-zero-unknown, the-seam
source: slide 09b (bin/lib/worktree-teardown.sh, bin/workstreams); slide 09d
---
# Unsure whether an agent is done? Cleanup leaves the work alone.
## Cleaning up finished checkouts
Before: cleanup deleted even when unsure; a review by another AI model family caught it
After: unsure counts as still working, and nothing overrides that, not even force
