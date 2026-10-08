---
title: "System themes define their own text selection colors"
workstream: unattached
area: beebox
labels: [themes, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

Selecting text anywhere in the app shows the browser's default highlight.
The system themes (`paper`, with its `manila` and `blue` stocks; `plain`;
`spectrum`) set the chrome's colors and materials in
`beebox/src/frontend/src/themes/chrome.css`
(`.bbx-box-presentation[data-chrome-theme=…]`), but none sets `::selection`;
nothing in `beebox/src/frontend/src/themes/` or `index.css` does. The
boxholder wants each system theme to choose an explicit selection color, and
a distinctive one: "Novel selection colors are hot!"

## Wanted

- A selection background and text color per system theme (and per paper
  stock where it differs), defined as theme tokens in `chrome.css` and
  applied with `::selection` under the theme's selector.
- Distinctive, theme-appropriate choices rather than a tinted default. Ideas
  to try: a highlighter-marker yellow on paper, a carbon-paper or blue-pencil
  tone on manila, a strong saturated hue on spectrum, a quiet but clearly
  intentional tone on plain.
- Legible: selected text keeps WCAG contrast against its selection
  background, in both light and dark presentations.
- Check the places selection matters most: chat messages, Markdown cards, the
  composer, and code blocks; and that card themes (`card-themes.css`), which
  can set their own surfaces, still read correctly inside a selection or
  override it where they need to.

Show the choices as one exhibit (`decide`) with a screenshot per theme before
landing, since this is a taste call.

## Decision (boxholder, 2026-10-07)

Both system themes and card themes can set selection colors. Both are
optional: a card theme without its own selection colors inherits the system
theme's, and a system theme without them falls back to a sensible default.
Choose good colors for every existing system theme and card theme.
