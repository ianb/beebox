---
title: "Enable knip's `exports` check and burn down the backlog"
workstream: knip-exports
---

2026-07-04 · backlog. **Substantially done 2026-08-24 — two decisions left.**

The `exports` check is on (`knip.ts`, monorepo root) and the backlog is
cleared: **651 → 2**. Doctests, tests, `bin/`, the frontend and the box-facing
specifiers all count as consumers now, so the number means something; the
dependency and binary noise that made `pnpm lint:knip` exit non-zero
regardless is gone too. It runs weekly rather than as a commit gate
(`2026-08-24-run-periodic-sweeps-weekly.md`), and `docs/maintenance.md` says
the output should be empty — so these two lines are the only thing standing
between the sweep and a clean baseline:

- **`loadPersistedChatModel`** (`callback-box/src/core/chat/session/state.ts`)
  — no caller. Behaviorally a one-liner over
  `loadCurrentModel(boxRoot, DEFAULT_MODEL_FILE)`, so deleting it loses no
  capability. Held back only because it is named as a landmark in two open
  issues (`2026-07-17-chat-model-pin-default`,
  `2026-08-08-reactor-agent-model-not-pinnable`); deleting it strands those
  references.
- **`addUserWithPasswordHash`** (`callback-box/src/webapp/local-users.ts`) —
  no caller, but `docs/plans/google-owner-member-credentials.md` and
  `docs/plans/operator-member-password-reset.md` both describe it as
  implemented mechanism. That reads more like a flow that was never wired than
  like dead code, which is a question rather than a deletion.

Either can be deleted on a word, or kept with a `@public`-style tag naming why.
