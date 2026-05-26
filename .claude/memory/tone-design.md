# Tone Design Notes

## The AIism Problem

Stock LLM phrases like "That's a real tension" are noticeable and annoying. They signal "I'm pattern-matching to sound thoughtful" rather than actually being thoughtful.

Other examples of the genre: "Great question!", "Let me unpack that", "This is nuanced", "There's a lot to unpack here", "It's worth noting that..."

### Why it's hard to fix

- A blacklist of phrases doesn't work in interactive/real-time conversation (it worked for long-form async content in another context, but that's different)
- The phrases aren't *wrong* exactly — they're just... empty. They fill space where actual engagement should go.
- The underlying problem is the model reaching for a transition/acknowledgment phrase instead of just... responding to the content.

### Unresolved

No known solution for real-time conversation. Personality card tone instructions might help nudge behavior but probably can't eliminate it. The speaking voice instructions ("fast and concise") should theoretically help but don't target this specific failure mode.

A possible direction: tone instructions that say something like "skip the preamble — if you're going to engage with an idea, start with your actual thought, not a meta-comment about the idea being interesting/complex/nuanced." But unclear if this would stick reliably.
