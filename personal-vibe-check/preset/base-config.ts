import type { ESLint, Linter } from "eslint";
import config from "eslint-config-agent";
import plugin from "eslint-plugin-ddd";
import reactHooksPlugin from "eslint-plugin-react-hooks";

// Some plugins eslint-config-agent depends on still ship legacy-eslintrc
// configs whose `plugins:` is a string array — newer ESLint flat config
// rejects that. Rewrite any such entry to the object form before spreading.
//
// The react-hooks entry names `meta` and `rules` rather than passing the whole
// module: eslint-plugin-react-hooks ships types whose `configs.flat` shape does
// not satisfy ESLint's own `Plugin` type. Those legacy configs are unused here,
// and `rules` is the only thing read off a plugin once it is in the `plugins`
// map, so naming the two live fields sidesteps the upstream mismatch without a
// cast.
const PLUGIN_OBJECTS: Record<string, ESLint.Plugin> = {
  ddd: plugin,
  "react-hooks": { meta: reactHooksPlugin.meta, rules: reactHooksPlugin.rules },
};
export const baseConfig: Linter.Config[] = config.map(({ plugins, ...rest }) => {
  if (!Array.isArray(plugins)) return plugins ? { ...rest, plugins } : rest;
  const named: Record<string, ESLint.Plugin> = {};
  for (const name of plugins) {
    const known = PLUGIN_OBJECTS[name];
    if (known) named[name] = known;
  }
  return { ...rest, plugins: named };
});

/**
 * Build the set of all rule keys from the base config so we can turn them off
 * before applying our reviewed rules.
 */
export function allRulesOffFrom(
  entries: { rules?: Record<string, unknown> }[],
): Record<string, "off"> {
  const off: Record<string, "off"> = {};
  for (const entry of entries) {
    if (entry.rules) {
      for (const key of Object.keys(entry.rules)) {
        off[key] = "off";
      }
    }
  }
  return off;
}
