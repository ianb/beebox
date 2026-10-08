---
description: "A full web app over the box: dashboard, chat, browsing, questions, history, settings, and per-card views, on desktop and phone."
---
# The web interface

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent that operates the box. You use the
box through a web application, not by opening files yourself. It runs on
desktop and phone.

**What you see**

- **Dashboard** — what needs your attention, with links to Browse, History, and Storage.
- **Chat** — a conversation with the agent, typed or spoken.
- **Box screen**: the screen for the box as a whole, and the one the iPhone
  app opens on. It has one text box for a thought you have not decided where
  to put (quick chat). The box stores the thought and a routing service picks
  which conversation it belongs in, or a new one. When the choice is clear the
  thought is posted there without a confirmation step, and a posted thought
  cannot be moved. When it is not clear, the thought waits on the screen with
  up to four choices and a discard button. Spoken or typed, you can also name
  the place at the start ("new chat in Garden"). The screen also lists
  thoughts still waiting for you, recently sent ones, recent chats to pick up,
  shortcuts, and your other boxes. It needs an OpenRouter key granted to the
  box, and your message and recent conversation text go to that service (see
  [your data and safety](../10-your-data-and-safety.md)). The box-wide pages
  (Dashboard, Browse, History, Storage) sit in the avatar menu.
- **Browse** — a file-and-card browser over the whole box, with a workspace of tabs so several things stay open at once.
- **Todos**: a todo shows a live checkbox on its card and in lists, so you can tick it where you read it (any member of the box can) or add it to the chat you are typing. A card and a directory each show a one-line count of what is open there. Todos assigned to the agent stay out of your default view, and a daily review the box runs proposes changes to your todos and makes none itself.
- **Questions** — the queue of things the agent is asking you.
- **Landmarks** — a curated map of the box's notable places.
- **History** — every change, drawn from git, with diffs and the files touched.
- **Storage** — how much space the box is using and where.
- **Settings** — pairing a phone, connectors, and other account controls.
- **Admin**: host-wide controls, owner only, in six tabs: an overview of each section's state, agents (which agent is running and which extra OpenRouter models a box may run), people (allowed users and invites), connections, secrets (each key a collapsed row showing what uses it), and the host, which holds notifications: browser push on or off, a three-day list of what each channel did, and the paired phones.

Each kind of card gets its own display: a recipe with scalable amounts, a
course with its lessons and your progress, a dashboard or a todo list, a
document, a spreadsheet, a PDF, a photo, a person, or a folder. A card shows
its content on the front; turning it over shows its properties, such as the
fields of its type, how it was found, its attachments, and its last change.
Cards can also carry a paper theme and a card stock (plain, paper, sticky
note, or letter set), so a recipe or a letter looks distinct from a plain
note. The interface as a whole has its own theme, which also sets the colour
of selected text. When you have more than twenty landmarks, the landmark menu
gains a search field.

**On a phone**

A native iPhone companion app is a shell around the same web chat, adding
pairing, recording, and speech input, and a native box screen it opens on. Any phone's browser can also
reach a capture page for voice memos, photos, and scans. See
[phone-capture.md](phone-capture.md).

**How it relates to the files**

Every screen is a rendering of cards; nothing in the interface is separate
from the box. The agent can build new views for a richer look, the same
way it edits any other file. See [views.md](views.md).

**Limits**

The navigation bar shows a count of questions waiting for you and of todos on
your plate, each linking to its list. The badge is still a bare number beside an
icon, so it can read as a wrong total; the plate page's headline states the
number and what it covers ("N on your plate, M later, K for the agent"), and
todos assigned to the agent are left out of the badge. Some card-body
links still point at an older internal address rather than the one that
actually opens, though following one still works. A rotated photo
occasionally renders upside down or clipped.

**Go deeper**

[views.md](views.md), [chat.md](chat.md), [phone-capture.md](phone-capture.md),
[../reference/interface-cards.md](../reference/interface-cards.md),
[../reference/views.md](../reference/views.md),
[../reference/cards/dashboard.md](../reference/cards/dashboard.md),
[../reference/cards/browse.md](../reference/cards/browse.md),
[../reference/cards/landmarks.md](../reference/cards/landmarks.md),
[../reference/cards/history.md](../reference/cards/history.md),
[../reference/cards/questions.md](../reference/cards/questions.md),
[../concepts/landmarks.md](../concepts/landmarks.md)
