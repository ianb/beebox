# Phase 1: a menu-bar app that runs the image (2026-09-30)

Follows [phase 0](phase0-apple-container.md). A SwiftUI menu-bar app
(`mac-app/`, about 440 lines of Swift) embeds Containerization 0.48.0 directly — no
`container` CLI, no Docker — boots the existing beebox image in a VM, and
serves a box from a Finder-visible folder. Tested on the boxholder's Mac
(Apple silicon, 16 GB, macOS 26.5.2), ad-hoc signed with only the
`com.apple.security.virtualization` entitlement.

## What it does

On launch it loads the image into its own store (first run only), creates
the box with `bbx engine init` if the folder is empty, boots the server in
a VM, waits for HTTP, and offers Open Box, Open First-Run Setup (the
one-time link parsed from the server log), Show Box Folder, Show Log,
Start/Stop, and Quit. The menu shows VM memory from the framework's
container statistics.

## Results

| Check | Result |
|---|---|
| Build | Clean under Swift 6.3 strict concurrency; 50 MB release binary. First dependency fetch + build ~3 min |
| Entitlements | Only `com.apple.security.virtualization`; Apple's own network plugin carries the same one, nothing restricted. Developer ID signing covers it |
| Cold start (load image, create box, serve) | 23.3 s from launch to HTTP ready |
| Warm start (box exists) | 13.8–15.4 s |
| Box folder | `~/BeeBoxSpike/box`, a normal git repo on the Mac side |
| Graceful stop (Quit or SIGTERM) | Server logs "Received SIGTERM… Server closed.", exits 0; whole stop 0.1–0.2 s |
| App killed with SIGKILL | The VM goes down with it; no orphaned VM, no stale git lock |

## Memory

Host cost is the VM process's physical footprint, measured with `footprint`:

| VM size | Footprint while serving idle | App process |
|---|---|---|
| 4 GiB (default on 16 GB Mac) | 1,134 MB | 132 MB |
| 1.5 GiB | 966 MB at ready, 970 MB after a minute idle | — |

Where it goes, from inside the VM (phase 0 measurements, same image):

- Node server: ~273 MB.
- A pre-warmed `claude` chat subprocess: ~217 MB.
  `bbx serve` sets `prewarmChat: true` (`beebox/src/cli/commands/serve.ts:186`)
  to save 0.6–2 s on the first chat message.
- Linux page cache and kernel: the rest.

The framework does not configure a memory balloon, so the Mac never gets
pages back once the guest has touched them. The footprint is the guest's
high-water mark. Levers, cheapest first:

1. **Cap the VM at 1.5–2 GiB.** Serving works at 1.5 GiB. Not yet tested:
   an agent run (each chat spawns another `claude` process of ~200–300 MB)
   under the cap.
2. **Pre-warm the chat subprocess only when a chat page opens**, or make it
   configurable for packaged installs: about −217 MB idle.
3. **Balloon support.** Virtualization.framework offers a traditional
   balloon device; Containerization does not wire it. That is an upstream
   change or a local fork.

## Problems found and fixed in the spike

- **SIGTERM deadlock.** A SIGTERM handler on the main dispatch queue that
  calls `NSApp.terminate` hangs: `terminateLater` waits on a stop task that
  needs the same queue. The handler now stops the VM and exits directly.
- **`LinuxContainer.stop()` SIGKILLs every process.** The app now sends
  SIGTERM, waits up to 20 s for the server to exit, then stops the VM.
  Without this the server cannot finish in-flight git work.

## Found during the boxholder's hands-on test (2026-09-30)

- **Accounts lost on restart.** Accounts, secrets, and the session key live
  in the container user's home, which the app recreated on each start
  ([container-loses-machine-state-on-recreate](../../issues/closed/bugs/2026-09-30-container-loses-machine-state-on-recreate.md);
  the Docker install has the same gap). The app now mounts a `machine`
  folder and sets `BBX_AUTH_FILE` / `BBX_SECRETS_FILE`; the session key has
  no override, so a restart still signs everyone out.
- **Claude sign-in through Admin → Agents works inside the VM.** The first
  chat before that showed CLI-only advice
  ([agent-login-onboarding-in-web](../../issues/closed/features/2026-09-30-agent-login-onboarding-in-web.md)).
- **Quit took two clicks** (`terminateLater` left the app running after the
  box stopped). Quit and SIGTERM now stop the box and exit directly.
- **A restart waited 5 minutes.** Quitting right after a chat turn: the
  server printed "Received SIGTERM" but not "Server closed." within the
  app's 20 s shutdown timeout, was SIGKILLed, and left a box-work lease in
  `.git/bbx-maintenance/work/`. The next start's maintenance step waited for
  the lease to go stale (`LOCK_STALE_MS.default`, 5 min) before serving,
  with no output. An idle box stops in 0.3 s with no leftovers. The timeout is now
  60 s and the exit time is logged.
- **The slow stop was the spike's own port forwarder** (found 2026-10-04).
  `stop()` released the forwarder before signalling the server; the relay
  loop held only a weak reference and stopped, so the server's WebSocket
  close frame never reached the browser and `ws` waited its 30 s
  `closeTimeout`. With a browser attached: 30.0 s before the fix, 3.1 s
  after. The same server natively, or reached at the VM's address, stops in
  0.0–0.1 s; beebox itself is not at fault.
- **Menu icon** now distinguishes stopped (outline box), starting/stopping
  (hourglass), serving (filled box), and failed (warning).

## Gaps before this is an app for other people

- **Stable address — fixed in the spike, and required.** The VM gets a new
  IP on every launch (192.168.64.3, 65.2, 66.2 across three launches). The
  VM address is also not a browser secure context, so `crypto.randomUUID` is
  undefined and the web UI hangs on "Loading Bee Box…" right after sign-in
  (`beebox/src/frontend/src/components/chat/conversation/use-conversation-machine.ts:40`).
  The app now forwards `127.0.0.1:3280` to the VM (`PortForwarder.swift`,
  raw TCP so WebSockets pass). The boxholder signed in and sent a chat
  message through it.
- **Image delivery.** The spike loads a locally exported OCI layout and
  borrows the kernel and initfs the `container` CLI downloaded. An app pulls
  a published image and bundles a kernel and initfs.
- **Rootfs per start.** Each start unpacks the image into a fresh 8 GiB
  root filesystem. Apple's `sandboxy` example unpacks once and `clonefile`s
  per start; that also keeps packages from `bbx host install`.
- **Logins.** Claude and Codex logins are URL + pasted code in a terminal;
  the app needs a flow for them. The image also lacks `codex` on PATH, `qpdf`,
  and Docling
  ([docker-image-missing-qpdf-and-docling](../../issues/closed/bugs/2026-09-29-docker-image-missing-qpdf-and-docling.md)).
- **Not tested:** an agent run, sleep and wake, launch at login, a proper
  `.app` bundle, Developer ID signing and notarization, Tailscale in the
  image.

## Where this leaves the options

The [README](README.md) put "a Mac app over a Linux VM" as later work. The
spike moves it from speculative to demonstrated: one runtime (the published
image), containment kept, a Finder-visible box, and clean start and stop. The
remaining cost is ordinary app work plus the shared prerequisites (published
image, release channel, in-browser logins) that the NAS route needs too.
