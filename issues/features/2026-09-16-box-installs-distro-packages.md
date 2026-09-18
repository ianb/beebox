---
title: "A box cannot install distro packages; the boxholder must run apt by hand"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — production box feedback triage (bbx feedback)
---

A box agent was asked to make label PDFs with gLabels, which is in the distro
repositories. It was not installed. The box user has no sudo, so the only path
was to ask the boxholder to run `sudo apt install glabels` on the host. The
same need came up in the same week for `file` and for poppler/imagemagick
delegates.

The boxholder's position: "installing packages is something I think a box
should be able to do. Distro packages are generally very safe."

## Suggestion from the box agent

- A command such as `bbx host install <pkg>`.
- A sudoers rule that allows only `apt-get install` from the distro
  repositories: no third-party sources, no arbitrary commands.
- Log each request and result, and show additions in `bbx health` or on a
  card so the boxholder sees what changed.

## Why this beats adding each package to the deploy list (2026-09-17)

The boxholder first proposed adding gLabels to the standard deploy packages,
then chose to build the general ability instead. What the specific route would
have cost:

- `beebox/deploy/hetzner/setup-server.sh:33` installs the package list, but it
  runs only at provisioning. An existing server needs the package installed by
  hand anyway.
- `beebox/deploy/deploy.sh:806` then checks each declared tool on every deploy
  and FAILS the deploy when one is missing. So adding a package to the list
  without installing it first breaks deploys.
- Every one-off tool a box wants becomes a permanent entry in a shared
  fleet-wide list, installed on every server whether or not any box uses it.

## macOS has no gLabels (2026-09-17)

Verified: `glabels` 3.4.1-4build3 is available on the server's distro and is not
installed. Homebrew has no `glabels` formula or cask. So a
distro-package command cannot be mirrored on a self-hosted macOS box, and a
box's capability would differ by host. This is the "other distros or macOS"
open question below, with one confirmed case.

## Open questions

- Packages are host-wide, and one server hosts several boxes. One box's
  install changes every box's environment.
- Self-hosted installs on other distros or macOS need a different backend or
  no support.

Related: [Python libraries for boxes](2026-09-16-box-python-library-path-and-policy.md),
[sandboxed trick helpers](2026-09-16-sandboxed-trick-helpers.md),
[installation remaining work](2026-07-19-installation-remaining-work.md).
