---
needs: [design]
area: callback-box
resolution: wontfix
---

# In-chat interactive questions from the agent

**Closed 2026-07-10 (wontfix):** Decided during
`docs/plans/questions-end-to-end.md` (see its "NOT in scope"): synchronous
chat is a different situation from the async question queue — in chat the
agent just asks in prose, the boxholder is right there to answer, and a
retrospective converts that conversation into learning afterward.
`box/questions/` remains the only structured-question primitive; it's for
situations that can wait for a wakeup/review cycle, not live conversation.
No in-chat question tag will be built.

Reported 2026-06-09: the chat agent can't actually ask the boxholder a question in chat — there's no working affordance for "agent asks, user answers, agent continues." The boxholder doesn't especially *like* being asked questions, but the models powering the agent ask them anyway (newer models especially), so the path has to work: a question with no answer affordance is a dead-end turn.

Pieces that exist and don't cover this:
- `box/questions/` — the async queue, for questions that can wait for a wakeup/review cycle. Not in-chat, not conversational.
- `<callout context="...">` — renders content the user must see, but it's one-way; nothing marks "this expects a reply" or structures the reply.

What's probably wanted:
- A structured question tag in the chat output vocabulary (sibling of `<callout>`), rendered with answer affordances — tappable options for the enumerable case (the Claude Code AskUserQuestion shape: 2–4 options + free-text "other"), plain reply for the open case. The agent's next turn receives the selection as structured input rather than parsing prose.
- A decision rule in the prompt about which channel a question belongs in: blocking-the-current-task → in-chat structured question; can-wait → `box/questions/` queue. (Connects to [Aging policy for the questions/waiting queue](2026-05-19-questions-aging-policy.md) for the queued kind.)
- Voice mode matters: when the user is hands-free, options should be speakable ("say one, two, or three" is awful; the agent should phrase the question so a natural spoken answer maps onto an option).
- On mobile, tappable options are *faster* than typing — done well this reduces the friction of being asked, rather than adding to it.

Open question: is this purely a display/vocabulary gap (the agent asks in prose today and it merely *feels* broken because nothing renders it as answerable), or does something actively break (question gets swallowed, turn ends oddly)? Worth reproducing the failure first to pin which.
