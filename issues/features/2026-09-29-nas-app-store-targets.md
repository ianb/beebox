---
title: "Package the published image for NAS and home-server app stores (Umbrel, TrueNAS, Synology)"
workstream: unattached
area: beebox
labels: [install]
filed-by: agent
discovered-in: worktree-installable-app — installable-app research
design: ../../research/installable-app/README.md
priority: backlog
---

A box that a phone reaches all day needs an always-on host. A laptop is not
one. Umbrel, TrueNAS SCALE (24.10+), Synology Container Manager, and CasaOS
all run compose projects, and Umbrel ships Tailscale as a store app. Each
target is a small manifest over the existing image
([packaging options](../../research/installable-app/packaging-options.md)).

Blocked on a published image (item 6 in
[installation-remaining-work](2026-07-19-installation-remaining-work.md)) and
on the [release and update decision](../decisions/2026-07-20-release-discipline-and-update-story.md):
a store entry points at a tag, and store users update by pulling it.

Open: how `claude auth login` and `codex login --device-auth` run on a NAS
with no terminal the user knows how to open. The box's admin UI may need to
drive those flows (show the URL, take the pasted code) for any appliance
target. That is the same need a future desktop app would have.
