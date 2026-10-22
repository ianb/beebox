---
kind: contrast
cue: OpenAI's agent arrived, checkouts piled up, no cleanup ran, one shared command, the second agent
with: the-seam
source: inventory.md "Codex as a second engine", "The seam"
---
# A second agent means setup can't live inside one tool
## Adding a second agent
Before: setup and cleanup ran inside Claude's own scripts; OpenAI's agent ran none, and about ten checkouts piled up on day one
After: one shared command creates and cleans up checkouts; OpenAI's agent, timed jobs and a third-party model all use it
