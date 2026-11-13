---
title: "Maybe: tell the agent on its next turn about errors in its last reply"
workstream: unattached
area: beebox
discovered-by: Ian
filed-by: agent
---

The agent does not learn when its chat output is malformed. A broken link, bad markdown, or a misused output tag renders wrong for the person, and the agent repeats the mistake in later turns. Nothing tells it about the problem.

## Idea

After a reply, check it for problems that can be detected mechanically. On the next turn, put a short note at the head of the message the agent receives. For example:

```
<!-- Error in last assistant message: your link [...] does not point to a live page -->
```

Candidate checks:

- links that do not resolve to a live page or card;
- markdown that renders wrong;
- misused output tags. Examples are the cases in [the `<how>` tag issue](../features/2026-11-13-how-tag-marks-process-narration-for-the-fold.md): `<how>` mixed with `<speech>` or a callout, and a bare ack kind tag rendered as text.

## Open questions

- Where do the checks run? On the server when the turn ends, or in the web renderer, which already parses these tags and links and would have to report back?
- Where does the note go in the next turn's input, and is it visible to the person in the transcript?
- What if the person does not send a next turn? The note waits, or it is dropped.
- Limit the noise. Report only errors the agent can fix, a few at most, and nothing when the reply is clean.
