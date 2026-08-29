---
title: "Installation: what's verified, what still needs testing, what's not built yet"
workstream: install-remaining
design: ../../callback-box/docs/plans/installation-story.md
needs: [manual-testing]
priority: important
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

## Ledger (2026-08-29, `install-remaining`)

Per item: what the workstream verified by execution, what still needs the
boxholder's hands, and the exact ask. The boxholder clears `manual-testing`
per item; nothing here is cleared by the agent.

| # | Item | Agent-verified | Boxholder step | Status |
|---|---|---|---|---|
| 1 | ACME / Let's Encrypt | compose + Caddyfile path re-run via `smoke-vps-install.sh` (internal CA) | follow "Checklist: proving a fresh public deployment" in `docs/docker-install.md`; paste the `certificate obtained` line + two `curl -sI` first lines | **blocked on you** (~30 min, VPS + A record) |
| 2 | Tailscale-only | sidecar overlay `docker/compose.tailscale.yaml` + `tailscale-serve.json` validate with `docker compose config`; host-daemon path unexercised | (a) sidecar: put `TS_AUTHKEY=` in `docker/.env`, run the overlay command in the doc, open `https://<hostname>.<tailnet>.ts.net/`; (b) host-daemon: `cb serve` a scratch box, `cb tailscale setup --target <port>`, then `cb tailscale stop` | **blocked on you** (5 min + 2 min) |
| 3 | `claude auth login` in-container | CLI in the image prints the sign-in URL and blocks on stdin for the page's code (probe, no real login); doc rewritten for the code step | `docker compose run --rm box claude auth login`, open the URL, paste the code; then `docker compose run --rm box claude auth status`. Separately: laptop `claude setup-token` → `.env` → `docker compose up -d` → `auth status` | **blocked on you** (3 min each) |
| 4 | macOS/Homebrew | every brew formula / pip name in the doc resolves; `pnpm run doctor` passes on a maintained Mac | decide whether a factory-fresh Mac walkthrough is worth doing; doc now states the exact status | **decision** |
| 5 | Windows/WSL2 | — | stance written into `developer-install.md` ("native unsupported; WSL2 = Linux path, unwalked"); confirm or change | **decision** |
| 6–11 | not-built rungs | — | each is its own decision-then-build; 11 (root README front door) is the cheap one and unblocks nothing else; 6 (npm publish + image) is the real gate to turnkey | **unchanged** |

Harness re-run on today's main (Node 24, Claude Code 2.1.251), 2026-08-29:

- `smoke-dev-install.sh` — PASS (186s); doctor 13/14 with only "Claude auth"
  failing, as asserted.
- `smoke-docker.sh` — FAILED on first run: the image build's `pnpm add`
  allowlist lacked `@googleworkspace/cli` (a postinstall-script dependency
  added since July; pnpm 10 makes an unapproved build a hard error). Fixed
  in the Dockerfile and in the same list in `scripts/smoke-external-box.ts`
  / `scripts/smoke-upgrade.ts`. Result after the fix: see below.
- `smoke-vps-install.sh` — FAILED on first run at the in-dind `git clone`
  (EACCES copying a pack from the read-only source mount under Docker
  Desktop 29). Fixed with `--no-local`. Result after the fix: see below.
- `pnpm smoke` (`scripts/smoke-external-box.ts`, the release-tarball anchor)
  — FAILED on first run, four ways, all pre-existing drift since July and
  all fixed: (1) under `pnpm run` the parent's `npm_config_*` env leaked
  into the box's own `pnpm install`, which exited 1 silently — child steps
  now get a stranger's env; (2) the tarball didn't ship
  `src/core/views/types.ts`, so `cb view typecheck` failed in every
  installed box — the three-file type closure is in `files` now; (3) the
  box-health probe still used the pre-slug-derivation `/content/` URL;
  (4) it didn't send the diag bearer key the always-on auth wall requires.
  Result after the fixes: PASS.
- Claude CLI in the image (2.1.251): `claude auth login` prints
  `https://claude.com/cai/oauth/authorize?...`, then blocks at
  `Paste code here if prompted >`; a wrong code prints `Invalid code` and
  keeps waiting. `claude setup-token` still exists. Doc rewritten to match.

## Manual testing

Follow the concrete reproduction or verification steps above. Confirm the
observed result matches the expected behavior described in this issue before
clearing the manual-testing flag.
