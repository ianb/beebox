---
title: "Let a box author validated visual themes"
workstream: unattached
area: beebox
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — discussing whether the box agent can author themes
---

When a box develops its own character, the agent should be able to express
that character in the box's visual surfaces. The developer should be able to
ask for a new stock or revise a palette without changing the Bee Box frontend
or shipping executable code.

The current presentation config selects themes that the application registers.
It does not let a box define a new theme. Explore a box-local, data-only theme
format for card and system surfaces. A theme could define approved tokens such
as colors, paper stocks, texture references, radii, shadows, typography, and
component variants. The application would validate those values, scope them to
the box, and render them through the existing theme components.

The boundary must remain explicit. A box-authored theme should not inject
arbitrary CSS, JavaScript, network requests, or markup into the application.
Theme data should have a stable fallback when it is invalid or unavailable.
The format should also work with landmark-level preferences and theme refs;
see [system-theme preferences as refs](2026-09-08-system-theme-preferences-as-refs.md).

## Design questions

- Which tokens are safe and expressive enough for a first version?
- Are themes stored in box config, as cards, or as a registered theme reference
  with data beside it?
- How does an agent preview and revise a theme without making the whole box
  unreadable?
- Which components must have explicit theme contracts: cards, tabs, folds,
  blockquotes, system chrome, chat, composer, and selection controls?
- How should theme data migrate, inherit, and fall back across boxes and
  landmarks?
- Does the public site need a separate export of these theme tokens?

## Research (incomplete)
