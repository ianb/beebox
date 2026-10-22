---
title: "Marking a draft as sent deleted the draft and kept only the person's chat message"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — C-reconnecting walk, 2026-10-22
---

The person said: "I'll use the lighter version: 'I hope things have been okay with your mum.' I just sent it to her from my phone." Box commit `3f112e9` deleted the draft from Noor's card. It wrote "Sent from your phone, based on the draft I suggested, using the lighter line" above a verbatim quote of that chat message. The card now refers to a draft that it does not hold. The sent words exist only in git history and in the chat. The walker: "the 'sent' quote is my chat message to the app, not the actual words I sent her."

In the same session the agent kept the sent text for the other three friends (`9fe1c84`, `7949535`). This is one instance of agent judgment, not a code path.

Report: [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (row 17).

## Why the fix is not obvious

The person did not paste the final words, so the agent had to rebuild them from the draft and the change. A rule could say: when a draft becomes sent, keep the text that was sent, edited as the person said. The person card's schema instructions or the guide's drafting guidance could carry it. A knowledge audit could check whether an agent keeps the text. Check another C walk before treating this as a pattern.
