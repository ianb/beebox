---
title: "single-export should not count type/interface (and maybe const) exports"
area: vibe-check
filed-by: agent
discovered-in: main session — while triaging tour-lib-lint-debt, the boxholder reconsidered the rule itself
---

The `single-export` rule (`eslint-plugin-single-export`, `error` in
`eslint-config-agent` → personal-vibe-check) counts **every** local export toward
its one-per-file limit — including `export interface`, `export type`, and
`export const`. The boxholder's stance: **one function/class per file is a fine
constraint, but types/interfaces (and probably consts) are supporting information
that naturally travels with the main export — the rule shouldn't count them.**

This is why a cohesive unit trips it: `fake-agent.ts` was "5 exports" (1 fn + 3
interfaces + 1 error class); tour-lib's `types.ts` is "15 exports" (all type
declarations). The preset *already* turns single-export off for JSX/component
files — an implicit admission that "a value + its `Props` type in one file" is
fine — which supports the boxholder's read.

**The constraint:** `eslint-plugin-single-export` has no options (`schema: []`),
so you can't configure it to ignore types. Options to get the desired behavior:
- **Custom rule in personal-vibe-check** — a `single-value-export` that counts
  only value declarations (function/class, and see the const question below),
  ignoring `TSInterfaceDeclaration` / `TSTypeAliasDeclaration` / type-only export
  specifiers. Fork the plugin's logic; small.
- **Drop the plugin** and lean on the existing "only export what's needed"
  convention (code-style.md) + review. Loses the automated nudge entirely.

**Design forks to settle (why this is a decision, not a mechanical change):**
- **Consts:** a `const` is a runtime value. The boxholder said "probably" consts
  come along too. Allow unlimited accompanying consts (loose: "one fn/class + any
  consts + any types"), or keep consts counted (a const can be a file's primary
  export)? Leaning: don't count a const that's clearly supporting, but this needs
  a crisp definition.
- **One value export or a cohesive value cluster?** `fake-agent.ts` has a function
  AND an error class = 2 value exports. Is that still one "thing" (the fixture +
  the error it throws), or two? Decide whether the limit is strictly one value
  export or a small cohesive cluster.
- **Blast radius:** this is a personal-vibe-check change touching the whole
  monorepo (and any other consumer). Files previously split *only* to satisfy
  single-export could opportunistically re-merge; not a required sweep.

**Coordination:** the `tour-lib-lint` worktree currently scopes single-export off
for `test/` as an interim. If this global change lands, that scoping becomes
unnecessary (types stop counting everywhere) — but tour-lib's other 22
style/security fixes stand regardless, so the worktree isn't blocked either way.

Broader: the boxholder also questioned whether they like single-export at all.
This issue is the narrower, concrete version; a full "drop it" is the fallback if
the custom rule isn't worth the maintenance.
