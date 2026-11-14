---
title: "`window.test.ts` and `codex-runtime.test.ts` are red after the install-then-switch deploy change"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — full suite after the Agent SDK 0.3.325 bump
labels: [test-failure]
---

Two deploy tests fail on current main every run, alone and in the full suite:

- `beebox/test/deploy/window.test.ts` (6 of 22 fail): the generated
  `activate.sh` stops with `line 18: INSTALL_DIR: unbound variable`.
- `beebox/test/deploy/codex-runtime.test.ts` ("The CLI and SDK versions are one
  lockstep contract"): it looks for the literal
  `ln -sf /opt/beebox/node_modules/.bin/codex /usr/local/bin/codex`, and
  `deploy.sh:862` now says `ln -sf "$INSTALL_DIR/node_modules/.bin/codex" …`.

Both follow `3e7cb127f` ("deploy: install each release before the stop, then
switch", 2026-11-13), which moved the install to a per-release `INSTALL_DIR`.
The `window.test.ts` failure may also mean the activation step reads
`INSTALL_DIR` without it being set on some path, which would fail a real
deploy, not only the test; the owner of that change should check which. The
Codex test only needs its expected line updated if the symlink is right.

The SDK bump that surfaced these touches neither file. Related, already filed:
`issues/bugs/2026-11-13-cross-box-probe-box-install-test-fails-on-mac.md`.

Reproduce, from `beebox/`:
`npx tap --disable-coverage test/deploy/window.test.ts test/deploy/codex-runtime.test.ts`.
