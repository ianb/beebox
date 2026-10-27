import type { ESLint, Linter } from "eslint";
import defaultPlugin from "eslint-plugin-default";
// Named `plugin`: import-x/no-rename-default wants the name of the module's own default export.
import plugin from "eslint-plugin-error";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import securityPlugin from "eslint-plugin-security";
import tseslint from "typescript-eslint";
import { noDefaultClassExport } from "./no-default-class-export.ts";

// The entries every `vibeCheck()` result starts with: the TypeScript parser
// and the plugins whose rules the preset, or a consumer's own block, names.
// Registering a plugin here (no `files` key) makes it available to every file,
// including the unscoped retirements in `global-overrides.ts`; the main rule
// block adds the plugins only it needs (`main-plugins.ts`).
//
// The react-hooks entry names `meta` and `rules` rather than passing the whole
// module: eslint-plugin-react-hooks ships types whose `configs.flat` shape does
// not satisfy ESLint's own `Plugin` type. Those configs are unused here, and
// `rules` is the only thing read off a plugin once it is in the `plugins` map,
// so naming the two live fields sidesteps the upstream mismatch without a cast.
const plugins: Record<string, ESLint.Plugin> = {
  custom: { rules: { "no-default-class-export": noDefaultClassExport } },
  default: defaultPlugin,
  error: plugin,
  react: reactPlugin,
  "react-hooks": { meta: reactHooksPlugin.meta, rules: reactHooksPlugin.rules },
  security: securityPlugin,
};

export const baseConfig: Linter.Config[] = [
  { ignores: ["**/*.json", "**/*.md", "**/*.yaml", "**/*.yml"] },
  tseslint.configs.base,
  { plugins },
];
