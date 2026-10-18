/**
 * agent-doctest's ESLint plugin: rules that keep `t.check` tests strong.
 * Enable on test files:
 *
 *     import agentDoctest from "agent-doctest/eslint";
 *     { files: ["test/**\/*.ts"], plugins: { "agent-doctest": agentDoctest },
 *       rules: { "agent-doctest/check-whole-value": "error", "agent-doctest/no-voided-check": "error" } }
 */

import checkWholeValue from "./check-whole-value.js";
import noVoidedCheck from "./no-voided-check.js";

const plugin = {
  meta: { name: "agent-doctest" },
  rules: {
    "check-whole-value": checkWholeValue,
    "no-voided-check": noVoidedCheck,
  },
};

export default plugin;
