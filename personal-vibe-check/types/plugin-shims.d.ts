/**
 * Ambient shims for the ESLint plugins this preset depends on that ship no
 * types of their own. They are consumed only as opaque plugin/config objects —
 * spread into a flat config or handed to ESLint's `plugins` map — so the shims
 * describe just the surface this file actually touches.
 *
 * These stay INSIDE this package: consumers resolve `./types.d.ts` through the
 * exports map and never see these declarations, so nothing here leaks an
 * ambient module into another package's program.
 */

declare module "eslint-config-agent" {
  import type { ESLint, Linter } from "eslint";

  /**
   * Some entries still carry a legacy-eslintrc `plugins: string[]`, which flat
   * config's own type forbids — hence the widened field. `preset.ts` normalizes
   * those to the object form before spreading them.
   */
  type LegacyTolerantConfig = Omit<Linter.Config, "plugins"> & {
    plugins?: Record<string, ESLint.Plugin> | string[];
  };

  const config: LegacyTolerantConfig[];
  export default config;
}

declare module "eslint-plugin-ddd" {
  import type { ESLint } from "eslint";

  const plugin: ESLint.Plugin;
  export default plugin;
}

declare module "eslint-plugin-jsx-a11y" {
  import type { ESLint, Linter } from "eslint";

  const plugin: ESLint.Plugin & {
    flatConfigs: { recommended: { rules: Linter.RulesRecord } };
  };
  export default plugin;
}
