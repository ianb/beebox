---
title: "Right-click a box-authored view or card: Explain, or Modify this view"
workstream: unattached
area: beebox
needs: [design]
labels: [views, chat, competitive-research]
filed-by: agent
discovered-by: agent
discovered-in: worktree-imbue-studio-research — Studio's element-reference menu
---

Imbue Studio serves one `contextmenu` listener into every app page and the
shell. A right-click builds a JSON reference from the DOM (tag, id, classes,
role, aria label, a unique selector, the selected text, which app and window)
and offers "Copy reference", "Explain…", and "Modify…"; the last drafts
`Change REF-… to ` into the current chat with the JSON attached, and the agent
greps the app's source for the id and classes
([research](../../research/imbue-studio/architecture.md), section 4).

Bee Box has the pieces for a narrower, better-addressed version:

- Selections already carry "what the user is pointing at" to the agent
  (`beebox/src/frontend/src/lib/selection/`).
- A box-authored view is one compiled file hanging off one card
  (`beebox/src/webapp/views/compiler/`), so the reference can name the view
  file and the card path directly instead of a DOM dump.
- The agent-points-at-ui plan (`beebox/docs/plans/agent-points-at-ui.md`) is
  the reverse direction and shares the link vocabulary.

Proposal: on a box-authored view or a card renderer, a context-menu entry
"Modify this view…" (and "Explain…") that opens chat with a selection token
naming the view, the card, and the clicked element's text. Not on the app
shell: boxes hold no app code (`beebox/docs/box-layout.md`), and Studio's own
starters show the drift cost of letting the agent patch the shell.

Tension: the "boxes contain no app code" rule is why the menu stops at views,
and views are a security-sensitive surface
(`beebox/docs/implemented-plans/card-view-widgets.md`). The menu must not
widen what a view can do; it only shortens the path to the file.
