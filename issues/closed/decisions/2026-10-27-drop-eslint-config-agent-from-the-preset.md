---
title: "Register the preset's plugins directly and drop eslint-config-agent?"
workstream: unattached
area: personal-vibe-check
labels: [dependencies, lint]
filed-by: agent
discovered-in: dep-reduction — dependency inventory, 2026-10-27
resolution: implemented
---

Closed 2026-10-27 on the dep-reduction workstream. Decision: drop it. `preset/base-config.ts` registers the plugins the reviewed rules use, and `custom/no-default-class-export` is a local copy of the agent's rule. The three import rules moved to `import-x/…` with the same options. `eslint-config-agent`, `eslint-plugin-n`, `eslint-plugin-import`, `eslint-plugin-class-export`, `@eslint/eslintrc`, `@eslint/js` and the separate `@typescript-eslint/*` declarations are gone, as is the eslint-config-agent patch; `patch-package` stays for the `@typescript-eslint/eslint-plugin` patch. Files inside `roots` print the same rules as before. Files outside `roots` had been getting the agent's unreviewed base; the `test/` folders of browse, tap-check, beebox-clerk and pub-worker, and browse's `packages/agent-browser-typed`, are now in `roots`, and their violations are fixed.

`personal-vibe-check/preset/base-config.ts` spreads `eslint-config-agent`'s
config, then `allRulesOffFrom()` turns off every rule it set, and the
preset's own reviewed list applies on top. The package therefore serves as a
plugin registry. That one use is the reason for:

- `patches/eslint-config-agent+1.9.3.patch`, one of the two patches that keep
  `patch-package` in the root `postinstall`. The other patch, for
  `@typescript-eslint/eslint-plugin`, is the subject of
  [its own issue](../docs-and-chores/2026-09-27-drop-typescript-eslint-no-misused-promises-patch.md);
- `eslint-plugin-n` (no rule used), `eslint-plugin-class-export` (one rule), and
  `eslint-plugin-import` (three rules: `first`, `newline-after-import`,
  `no-absolute-path`, which `eslint-plugin-import-x` also provides);
- `@eslint/eslintrc`, and the separately listed `@typescript-eslint/eslint-plugin`
  and `@typescript-eslint/parser`, which the `typescript-eslint` package
  already provides.

The change would register the plugins that rules actually use, move the three
import rules to import-x, and delete the dependencies and the patch above.
When both patches are gone, `patch-package` can go too. If a patch is still
needed, pnpm's `patchedDependencies` can hold it. The decision is whether the
preset still wants anything else from eslint-config-agent, for example
updates to its rule list that someone reviews.

Inventory rows: [dev/dependency-inventory-2026-10.md](../../dev/dependency-inventory-2026-10.md).
