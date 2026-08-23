---
title: "\"Edited a file\" appears in chat with no way to see what changed"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-user-stories-refresh — journey B, twelve minutes into a first session
---

While answering a question, the assistant's activity line reported that it had
**edited a file**. The person had asked a question, not asked for a change. From
their notes:

> I asked a question. I did not ask it to change anything. Something has been
> edited somewhere and I don't know what or where, and I can't see it from here.
> That's a slightly uncomfortable feeling on minute twelve of my first ever
> interaction.

Two things are wrong here, and they are separable:

1. **The activity line names an action without naming its object.** "Edited a
   file" is exactly as much information as "did something". The path is known to
   the system at that moment.
2. **There is no route from the statement to the change.** Nothing in the chat
   links to what was edited, and History is not reachable from there — the same
   session recorded "Back to Dashboard" as a link to a page they had never seen.

The product's whole premise is that it acts on your files on your behalf. A
person's first encounter with that should not be an unattributed edit they
cannot inspect. Git history exists and is a feature; this is the moment it
should be one click away.
