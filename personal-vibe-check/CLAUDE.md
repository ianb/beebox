# Working in personal-vibe-check

This package is a **reusable ESLint/TypeScript/Prettier preset**, consumed by other projects via `import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint"`. Changes here affect every downstream project, so "complete" is stricter than a typical feature commit.

## Layout

- `eslint.config.mjs` — the exported flat config (`vibeCheck()` function). All third-party rule choices live here with per-rule rationale comments.
- `plugin.mjs` — ESLint plugin bundling this repo's own rules. Every rule added to `rules/` must be registered here.
- `rules/<rule-name>.mjs` — custom rule implementations. One rule per file.
- `rules/test/<rule-name>.test.mjs` — tests for each rule. **Required**, not optional.
- `CONVENTIONS.md` — user-facing conventions. Consuming projects paste this into their own CLAUDE.md / AGENTS.md.
- `tsconfig.base.json`, `prettier.config.mjs`, `knip-base.json` — other shared configs.

## "Complete" for a new or changed rule

A rule change is not done until **all** of these hold:

1. **Rule implemented** in `rules/<name>.mjs` with:
   - `meta.schema` locking down the options shape
   - `meta.messages` with `messageId`-based messages (never hardcoded strings in `context.report`)
   - Comments explaining *why* the rule exists and what it deliberately does *not* check
2. **Tests written** in `rules/test/<name>.test.mjs` using ESLint's `RuleTester` and `node:test`:
   - Valid cases: at minimum covers each option independently + the no-op case (rule disabled or pattern doesn't match)
   - Invalid cases: at minimum covers every error path the rule can produce, plus mixed-valid-and-invalid, plus any prefix/suffix handling
   - Dynamic / unparseable input: explicit test that it's skipped (not errored on)
3. **Registered** in `plugin.mjs` under the correct name.
4. **Wired** in `eslint.config.mjs` — either always-on (rare) or opt-in via a new `vibeCheck()` option. If opt-in, the option name should match the rule name.
5. **Documented** in `CONVENTIONS.md` with a usage snippet, the full options shape, and a Limitations subsection. Consuming-project authors read this file, not the source.
6. **`npm test` passes** and **`npm run lint` passes** (the repo lints itself).
7. **Committed as its own commit** with a message explaining *why* the rule exists — the commit log is the historical record of why each rule was added.

Shipping a rule without tests is not acceptable. RuleTester is part of ESLint itself; there's no setup cost.

## Test-writing checklist

When writing `rules/test/<name>.test.mjs`:

- Import `RuleTester` from `eslint` and `describe`/`it` from `node:test`.
- Use `messageId` + complete `data` object in invalid-case expectations (not raw `message`). RuleTester substitutes `{{placeholders}}` from `data`; missing keys leave the placeholder literal and the assertion fails on a confusing diff.
- Every `valid`/`invalid` case should state one specific behavior — if a test is checking two things, split it.
- Provide a small helper (like `valid(code, options)` / `invalid(code, errors, options)`) so the test file reads as a specification, not as scaffolding.

## Commit hygiene

- One rule per commit. If you rename/refactor while adding, split into "refactor" + "add rule" commits.
- Commit message first line: imperative + what + where. Body: why.
- Never include `.claude/settings.local.json` or other per-machine state in rule commits.

## Publishing

This package is versioned and published. After merging a rule change:

- Bump `package.json` version (semver: rules that tighten existing behavior = minor; new rules = minor; breaking option changes = major).
- Note the change in whatever CHANGELOG exists (or add one if this is the first).
- `npm publish` — only after tests pass and the commit is pushed.

(If no CHANGELOG exists yet, that's worth adding the next time you ship.)
