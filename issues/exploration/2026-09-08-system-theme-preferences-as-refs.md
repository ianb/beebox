---
title: "Explore system-theme preferences as refs"
workstream: unattached
needs: [design, decision]
next-action: discuss
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — discussing landmark system-theme preferences
---

The current landmark system-theme preference stores a built-in theme choice
inline in landmark frontmatter:

```yaml
system-theme:
  name: paper
  stock: manila
```

The developer likes the idea of making this preference a ref. The target of the
ref is not decided. It could point to a theme definition card, a reusable
theme preset, or another catalog entry. These choices have different editing,
scope, and fallback behavior.

## Job to be done

When several landmarks should share one system appearance, I want to refer to
one named theme definition, so I can change the appearance once and have the
landmarks follow it.

When I am editing a landmark, I want the preference to remain easy to inspect
and change, so a ref must not make the active appearance opaque.

## Current behavior

The owner can choose built-in system themes in **Settings → System theme** and
override one landmark in **Properties → System theme**. An agent can edit the
landmark YAML directly. The resolver uses the nearest active landmark override,
then the box `presentation.chrome`, then the built-in Flat theme. A landmark
without an override inherits the box theme.

## Questions to resolve

- What does the ref identify: a theme card, a named preset, or a built-in
  catalog choice?
- Does a referenced theme inherit the current landmark's context, or does it
  carry its own complete system appearance?
- Can users choose refs from Properties, or is this an agent/file-authoring
  operation with a read-only effective-theme display in the UI?
- How do deleted, invalid, or inaccessible referenced themes fall back?
- Does updating a referenced theme refresh all active landmarks immediately?
- Do refs apply only to system themes, or should card appearance preferences use
  the same mechanism later?

## Research (incomplete)

