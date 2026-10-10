/**
 * The layout rules, one member per file in `./rules`. Each is a pure function
 * of a scanned `PackageLayout`; the check runs every member in key order.
 */
import { defineRegistry } from "../../../shared/registry.js";
import type { LayoutRule } from "../model.js";
import { namesRule } from "./rules/names.js";
import { pluginImportsRule } from "./rules/plugin-imports.js";
import { setsRule } from "./rules/sets/rule.js";
import { testsRule } from "./rules/tests.js";
import { unitsRule } from "./rules/units.js";

export const layoutRules = defineRegistry<LayoutRule>({
  directory: "./rules",
  entry: "rule",
  ordered: false,
  members: { names: namesRule, pluginImports: pluginImportsRule, sets: setsRule, tests: testsRule, units: unitsRule },
});
