---
title: "Transcript processing as labeled sub-agents"
workstream: unknown
area: beebox
priority: normal
---

Two levels of transcript processing that map to different agent types:

1. **Cleanup transcript** (sub-agent) — canonical, well-defined task. Takes raw transcription, cleans up false starts, repetitions, filler words. Preserves original language. Input/output are both text. This can have a standard implementation that works the same way every time.

2. **Restructure into story/formatted text** (skill or procedure) — needs wide context, user preferences about voice and style, judgment about what to keep and what to cut. Not canonical — the rules depend on what Rosa (or whoever) wants. Better as a procedure with custom instructions per use case.

The cleanup sub-agent could be used directly by the inbox processor. The restructure step would be set up by the user as a procedure, possibly chained: raw transcript → cleanup sub-agent → restructure procedure → finished piece.

Key principle: the procedure should show its work. For restructuring, that means demonstrating which words are original vs. edited, with a well-aligned comparison between source and output. This makes the AI's edits auditable and keeps the result grounded in the original language.

Re-reviewed 2026-10-30: transcript cleanup now happens inline under the narration-mode capture rules, not as a sub-agent. The restructure step overlaps the writing-practice issue and the shipped composition editor.

Out of date in the body above: Add a status section: level 1 is partly met by narration-mode capture rules (narration-mode-doc.ts); decide whether a separate cleanup sub-agent is still wanted. Point level 2 at features/2026-07-05-writing-skill.md (fidelity spectrum, marked agent text). Replace the personal name in level 2 with 'the boxholder'.
