---
title: "Nothing offers a catch-up to someone who arrives at a box that already has a past"
workstream: unattached
needs: [design]
area: beebox
labels: [multi-user, onboarding]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — H-handover walk, 2026-10-22
---

When I open a box that someone else has kept for weeks, I want to see what is late, what changed, and what is waiting on me, so that I can act without asking them.

The H-handover walker played a partner who minds the house while the boxholder is away. The root page's count line ("8 to do · 4 overdue") got her to the late items. She had to find everything else card by card. Her wish: "a 'here is what happened while you were away' view for the person coming back." She then asked the chat for "a short rundown of everything in here that is still open or late, what I have sorted tonight, and anything he needs to decide or know". The reply was accurate and took 17 s. She called it "the thing I came for". On request it became a note for the boxholder.

So the box can produce the catch-up, and nothing leads a person to it. The root page's opener in that walk was the stock "Tell me about talking instead of typing."

Report: [H-handover](../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (rows 29, 30).

## Questions

- Is this an opener, a root-page section, or a chat behavior on a first visit from a new person?
- What counts as "since": the newcomer's last visit, the boxholder's last commit, or a date the person gives?
- The box history holds the "what changed" half. The agent read `git log` in the walk, but nothing on screen offers history.
- The walk could not tell the box who was visiting: the browse key carries no user ([browse key is not a signed-in owner](../bugs/2026-10-09-browse-key-is-not-a-signed-in-owner.md)).

Related: [most recent conversation should be per person](2026-09-12-most-recent-conversation-should-be-per-person.md).
