# Working with personal-vibe-check

This package is a **reusable ESLint/TypeScript/Prettier preset**, consumed by other projects via `import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint"`.

Two distinct kinds of work happen here. Figure out which one you're doing, then read the matching section below.

- **Using the library** — configuring a downstream project to depend on this preset, or applying one of its conventions. Nothing in this repo needs to change.
- **Changing the library** — adding or modifying a rule/config/convention that will affect every downstream project.

---

## Using the library

If you landed in this repo but the task is actually to **install or configure this preset in another project**, you are in the wrong directory. This repo has no project-level work to do for consumers.

Relevant files to read, in priority order:

- [`install.md`](./install.md) — step-by-step instructions for installing the preset into a downstream project (preferred `vibe-init` path, manual path, hook setup, verification, common failure modes).
- [`conventions.md`](./conventions.md) — the prose coding rules that get copied into the downstream project's `CLAUDE.md`.
- [`README.md`](./README.md) — human-oriented overview of what's bundled and why.

If a rule in this package isn't behaving the way you want for a downstream project, do not edit this repo to fix it — either disable the rule in the consuming project's eslint config, or (if the rule is wrong in general) return here under the **Changing the library** workflow.

---

## Changing the library

Everything below is for contributors modifying this repo (adding rules, adjusting the shared config, updating conventions).

### Repo layout

- `preset.ts` — the exported flat config (`vibeCheck()` function). All third-party rule choices live here with per-rule rationale comments. **Not** named `eslint.config.*`: ESLint would then pick it up as this package's own config and crash, since its default export is a factory function.
- `types.d.ts` — the public type surface consumers resolve through the `exports` map (`vibeCheck`'s options and return type). `preset.ts` binds its implementation to this declaration, so the two cannot drift.
- `eslint.config.ts` — this package's OWN lint config, applying `preset.ts` to itself.
- `plugin.ts` — ESLint plugin bundling this repo's own rules. Every rule in `rules/` must be registered here.
- `rules/<rule-name>.ts` — custom rule implementations. One rule per file, typed as `Rule.RuleModule`.
- `rules/test/<rule-name>.test.ts` — tests for each rule. **Required**, not optional.
- `conventions.md` — downstream-facing conventions. Consuming projects paste relevant sections into their own CLAUDE.md / AGENTS.md.
- `tsconfig.base.json`, `prettier.config.ts`, `knip-base.json` — other shared configs.
- `types/plugin-shims.d.ts` — ambient declarations for the upstream ESLint plugins that ship no types. Package-internal; consumers never see them.

### "Complete" for a new or changed rule

A rule change is not done until **all** of these hold:

1. **Rule implemented** in `rules/<name>.ts` with:
   - `meta.schema` locking down the options shape
   - `meta.messages` with `messageId`-based messages (never hardcoded strings in `context.report`)
   - Comments explaining *why* the rule exists and what it deliberately does *not* check
2. **Tests written** in `rules/test/<name>.test.ts` using ESLint's `RuleTester` and `node:test`:
   - Valid cases: at minimum covers each option independently + the no-op case (rule disabled or pattern doesn't match)
   - Invalid cases: at minimum covers every error path the rule can produce, plus mixed-valid-and-invalid, plus any prefix/suffix handling
   - Dynamic / unparseable input: explicit test that it's skipped (not errored on)
3. **Registered** in `plugin.ts` under the correct name.
4. **Wired** in `preset.ts` (and its options declared in `types.d.ts`) — either always-on (rare) or opt-in via a new `vibeCheck()` option. If opt-in, the option name should match the rule name.
5. **Documented** in `conventions.md` with a usage snippet, the full options shape, and a Limitations subsection. Downstream authors read this file, not the source.
6. **`pnpm test`, `pnpm lint`, and `pnpm typecheck` all pass** (this package lints and type-checks itself — that only became true once the preset moved out of `eslint.config.mjs`).
7. **Committed as its own commit** with a message explaining *why* the rule exists — the commit log is the historical record of why each rule was added.

Shipping a rule without tests is not acceptable. RuleTester is part of ESLint itself; there's no setup cost.

### Test-writing checklist

When writing `rules/test/<name>.test.ts`:

- Import `RuleTester` from `eslint` and `describe`/`it` from `node:test`.
- Use `messageId` + complete `data` object in invalid-case expectations (not raw `message`). RuleTester substitutes `{{placeholders}}` from `data`; missing keys leave the placeholder literal and the assertion fails on a confusing diff.
- Every `valid`/`invalid` case should state one specific behavior — if a test is checking two things, split it.
- Provide a small helper (like `valid(code, options)` / `invalid(code, errors, options)`) so the test file reads as a specification, not as scaffolding.

### Commit hygiene

- One rule per commit. If you rename/refactor while adding, split into "refactor" + "add rule" commits.
- Commit message first line: imperative + what + where. Body: why.
- Never include `.claude/settings.local.json` or other per-machine state in rule commits.

### Publishing

**This package is NOT published.** It is consumed only inside this monorepo, via
`workspace:*`. An earlier version of this file described an `npm publish` step;
that was aspirational, and `@ianbicking/personal-vibe-check` has never existed on
the registry (checked 2026-08-25).

That matters, because publishing is no longer free: the package now ships
TypeScript sources directly (the `exports` map points at `preset.ts`), and Node
refuses to strip types for files under `node_modules`. A real npm install would
therefore break every `.mjs` consumer config and both `bin/` executables.
Publishing would first require a build step emitting `.mjs` + `.d.ts`. Bump the
version for a rule change if you like — nothing consumes the number.
