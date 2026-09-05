---
title: "memory writing guidance"
workstream: unknown
needs: [design]
area: beebox
---

beebox doesn't currently give the boxholder agent guidance on *how* to write down what it learns — when to note something, where, in what shape, when to update vs. create, what NOT to write. Without guidance the corpus either becomes a transcript (everything noted, nothing findable) or stays empty (nothing noted, agent re-asks the same questions). The auto-memory section in `~/.claude/CLAUDE.md` is a decent template — its structure (types with when-to-save / how-to-use / examples / body-structure) could be adapted.

Dimensions guidance should cover:

1. **What deserves a note at all.** Default to nothing. Threshold: surprising, non-obvious, or contradicts a prior assumption. Without this rule, volume kills searchability.
2. **Update vs. create.** Always check for an existing note on the same subject before creating a new one. Otherwise five overlapping notes accumulate on the same person/topic.
3. **What NOT to write down.** Anything derivable from cards already in the box, from the calendar, from the conversation log. Memory is the residue that *can't* be reconstructed, not a transcript.
4. **Domain separation.** "Domain" needs to be defined in beebox's terms — people, recurring topics, preferences, ongoing situations — not invented per-conversation.
5. **Freshness and decay.** Notes about state (mood, plans, current projects) go stale fast; notes about traits decay slowly. The agent should know which kind it's writing and verify volatile notes before acting on them.
6. **Linking.** A note naming another entity should link to it. Without this, retrieval misses related context.
7. **Why, not just what.** "User prefers terse responses — they read the diff themselves" generalizes to edge cases. "User prefers terse responses" doesn't.
