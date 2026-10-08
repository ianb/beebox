---
title: "`<speech>` should take delivery instructions as an attribute, not a child `<instructions>` tag"
workstream: speech-instructions-attr
resolution: implemented
area: beebox
labels: [voice, agent-guidance]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

Closed: implemented in d02737eaa and 0067d309e. Divergence: the old child form is still parsed (never spoken or shown); a raw `>` in the attribute value is an accepted gap.

Agents adjust how a reply is spoken by nesting a tag inside `<speech>`
(`beebox/src/core/chat/session/prompts.ts:43-47`):

```
<speech>I found three overdue items.
<instructions>Gentle, not urgent</instructions>
...
</speech>
```

The boxholder wants an attribute instead:
`<speech instructions="Gentle, not urgent">I found three overdue items.</speech>`.
An attribute keeps the spoken text as the tag's only content, so nothing has
to be stripped out before the text is spoken or displayed, and it matches how
the other message tags carry metadata (for example `user` on `<speech>` and
`<typed>`).

## Where it lands

- Agent guidance: `prompts.ts` (the example and the rule) and
  `beebox/src/core/chat/voice-doc.ts`; the box package doc `chat-voice.md`
  it points to.
- Parsing: `beebox/src/frontend/src/lib/audio/speech-parsing/parse.ts`
  (and `parseTags.ts`), `beebox/src/frontend/src/components/chat/message-parsing.ts`,
  and the CLI's `beebox/src/cli/lib/session-text.ts`.
- Validation: `beebox/src/core/procedure/engine-validate-model.ts` mentions
  `<instructions>`; check what it enforces.
- Tests: `beebox/src/frontend/test/lib/audio/speech-parsing/parse.doctest.md`;
  knowledge audits in `beebox/src/dev/knowledge-audits.yaml`.

## Compatibility

Existing transcripts contain the child-tag form, and a box agent may keep
writing it until its guidance refreshes. Keep parsing the old form (render
and speak it correctly) while the guidance teaches only the attribute; decide
whether the old form is ever removed. Escaping: an attribute value with
quotes needs the same handling the other tag attributes get.

Run a knowledge audit after the guidance change to confirm agents write the
attribute form.

## Resolution

- Guidance (`prompts.ts`, `voice-doc.ts`, audits) shows only the attribute.
  The new audit `chat-voice-delivery-attribute` passes: the agent writes
  `<speech instructions="…">`.
- The parser reads both forms. The attribute wins when both appear. The
  child's text is never spoken or displayed, including a child that has its
  own attributes. The attribute value is entity-decoded like `name`
  (`&quot;`, `&amp;`).
- Old form: keep reading it. Saved transcripts replay through the same
  parser, so removing it would make old messages speak their direction
  text. The cost is a few lines in `parse.ts`.
- Known gap: a raw `>` inside the attribute value ends the tag early (all
  tag parsers here stop at the first `>`). Delivery directions rarely
  contain one, so it is left unfixed.
