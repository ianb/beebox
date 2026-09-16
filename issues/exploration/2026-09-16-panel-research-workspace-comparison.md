---
title: "Research `greentfrapp/panel` — an agent-beside-you research workspace with overlapping choices"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — the boxholder saw similarities worth studying
---

[Panel](https://github.com/greentfrapp/panel) solves a problem close to this
one, and made different choices doing it. The boxholder wants the choices, not
a feature list.

## What it is

A research workspace where the agent works beside you: chat, files, PDFs and
notebooks in one dock, and the agent can build custom viewers and apps when it
needs them. Aimed at researchers doing literature reviews and mixed-data work
who want agent help with transparent, auditable tool execution.

Stack: Node frontend, Python backend over `uv`, Claude Code as the agent,
SQLite (`panel.db`) for conversations and agent activities, folder-based
workspaces with isolated chats and layouts. Its stated limits: Claude Code
only, some modules unavailable on the OpenAI API, and modules launch only from
chat.

Its named concepts are the interesting part:

- **Panes** — configurable windows per content type (files, PDFs, markdown,
  Jupyter with real kernel execution). Users *and agents* can create custom
  panes.
- **Module protocol** — typed Inputs, Outputs and Intermediates, so a
  long-running process is transparent while it runs and modules can feed each
  other.
- **Data abstraction layer** — maps URIs to in-memory or filesystem objects, so
  module logic never knows which it got.

## Where it overlaps, and where we diverge

Each of these is a decision we also made, differently. That contrast is the
research.

| Panel | here |
|---|---|
| Panes in a dock, arranged by layout | views attach to cards (`?view=` on a card path); the companion pane is one slot, not a grid |
| Agents create custom panes | agents author view widgets and cards, within the card schema |
| SQLite for conversations and activities | the filesystem is state and Git is history; transcripts live in the engine's session store |
| Module protocol with typed Inputs/Outputs/Intermediates | procedures as YAML-frontmatter workflows, plus job cards and the reactor |
| Data abstraction layer over URIs | `parseRef` / `resolveRefPath`, one resolver, failing closed on box escape |
| Folder-based workspaces | a box is one package and operational root |

## Questions worth answering

1. **Panes versus views-on-cards.** We deliberately removed card-less views, so
   every view hangs off a card. Panel puts panes in a dock instead. What does a
   dock buy that we gave up, and is any of it reachable without reintroducing
   the standalone view?
2. **What does the typed module protocol buy?** Ours is prose plus schema.
   Typed Inputs/Outputs/Intermediates is a real constraint with a real payoff —
   pipeline-ability and mid-run transparency. Is the transparency the part we
   are missing, and could it be had without the typing?
3. **SQLite for activities.** We chose filesystem-and-Git on purpose. Panel's
   choice presumably buys queryability. Where does ours cost us, honestly?
4. **Agent-created viewers.** Both systems let the agent build UI. How is theirs
   constrained, reviewed, or sandboxed, and does that suggest anything about
   ours?
5. **Notebooks with a real kernel.** A content type we have no answer for. Is
   that a gap or a deliberate absence?

## Research (incomplete)

Nothing beyond the README summary above. Worth reading the module protocol and
the data abstraction layer in the source before drawing any conclusion — a
README describes intent, and the interesting part of a design choice is usually
what it cost to keep.
