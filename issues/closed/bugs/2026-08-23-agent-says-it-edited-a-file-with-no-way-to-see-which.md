---
title: "\"Edited a file\" appears in chat with no way to see what changed"
workstream: unattached
area: beebox
filed-by: agent
discovered-in: worktree-user-stories-refresh — journey B, twelve minutes into a first session
priority: normal
resolution: implemented
---

**Closed 2026-10-17:** fixed on the bug-burndown-2 branch ("Chat edit lines link to the file they changed"). In a finished edit or new-file line ("Updated Theme Tour"), the file's name is a link that opens the card in the workspace beside the chat; the card's menu already offers View history. Boxholder chose the name link only, with no separate history link. Not covered: a change the agent makes through a shell command reads "took a step" and has no link. Checked in the worktree test box with a real Edit; regression cases in `beebox/src/frontend/test/components/chat.activity-wording.doctest.md`.

**2026-10-17 status:** part 1 below is fixed by 72226e395 ("Chat: expanded activity lines name the thing and show what changed"). An edit row now names its object ("Updated Errands", "Made a change to Errands", with the folder in muted text), and a finished edit shows a short before/after excerpt. Part 2 remains: the row has no link to the card it changed or to that card's history (`activity-rendering.tsx` renders no link). This issue now tracks that route from chat to the change.

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
