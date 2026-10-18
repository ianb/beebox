/**
 * agent-doctest's ESLint plugin: rules that keep `t.check` tests strong.
 * Enable on test files:
 *
 *     import agentDoctest from "agent-doctest/eslint";
 *     { files: ["test/**\/*.ts"], plugins: { "agent-doctest": agentDoctest },
 *       rules: { "agent-doctest/check-whole-value": "error", "agent-doctest/no-voided-check": "error",
 *                "agent-doctest/no-tap-assert": "error" } }
 */

import checkWholeValue from "./check-whole-value.js";
import noTapAssert from "./no-tap-assert.js";
import noVoidedCheck from "./no-voided-check.js";

const plugin = {
  meta: { name: "agent-doctest" },
  rules: {
    "check-whole-value": checkWholeValue,
    "no-tap-assert": noTapAssert,
    "no-voided-check": noVoidedCheck,
  },
};

export default plugin;
