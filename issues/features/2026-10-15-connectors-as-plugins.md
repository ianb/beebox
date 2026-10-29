---
title: "Connectors as plugins"
workstream: unattached
area: beebox
labels: [plugins, connectors]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-plugins-planning — plugins slice 3, decided 2026-10-15
---

Plugins slice 3 sized three shapes for connectors and the boxholder chose
shape A: connectors stay core. See
[the slice 3 plan](../../beebox/docs/implemented-plans/plugins-slice-3.md),
sections *Smallest fix and budget* and *Open design questions*.

**Decided 2026-10-15 (boxholder):** connectors as plugins is wanted, just not
now. This issue holds the work until it is picked up.

The two shapes the plan sized:

- **Shape B: declarative connector plugins, code stays put.** A plugin file
  per connector names it (`connectors: ["gmail"]`); the engine resolves the
  name through the ordered registry in `src/connectors.ts`. Activation moves
  from the `googleServices` policy in `_config/box.json` to the `plugins`
  list, which is a box.json migration on every box and a rework of the admin
  toggles. Gain: one list of what is on in a box.
- **Shape C: move the code.** Gmail, Google Calendar and Google Drive move
  under `src/plugins/<name>/` with a runtime `connectors` hook on
  `PluginDefinition`. About 10,000 lines of connector code and 44 engine
  modules they import; the core commands and tRPC routers that import
  connector internals need a commands hook and a routers hook that do not
  exist. BIG CHANGE; it needs the public server surface first, which is a
  slice of its own.

Open: which shape, and whether a connector plugin is a third-party surface
(a feed, CalDAV, an `.ics` subscription) or only a way to list the Google
three. The medium/content line the boxholder drew ("intake is medium") argues
for keeping at least one source in core.

Related: [a calendar is a card with its events under it](../closed/features/2026-10-10-a-calendar-is-a-card-with-its-events-under-it.md).
