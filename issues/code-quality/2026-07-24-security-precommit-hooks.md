---
title: "Adopt openclaw-style security pre-commit hooks (dev-repo scope)"
workstream: chores-burn-down
area: callback-box
labels: [lint, security, openclaw-borrow]
filed-by: agent
discovered-in: worktree-openclaw-security-lints — surveying openclaw's .pre-commit-config.yaml
---

openclaw runs a battery of off-the-shelf hooks via the `pre-commit`/`prek`
framework. We use husky, so adopting these means adding husky-hook lines + a CI
step, **not** adopting `pre-commit`. Scope here is the **dev repo** (protecting
what we commit) — box-content linting is a separate track (see
[../features/2026-07-24-box-content-card-linting.md](../features/2026-07-24-box-content-card-linting.md)).

Approved to adopt (Ian, 2026-07-24):

- **`detect-private-key`** — blocks committing a private key. Trivial,
  high-signal; nothing today catches this (we have `path-leak-check`, the opt-in
  `commit-blocklist`, but no key guard).
- **`shellcheck`** — on `.husky/*` hook scripts + the handful of `bin/` shell
  scripts. Fits the bias-toward-strict shell default. Small surface, cheap.
- **`check-merge-conflict`** — blocks committing `<<<<<<<` markers. Basically free.
- **gitleaks** — general secret scanning (preferred over Yelp `detect-secrets`:
  no baseline-churn tax). Carries some false-positive cost; needs an allowlist
  strategy.
- **`pnpm audit --prod --audit-level=high`** — dependency-vuln gate. Belongs on
  **pre-push or CI/periodic**, NOT blocking every commit (network-dependent,
  noisy — would trip the "noisy output is a bug" rule). Can't wire until audit is
  green — see advisory status below.

### Advisory cleanup status (worktree-openclaw-security-lints, 2026-07-24)

Cleared via mature `pnpm.overrides` (all patches ≥7-day `minimum-release-age`):
`undici ^7.28.0` (prod, via cheerio — the important one), `hono ^4.12.27` (prod,
transitive), `js-yaml ^4.3.0`, `tmp ^0.2.7`. callback-box typecheck stays green.

Deferred — patched version is younger than our own 7-day maturity gate; forcing
it would install into the compromised-maintainer window (a worse trade than a
known, bounded advisory). Revisit ~2026-07-30 with a re-audit; they mature into
range on their own:
- `find-my-way >=9.7.0` (published 2026-07-21) — fastify router, prod.
- `fast-uri >=3.1.4` (2026-07-19) — fastify, prod.
- `brace-expansion` (5.x line needs >=5.0.7, published 2026-07-23) — glob-arg
  ReDoS, mostly build-time.

Deferred — different reason: `vite` high fix is `>=6.4.3` but our vulnerable copy
is `5.4.21` (via personal-vibe-check tooling), so "patched" is a 5→6 **major**
bump and the risk (`server.fs.deny` bypass) is dev-server-only. Not worth a risky
major override; revisit if we bump the vite major deliberately.

So the gate can't go fully green today regardless of effort — it's blocked on
the three fresh patches maturing. That's the correct outcome: maturity policy and
the audit gate are both strict controls, and on a brand-new patch maturity wins
for a few days.

Skip / already covered: trailing-whitespace / eof / check-yaml (Prettier),
large-files (git-lfs), actionlint/zizmor (only `pages.yml` exists — revisit if
workflows grow), ruff/pytest/swift* (we're TS-only).

Open decisions before implementing: (a) gitleaks allowlist/baseline approach;
(b) exactly where `pnpm audit` runs (pre-push vs CI vs a periodic maintenance
check).

## Implemented in this workstream

This commit adds the approved private-key, merge-conflict, and shellcheck guards
to the root pre-commit dispatcher. Shellcheck runs only for staged shell files.
The remaining work is gitleaks allowlist/baseline design and deciding where the
network-dependent `pnpm audit` gate belongs.
