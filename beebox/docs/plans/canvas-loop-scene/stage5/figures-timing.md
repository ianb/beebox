# Stage 5 (c): box figures on a VM like the server

Notes for C5 of `beebox/docs/plans/canvas-loop-box-figures.subplan.md`. This
first half answers one question before C1 is committed: does Dawn find an
adapter on Mesa's software Vulkan driver on the server's OS and on the Docker
image's base? The timing on the final code, the chemistry port and C2's Linux
no-driver case come in the second half.

## Setup

- Lima VMs on the Mac, aarch64, 3 CPUs and 4 GB (the example `cpx21`), no
  GPU: `c5-noble` (Ubuntu 24.04), `c5-bookworm` (Debian 12), `c5-trixie`
  (Debian 13). Each is stopped, not deleted, for the second half.
- In each: `mesa-vulkan-drivers` from the distro, Node 24.18.0, and beebox
  installed from the release tarball with `pnpm add`, as the Docker image
  installs it. The tarball was built from the C1 draft, so it declares
  `webgpu` 0.6.2.
- Then `src/scripts/dawn-probe.ts` against the installed engine, a fresh box
  (`bbx engine init`), the canvas-loop starter (`bbx create … runtime=canvas-loop`),
  and `bbx figure run` on it three times, each a new process. The first run
  has an empty Mesa shader cache.
- Scripts and logs: `scratch/stage5/c1/` (`vm-setup.sh`, `vm-run.sh`,
  `vm-*-run.log`).

## Results

| OS | Mesa (LLVM) | Probe | Starter, 120 frames, 5 captured | Peak RSS | Shader cache |
|---|---|---|---|---|---|
| Ubuntu 24.04 | 25.2.8-0ubuntu0.24.04.4 (LLVM 20.1.2) | `llvmpipe`, type cpu | pass; 0.90 s cold, then 0.55 s | 438 MB cold, then 330 MB | 1.4 MB |
| Debian 12 bookworm | 22.3.6-1+deb12u2 | **no adapter** | **fails**: "no GPU adapter" | — | none |
| Debian 13 trixie | 25.0.7-2+deb13u1 (LLVM 19.1.7) | `llvmpipe`, type cpu | pass; 0.97 s cold, then 0.54 s | 420 MB cold, then 307 MB | 1.9 MB |

Times are wall time for the whole `bbx figure run`. Peak RSS is GNU `time`'s
figure, which includes the `run-one` child. Frames from Ubuntu were checked by
eye: the starter's ring and dot.

**Bookworm fails.** Dawn rejects its lavapipe while it initializes the
adapter: *"Vulkan shaderUniform\*ArrayDynamicIndexing required"*
(`PhysicalDeviceVk.cpp:257`). Mesa 22.3's lavapipe does not offer that
feature, so Dawn reports no adapter. The probe and `bbx figure run` both say
so.

## Decision: the Docker image moves to trixie

`docker/Dockerfile` now builds from `node:24-trixie-slim` in both stages, as
C1 allowed. Bookworm cannot render figures at all, and trixie is the next
Debian release with an official Node 24 image. The Ubuntu 24.04 server needs
no change beyond `mesa-vulkan-drivers`.

Not verified here: building the image itself, and the rest of the runtime
package list on trixie (pandoc, ImageMagick, git-annex and the others).
`bbx-host-apt.smoke.sh`'s Debian flavour now uses `debian:trixie-slim` to
match; it was not re-run. C5's second half builds the image.

## Other findings

- **pnpm 12 and ignored build scripts.** `pnpm add` of the tarball, as the
  Dockerfile runs it, installed everything and then exited 1 with
  `ERR_PNPM_IGNORED_BUILDS` for `@google/genai`, `agent-browser`,
  `protobufjs` and `webgpu`. Corepack picks the latest pnpm (12.21.0 here)
  because `/app/package.json` names none. The first three predate C1; `webgpu`
  is new. `webgpu`'s script only clears a macOS quarantine flag, so it needs
  no build on Linux. The image build will stop at this step until the
  runtime install pins pnpm or lists these packages as ignored.
- **The probe's noise.** Dawn prints two lines to stderr about reduced
  dynamic-buffer limits, and on Ubuntu the Vulkan loader logs a failed
  PowerVR driver. `bbx-figure-gpu-install` shows the probe's output only on
  failure.
- **Not run here:** the deploy helper's `systemd-run` check as a box user,
  which needs a provisioned host (P1 and P2).
