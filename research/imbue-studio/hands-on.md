# Hands-on: Studio from source on a Mac (2026-10-08)

Run from the public `imbue-ai/mngr` checkout on macOS 26.5, Apple silicon,
16 GB, no Docker installed. The boxholder drove the Electron window; the
research session read the host log and the VM. What the UI looked like was
not captured, so this note is timings, footprint, and what the workspace did.

## Setup

- Prerequisites as `apps/minds/docs/dev-setup.md` says: uv, git, Node 24.15.0
  under nvm, pnpm 10.33.4 (both pinned and enforced). `scripts/start-desktop.sh`
  installs the Electron dependencies, downloads pinned binaries into
  `~/.cache/minds/binaries/` (dugite git, restic, desync, Lima 2.0.3, the
  latchkey curl shims), builds the Mithril UI, syncs the Python venv, and
  launches. About six minutes to the login screen. No Imbue account was
  needed; the app "targets production", meaning it reads a `client.toml`
  naming Imbue's connector, LLM proxy, and accounts host, and uses them only
  for cloud and sharing features.
- **Snag:** the first two creates failed in seven seconds each with
  "Unknown provider backend: lima" (then "vultr"). The provider plugins are
  workspace packages that a plain `uv sync` leaves out; `uv sync
  --all-packages` fixed it with no restart, since each create spawns `mngr`
  fresh. The docs do not say this.
- **Phone-home:** both failures uploaded diagnostic bundles to Imbue's
  Sentry bucket (`minds.log`, the event streams, the latchkey logs, the
  Electron log). The upload is gated by the `report_unexpected_errors`
  setting, which the start flow's consent screen had left on.
- Chrome could not be used to drive the UI: the harness refused to open the
  one-time login URL, and there were no desktop-control tools in the
  session. The backend does serve the same UI to a plain browser.

## The first workspace

Lima mode (the Mac path; Docker was not installed). The VM is sized by the
template: 2 CPUs, 4 GB, 20 GB boot disk.

| Step | Time |
|---|---|
| Clone of the template at tag `minds-v0.8.5` | seconds |
| Debian 13 cloud image from `apt.imbuepackages.com` | 12 s (not the prebuilt workspace image; the toolchain built in the VM) |
| Lima VM READY | 2 min after clone |
| Create done, workspace open | 365 s |

Footprint afterwards: 7.6 GB under `~/.lima`, 284 MB under `~/.cache/minds`,
VM process about 1.2 GB resident on the host; inside the guest 1.1 GB used of
3.9 GB and 5.3 GB of the 20 GB disk. Sixteen supervisord programs running at
boot: the shell, chat, terminal and its pty, the dufs file viewer over `/`,
a Chromium fleet on Xvfb, Getting Started, `mngr observe`, cron, earlyoom and
its backstop, env-converge, host-backup, share-gateway, owner-exec.

## First task

The boxholder signed in to Claude (the chat record shows harness `claude`,
lane `anthropic`, account bound at 13:15:43) and asked for a mortgage
calculator.

| Event | Time |
|---|---|
| Chat agent started | 13:15:43 |
| "Add mortgage calculator app (first version)" committed | 13:18:25 |
| A second commit changing the default figures | 13:25:52 |

What the agent produced is the `build-app` scaffold: a uv package under
`system/apps/mortgage_calculator/` with a Flask runner, one HTML asset, an
icon, a ratchet test, a README, and an `app.toml` (557 lines in all), its own
supervisord drop-in, a registry row on port 8080 with
`stop_when_no_windows = true`, and four `wor-step-*` changelog entries, which
are the `tk` steps the progress timeline showed. The boxholder's impression
of the chat: "it seems competent", which prompted [chat-app.md](chat-app.md).

## Not exercised

Right-click Modify…, the permission dialog, a starter template install, the
Windows 95 theme change (the critical-app preview-and-apply flow), the
Codex handoff, sharing. The workspace and VM were left running at
`~/src/imbue-studio/`; `limactl shell minds-host-<id>` opens it.
