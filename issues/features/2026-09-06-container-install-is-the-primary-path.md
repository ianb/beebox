---
title: "Make the containerized setup the primary way a new user installs"
workstream: unattached
area: docs
priority: important
labels: [soft-launch, install]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "Make sure the containerized setup is the primary way new users set it up"
---

The boxholder's direction (2026-09-05): a new user's first install is the
container path. Today the docs present the paths as peers, with the
from-source developer install listed first: the root README names
`developer-install.md`, then `docker-install.md`, then the agent-facing
guide; the soft-launch posture
(`../decisions/2026-07-20-soft-launch-posture.md`) recorded "local run
first-class; one blessed deploy happy path (Docker/compose + optional
Caddy)". This item settles the order: container first, from-source is the
contributor path.

What follows from it:

- The README front door and the docs the `launch-docs` session is writing
  lead with `docker compose up`; the from-source guide moves under "for
  contributors."
- `beebox/docs/docker-install.md` becomes the path a stranger actually
  walks, so its remaining unverified steps in
  `2026-07-19-installation-remaining-work.md` (real ACME issuance, the
  in-container `claude auth login` flow, Tailscale-only) move up in
  priority, and its rung 6 (a published image so the start is a three-line
  compose file rather than a clone-and-build) is what "primary" eventually
  requires.
- The Codex engine must work in the container the same as Claude
  (`codex login --device-auth` in-container; the README now says both are
  supported).
- Any doc, tour, or first-run screen that assumes a checkout on the host
  gets re-read from the container user's chair.

Not this item: the update story (`../decisions/2026-07-20-release-discipline-and-update-story.md`),
which the container path makes more pressing but which is its own decision.
