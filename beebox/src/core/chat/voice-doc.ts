/**
 * Generate the chat-voice reference documentation for agents.
 *
 * Called by generate-docs.ts to produce docs/generated/chat-voice.md.
 * Covers per-message TTS overrides in the chat frontend. The voice list
 * and base configuration live in the personality card rule
 * (docs/generated/card-personality.md).
 */

export function generateChatVoiceDoc(): string {
  return `# Chat Voice: Per-Message TTS Overrides

Chat responses are spoken aloud when wrapped in \`<speech>\` tags. The base voice and delivery style come from the personality card's \`<speaking-voice>\` element — see \`docs/generated/card-personality.md\` for the available voices and style-instruction guidance.

This doc covers **per-message overrides** — changing the voice or instructions for a single spoken segment.

Overrides apply only to the chat frontend. They have no effect in jobs, procedures, or non-chat contexts.

## Base Behavior

By default, every \`<speech>\` segment uses the voice model and concatenated \`<instruction>\` text from the personality card's \`<speaking-voice>\`. An optional nested \`<instructions>\` tag inside \`<speech>\` *adds* to (not replaces) the base instructions:

\`\`\`xml
<speech>I found three overdue items.
<instructions>Gentle, not urgent.</instructions>
</speech>
\`\`\`

The TTS model receives: \`<base instructions from personality> Gentle, not urgent.\`

Use this for most delivery tweaks — emphasis, mood, pacing — where the underlying voice identity should stay the same.

## Overriding the Voice

Use the \`voice\` attribute on \`<speech>\` to pick a different voice for one segment. Valid values are the 13 voices listed in the personality card doc (\`alloy\`, \`ash\`, \`ballad\`, \`cedar\`, \`coral\`, \`echo\`, \`fable\`, \`marin\`, \`onyx\`, \`sage\`, \`shimmer\`, \`nova\`, \`verse\`).

\`\`\`xml
<speech voice="onyx">Stand by. Launching sequence initiated.</speech>
\`\`\`

Typical uses:
- Quoting someone else, or role-playing a different speaker
- A voice whose qualities match the moment (a grave voice for bad news, a peppy one for celebration)
- One-off dramatic effect

An unknown voice name logs a warning and falls back to the personality card's base voice.

## Labeling the Speaker

Add a \`name\` attribute to show a small speaker label on that spoken chunk in the chat UI:

\`\`\`xml
<speech name="Bob" voice="onyx">Hi, I'm Bob!</speech>
\`\`\`

The label is **display-only** — it changes how the chunk looks (and reads in the replay menu), not how it sounds. Pair it with \`voice\` when role-playing or quoting distinct speakers so each line is both voiced and labeled. Omit it for ordinary narration; an unlabeled chunk shows no label.

## Replacing Base Instructions

The nested \`<instructions>\` tag normally appends to the base. To **replace** them entirely for one segment, add \`override-instructions="1"\`:

\`\`\`xml
<speech override-instructions="1">
<instructions>Urgent, sharp, near-whisper. Clipped consonants.</instructions>
The alarm just fired. Check the stove.
</speech>
\`\`\`

Use this sparingly — only when the base instructions actively conflict with the mood you want. Most of the time, *adding* context via a plain \`<instructions>\` tag is enough.

## Combining Overrides

\`voice\` and \`override-instructions\` combine freely:

\`\`\`xml
<speech voice="ballad" override-instructions="1">
<instructions>Theatrical, slow, with pauses for effect.</instructions>
Once upon a time, in a village at the edge of the woods...
</speech>
\`\`\`

## Experimenting

There's no dedicated voice-preview UI. To try out voices and instructions:

1. Edit \`config/main.personality.card\` in the box.
2. Reload the chat page — the frontend picks up the new \`<speaking-voice>\` config.
3. Send a message and listen. Iterate.

Instruction wording matters more than you'd expect. The TTS model responds best to sensory, concrete direction — pacing, pitch, affect, pronunciation — rather than abstract traits like "be friendly." Good instructions read like stage directions: "Low and hushed, with a slight tremble on emphasized words. Pause briefly after questions."
`;
}
