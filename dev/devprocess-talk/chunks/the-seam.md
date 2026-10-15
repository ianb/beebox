---
kind: contrast
cue: it had to pretend to be Claude, one command for setup and cleanup, adding the second agent cost one script
with: codex-day-one, three-mirror-designs
source: inventory.md "The seam: lifecycle out of hooks into a CLI" (Aug 4–8); slide 09d
---
# One command sets up and cleans up, whoever calls it
## A separate checkout per task
Before: OpenAI's coding agent faked Claude's messages to set up a checkout; a dashboard button couldn't at all
After: both agents, timed jobs and the dashboard call one command; 103 cleanups after the OpenAI agent exited, in 40 days
