---
title: "A `<how>` tag marks the agent's process narration, and it always stays in the folded activity row"
workstream: unattached
area: beebox
discovered-by: Ian
filed-by: agent
---

The chat decides what text to fold by its position in the turn. The developer reports that the result is wrong. Text the agent writes before the last tool call folds into the collapsed activity row ("Found it — … · 7 steps") as a note. The text after the last tool call is the reply. The text's purpose does not affect the decision. A line that describes the work can stay visible, and a line written for the person can fold.

## Proposal

The agent marks its narration about how it does the work with a `<how>` tag. Text inside `<how>` is always a note in the collapsed section, wherever it occurs in the turn, also after the last tool call. Text outside the tag is written for the person.

## Current behavior

- `groupIntoParts` in `beebox/src/frontend/src/components/chat/assistant-parts.ts` does the positional fold. A line can fold if it is a progress update, or text before the last tool call without a `<speech>` tag. When the turn has no visible reply, the last foldable line stays visible.
- The collapsed header and its step count come from `beebox/src/frontend/src/components/chat/ChatMessages/activity-summary.ts`. `splitStages` divides the notes into stages.
- Codex progress updates arrive as `thinking` blocks with `progressUpdate: true` (`beebox/src/services/codex-tool-activity.ts`, `beebox/src/cli/lib/session-content.ts`).
- Tags in chat output are stripped by `stripStructuredOutputTags` in `beebox/src/frontend/src/lib/structured-output-parsing.ts`. The agent learns the tag vocabulary from `beebox/src/core/chat/session/prompts.ts`.

## Open questions

- Does `<how>` replace the positional rule, or add to it? Should untagged text before a tool call still fold?
- How does `<how>` interact with `<speech>` (spoken output in voice mode) and with callouts inside a folded line?
- How does the collapsed header pick its headline when the turn has several `<how>` notes?
- iOS and other renderers that read chat output need to strip or fold the tag too (bbx-ios-overlap).
- Which specific mis-folds did the developer see? Collect examples before the design, so the tag fixes the cases that occur.
