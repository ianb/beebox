---
title: "Give box agents annotated screenshots of the app so they can explain the interface"
workstream: unattached
area: beebox
labels: [agent-guidance]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

A box agent knows the box's files and commands but has never seen the app.
When the boxholder asks "where do I find X" or "what is this button", the
agent can only guess at the layout. It cannot point to "the place pill at the
top left" or "Properties under the card title" with confidence.

## Wanted

A small set of sample screenshots of the main screens, each with a short text
description: what the screen is, its regions, the controls in each region,
and what they do. The agent reads the description and can view the image
when it needs the layout.

Candidate screens: the conversation view with the composer, the app bar and
place menu, a card page with Properties, the browse listing, the Landmarks
page, Admin and secrets, and phone layout for the conversation and a card.

## Questions

- **Where it lives.** Box agents load guidance from `beebox/docs/box/`
  (installed into boxes). Images there grow every box; check the size, or
  ship them in the engine package and reference them by path. Placement and
  the one-line pointer follow the bbx-context skill.
- **Keeping them current.** Screenshots go stale as the UI changes. The
  browser tours (`beebox/test/tours/`, walked weekly by the `tour-check`
  schedule) already drive these screens; they could also regenerate the
  screenshots, with a check that flags a description whose screen changed.
- **Which box content appears.** Screenshots must come from stock test
  content (test1 fixtures), never a real box, because they ship publicly.
- **Text first.** The descriptions may carry most of the value at a fraction
  of the context cost; images are for when the agent must see the layout.
  Measure with a knowledge audit: ask a box agent interface questions with and
  without the material.

Related: [agent documentation](2026-09-12-agent-documentation.md) (the public
corpus a chatbot can be pointed at) could include the same pages.
