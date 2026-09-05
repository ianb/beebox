---
title: "Box-content linting: shellcheck procedure-card shells + duplicate-key guard"
workstream: openclaw-security-lints
area: beebox
labels: [lint, security, openclaw-borrow]
filed-by: agent
discovered-in: worktree-openclaw-security-lints — while scoping shellcheck for embedded box shell
needs: [design]
priority: normal
---

Distinct scope from the dev-repo hooks
([../code-quality/2026-07-24-security-precommit-hooks.md](../code-quality/2026-07-24-security-precommit-hooks.md)):
this validates **box content**, so it belongs in `bbx`'s card-validation path
(per-box), not the monorepo pre-commit.

`.card` files are YAML, schema-validated on load (`src/cards/schema.ts`). Two
gaps that schema validation can't cover:

- **Embedded procedure shell** — procedure cards carry bash in structured
  `shells:` / `precheck.shells:` block-scalar fields (e.g.
  `config/procedures/*.procedure.card`). Because it's discrete YAML array
  entries (not fragile ``` fences), extracting each shell string and piping it to
  **shellcheck** is clean — cleaner than openclaw's markdown-fence case. Ian: want
  this on in-box procedure scripts too.
- **Duplicate-key / tab YAML syntax** — a permissive YAML parser silently accepts
  duplicate keys (last-wins, drops data) and tabs *before* Zod ever sees the
  object, so the schema layer can't catch them. Since agents author cards, a
  silent duplicate-key drop is a plausible corruption. Value is a **targeted
  duplicate-key/tab guard**, not a full yamllint (schema validation already beats
  yamllint on structure/types).

**Needs design:** where these hook into `bbx` (card save? a `bbx validate` pass?
box pre-commit?), how per-box vs. repo-wide, and how failures surface to the
authoring agent. The duplicate-key guard is lower priority — only worth it if we
actually see cards corrupt this way.
