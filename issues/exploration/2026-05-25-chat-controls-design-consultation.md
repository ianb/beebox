---
title: "chat controls design consultation"
needs: [design]
area: callback-box
---

The chat controls in callback-box are a genuinely hard, complex design problem: a chat surface that's also a control surface, with a developer-user, an LLM, structured commands, an evolving set of in-progress states, and many things that could go wrong needing to be made visible (per the transparency principle — see ~/.claude/projects/-Users-ianbicking-src-callback/memory/feedback_transparency.md). They've evolved incrementally rather than being designed end-to-end, and the accumulation shows.

Worth a deliberate pass with a design consultation or shotgun approach. Two patterns from gstack worth borrowing for it:

- **SAFE / RISK split**: explicitly separate where the chat controls should look like a typical chat UI (so users aren't disoriented) from where they should deliberately diverge (because the developer-user + transparency posture call for surfaces a normal chat doesn't have — visible state, inspectable in-flight work, error states that don't hide). Each risk gets a "why it works, what it costs" justification.
- **Memorable-thing forcing question**: what's the one thing a developer-user should remember after seeing the chat controls for the first time? Probably has to do with transparency or agent-as-collaborator. Constraint that disciplines everything else.

Full notes on the underlying skills: `~/src/callback/gstack-review/notes/design-consultation.md` and `notes/design-shotgun.md`. Not adopting the gstack skills wholesale (heavy infrastructure), but the SAFE/RISK and memorable-thing patterns work standalone.
