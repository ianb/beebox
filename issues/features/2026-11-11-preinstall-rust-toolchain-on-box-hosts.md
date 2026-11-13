---
title: "Preinstall a current Rust toolchain on box hosts, so a box agent can build Rust programs"
workstream: unattached
area: beebox
labels: [box-host, tools]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — klad install question, 2026-11-11"
---

Box agents cannot build Rust programs out of the box. Neither the Docker image
(`beebox/docker/Dockerfile`, Debian bookworm) nor the server
(`beebox/deploy/hetzner/cloud-init.yaml` and `setup-server.sh`, Ubuntu 24.04)
has `rustc` or `cargo`. The distro packages are too old for most current
projects (bookworm ships 1.63), and `bbx host install` installs only distro
packages. An agent could run rustup into its own home, but each box would
then download and keep its own toolchain. The boxholder wants a good
toolchain preinstalled.

The case that raised it: [klad](../exploration/2026-11-11-look-at-klad-shared-human-agent-painting.md)
builds only from source and pins the current stable channel.

## What to decide and build

- **Where it lives.** One shared, root-owned toolchain (for example
  `RUSTUP_HOME=/opt/rustup`, read-only to box users), installed by rustup at a
  pinned version with its checksum checked, like
  `beebox/deploy/install-restic.sh`. Each box gets its own `CARGO_HOME` (the
  registry cache, `cargo install` output) in its home, so boxes share no
  writable state.
- **Both hosts.** The Docker image and the server provisioning (cloud-init,
  `setup-server.sh`, and a deploy step for existing servers) install the same
  version.
- **Updates.** Who bumps the pinned version and how often; the
  `sdk-update` schedule's ledger is one model.
- **C build tools.** Many crates need a C compiler, `pkg-config` and
  `-dev` libraries. The server has `build-essential`; the runtime image does
  not. Decide whether the image gains it, or whether `bbx host install`
  covers it per box.
- **Agent contract.** Add `cargo`/`rustc` to the "always available on the box
  host" list in `beebox/src/core/agent-guide/chat.ts`, and say where
  `cargo install` output goes and that it must be on the box's `PATH`.
- **Limits.** A Rust build of a sizable project uses several GB of memory and
  disk, and needs egress to crates.io and static.rust-lang.org. Check both
  against the per-box memory limits and egress rules, and say what an agent
  sees when a build hits them.
- **Image size.** A minimal-profile toolchain adds a few hundred MB to the
  image; measure it.

Related: [Python libraries have no documented path](2026-09-16-box-python-library-path-and-policy.md),
the same question for another language;
[box agents install distro packages](../../beebox/docs/implemented-plans/box-host-packages.md).
