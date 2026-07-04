---
area: monorepo
---

# Check out aislop — AI-slop pattern scanner

[scanaislop/aislop](https://github.com/scanaislop/aislop) is a code-quality
scanner that lints for patterns commonly left by AI coding agents:
narrative comments, dead code, `as any` casts, unhandled exceptions, etc.
40+ rules across 7 languages, deterministic 0–100 score, autofix or
hand-off-to-agent flows.

Worth a look both as a **tool** (could slot into pre-commit alongside
eslint/oxlint, or run periodically as a quality gauge) and as a **rule
inventory** — even if we don't adopt the binary, the catalog of "things
agents do wrong" maps directly onto what our own personal-vibe-check and
`.claude/rules/` files try to prevent. Reading the rule list could surface
gaps in our own conventions.

Probably most useful as a periodic audit (a la `pnpm lint:knip`) rather
than pre-commit — pre-commit is already busy and these patterns aren't
all hard-block worthy.
