---
title: "Installation: what's verified, what still needs testing, what's not built yet"
workstream: unknown
design: ../../callback-box/docs/plans/installation-story.md
needs: [manual-testing]
---

Leave-off marker for the installation effort (2026-07, the
`installation-process` worktree). Phase 1 shipped and is on main; this item
tracks the remainder so it doesn't live only in the plan doc's rollout
section.

## Where things stand (done, verified by execution)

- From-source developer install: `callback-box/docs/developer-install.md`,
  verified end-to-end from a bare `debian:bookworm` by
  `callback-box/docker/smoke-dev-install.sh` (~150s, re-runnable).
- Local/VPS Docker install: `callback-box/docker/` + `docs/docker-install.md`,
  verified through docker-in-docker (build → init → up → 200 → Caddy
  internal-TLS 200) by `callback-box/docker/smoke-vps-install.sh` (~170s).
- `pnpm run doctor` preflight (incl. the better-sqlite3 ABI-drift probe),
  Claude-auth run-path preflight, `.env.example`, agent-facing install guide
  (`docs/agent-install.md`). Node pin + `engine-strict` landed at 22, then
  deliberately bumped to 24 on main (`fae16368`) — the single-commit-upgrade
  mechanism working as designed.
- Closed as implemented:
  [cb-doctor-preflight](../closed/features/2026-07-12-cb-doctor-preflight.md),
  [docker-vps-install-path](../closed/features/2026-07-12-docker-vps-install-path.md).

## Still needs TESTING (real infra a container can't fake)

1. **Real ACME/Let's Encrypt issuance** — the Caddy `--profile public` path
   with a real domain, real DNS, public 80/443. Harness only proves internal
   TLS. One cheap-VPS afternoon.
2. **Tailscale-only variant** — documented in `docs/docker-install.md`,
   never exercised (needs a tailnet + auth key).
3. **Interactive `claude auth login` inside `docker compose run`** — the
   URL + paste-code flow in a TTY-attached container; believed to work,
   never completed for real. Also the documented
   `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` env-file fallback.
4. **macOS/Homebrew from-source path** — the harnesses exercise Debian/apt
   only; the doc's brew lines have never been run from a truly bare Mac.
5. **Windows/WSL2** — entirely unaddressed; the docs don't even claim it.
   Decide whether to support-and-test or state it's unsupported.

## Still needs CREATING (deferred rungs, with their triggers)

6. **npm publish + a published Docker image.** The gate to true turnkey: a
   real `pnpm dlx` five-minute start, and a clone-free
   `docker compose up` from a three-line compose file. Currently every
   path starts with cloning the monorepo and building from source.
   (Roadmap: `callback-box/docs/implemented-plans/boxes-as-packages-v2.md`
   distribution decisions; `source-available-release.md` NOT-in-scope.)
7. **curl|bash installer + `cb onboard` wizard** — the OpenClaw/Hermes
   pattern. Trigger: published package + evidence strangers stall on the
   quickstart. (Research: `research/openclaw-hermes/deep-installation.md`.)
8. **First-run web onboarding / admin key management + Track F remainder**
   (`source-available-release.md`): provider-key validate-on-entry probes,
   credential storage, cost guardrails. Boxholder call on pre- vs
   post-release scope.
9. **Hub-shaped multi-box compose.** Trigger: a real second-party
   multi-box need; single-box compose is the deliberate current shape.
10. **CI wiring for the smoke harnesses** — `smoke-docker.sh`,
    `smoke-dev-install.sh`, `smoke-vps-install.sh` are local-run only;
    nothing runs them automatically. Gated on CI existing at all
    (community-infra fast-follow in `source-available-release.md`).
11. **Track E stranger orientation** (`source-available-release.md`) —
    the root-README front door ("what is this / should I use it") and an
    honest five-minute start. Adjacent, cheap, everything it references
    now exists.

Items 1–4 are a single afternoon with a $5 VPS + a Mac; items 6–11 are
each their own decision-then-build. Nothing here blocks the
source-available drop except by the boxholder's own judgment.

## Manual testing

Follow the concrete reproduction or verification steps above. Confirm the
observed result matches the expected behavior described in this issue before
clearing the manual-testing flag.
