---
title: "Maybe: tell the agent about errors in its reply, in the same turn or the next"
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

## Same-turn retry (2026-11-16)

The developer proposed a second delivery. When the turn ends, validate the reply. If a check fails, send the agent a message such as `<system-error>Your link [...] does not point to a live page</system-error>` and let it continue in the same turn. Allow one pass only, so a check that the agent cannot satisfy does not loop.

This fixes the reply that the person reads, while the next-turn note fixes only later replies. Tensions:

- The person may already see the faulty reply while it streams. The fix arrives as a second message, or it replaces the first.
- The retry adds latency and cost to every turn that fails a check, so false positives matter more.
- If the second pass also fails, the reply stays as it is. Possibly the next-turn note then applies.
