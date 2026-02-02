# Backlog / Future Ideas

Ideas that are interesting but not the current focus.

## Agent-Editable UI Text

The feedback confirmation messages ("Got it, I'll keep that in mind") feel like they come from a service, but they're actually queuing work for the agent. The agent can't directly respond in real-time, but it could edit a "translation file" of UI phrases to make them sound more like its own voice.

This would let the agent personalize how the system communicates, even in places where it can't respond dynamically.

## Git LFS for Audio Files

Voice recordings are stored in git as binary files. Should initialize boxes with Git LFS configured for audio files (`.m4a`, `.webm`, `.wav`, etc.) to avoid bloating the repo. Need to figure out the `cb init` flow to set this up automatically.
