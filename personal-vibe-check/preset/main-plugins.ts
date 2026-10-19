// The plugins the main rule block registers. Lives apart from `base-config.ts`
// because `import-x/no-rename-default` wants each default import named after
// the module's own default export, and both eslint-plugin-ddd and
// eslint-plugin-import-x call theirs `plugin`.
import plugin from "eslint-plugin-import-x";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import unicorn from "eslint-plugin-unicorn";
import vibePlugin from "../plugin.ts";

export function mainPlugins(react: boolean | undefined) {
  return {
    unicorn,
    "import-x": plugin,
    "personal-vibe-check": vibePlugin,
    ...(react ? { "jsx-a11y": jsxA11yPlugin } : {}),
  };
}
