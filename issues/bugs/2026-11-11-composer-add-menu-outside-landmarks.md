---
title: "Composer add menu renders outside every landmark (axe region)"
workstream: unattached
area: beebox
labels: [tours, a11y]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261111-153355
---

When the composer's add menu (Capture, Add files, Send screenshot, Share
location) is open, axe reports `region` (moderate): "All page content should be
contained by landmarks". The node is the menu panel itself:
`<div role="menu" class="bg-white rounded-lg … shadow-lg" style="position: fixed; …">`.
`Dropdown` (`beebox/src/frontend/src/components/ui/Dropdown.tsx`) renders the
panel through `createPortal`, so it sits outside `main` and the other
landmarks.

All four tours that open this menu report it, at both viewports.

## Evidence

- `new-chat` `add-menu`:
  `beebox/test/tours/.artifacts/new-chat/2026-11-11T22-03-27-522Z/add-menu.desktop.axe.json`
- `bloom-theme` `bloom-composer-menu`:
  `beebox/test/tours/.artifacts/bloom-theme/2026-11-11T22-05-27-533Z/bloom-composer-menu.mobile.axe.json`
- `deck-theme` `deck-composer-menu`, `ribbon-theme` `ribbon-composer-menu`
  (runs `2026-11-11T22-07-21-253Z`, `2026-11-11T22-14-38-964Z`).
