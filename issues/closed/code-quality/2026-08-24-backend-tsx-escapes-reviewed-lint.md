---
title: "Backend `.tsx` files escape most of the reviewed ESLint ruleset"
workstream: knip-exports
resolution: implemented
---

**Closed 2026-08-24** — fixed in the knip-exports workstream. `exts` is now
unconditional, so the reviewed ruleset covers `.tsx`; the 12 `no-redeclare`
collisions were resolved by renaming the Zod values to `XSchema` (the
convention already used by `src/**/*.ts` and by the collision-free cases in
these same files), keeping the type names unchanged.

2026-08-24 · found while enabling knip's `exports` check.

`personal-vibe-check/eslint.config.mjs` gates the reviewed ruleset on the
`react` option:

```js
const exts = react ? "{ts,tsx,js,jsx}" : "{ts,js}";
const filePatterns = roots.map((r) => `${r}/**/*.${exts}`);
```

`filePatterns` is the `files:` key of the one block carrying `allRulesOff` +
`enabledRules` + `disabledRules`. beebox's backend passes `react: false`,
so the 28 `.tsx` files under `src/schemas/` never match it and fall through to
`eslint-config-agent`'s unreviewed base instead.

Measured with `eslint --print-config` on `src/schemas/guide.tsx` vs
`src/core/card-io.ts`:

| | |
|---|---|
| active rules on `.tsx` | 111 |
| active rules on `.ts` | 169 |
| on for `.tsx`, off for `.ts` (base leaking in) | 13 |
| on for `.ts`, absent on `.tsx` (reviewed rules escaping) | 71 |

Among the 71: `@typescript-eslint/no-unused-vars`, `consistent-type-assertions`
(the `as`-cast ban), `consistent-type-imports`, `no-restricted-properties`
(where this repo's `registry.createNew()` and `os.tmpdir()` bans live), and
correctness rules — `no-const-assign`, `no-dupe-keys`, `no-unreachable`,
`no-this-before-super`.

The gap is old and has been patched a rule at a time by whoever tripped over
it: the preset's trailing `.tsx` block re-asserts `no-shadow` with a comment
naming this exact cause, beebox's own config turns off
`custom/jsx-classname-required` noting the preset re-enables it on `.tsx`, and
the knip workstream added `class-export`/`required-exports` (2026-08-24).

**Cost of the real fix, measured.** Making `exts` unconditional leaves 16
violations across beebox:

- 12 × `no-redeclare` on `const X = z.enum([...])` + `type X = z.infer<typeof X>`.
  Legal TypeScript, idiomatic Zod. `@typescript-eslint/no-redeclare` does NOT
  fix it — `ignoreDeclarationMerge` doesn't cover const+type. The `.ts` files
  dodge it by naming the value `XSchema`, so the question is whether `.tsx`
  schemas should adopt that convention. That's the real decision here.
- 2 × `import-x/no-named-as-default-member` (`Markdoc.parse`/`.validate`)
- 2 autofixable (`import/newline-after-import`, `unicorn/empty-brace-spaces`)

So it is not a large burn-down — it is one naming-convention call plus four
fixes. It was left out of the knip workstream because that call is not the
knip workstream's to make.
