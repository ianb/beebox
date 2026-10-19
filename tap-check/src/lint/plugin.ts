/**
 * tap-check's ESLint plugin: rules that keep `t.check` tests strong.
 * Enable on test files:
 *
 *     import agentDoctest from "@ianbicking/tap-check/eslint";
 *     { files: ["test/**\/*.ts"], plugins: { "tap-check": tapCheck },
 *       rules: { "tap-check/check-whole-value": "error", "tap-check/no-voided-check": "error",
 *                "tap-check/no-tap-assert": "error" } }
 */

import checkWholeValue from "./check-whole-value.js";
import noTapAssert from "./no-tap-assert.js";
import noVoidedCheck from "./no-voided-check.js";

const plugin = {
  meta: { name: "tap-check" },
  rules: {
    "check-whole-value": checkWholeValue,
    "no-tap-assert": noTapAssert,
    "no-voided-check": noVoidedCheck,
  },
};

export default plugin;
