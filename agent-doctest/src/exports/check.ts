/**
 * `agent-doctest/check`: the patterns and types for `t.check`, and the
 * text-comparison API behind `t.checkText`.
 *
 * `t.check`, `t.checkText`, and `t.checkThrows` themselves are methods on
 * tap's test object, added by `agent-doctest/tap`.
 */

export {
  any,
  anything,
  isoDate,
  notAllowed,
  oneOf,
  optional,
  others,
  str,
  uuid,
  Pattern,
  StringPattern,
  NumberPattern,
  Optional,
  Capture,
  capture,
} from "../check/patterns.js";
export { containing, unordered, Unordered, type Expected } from "../check/expected.js";
export { checkValue, NO_EXPECTED, type CheckValueOutcome } from "../check/compare/report.js";
export {
  check as checkText,
  inspect,
  CheckError,
  serialize,
  registerSerializer,
  type CheckOptions,
  type CheckResult,
  type Extractions,
} from "../tap-check/text/compare.js";
export { runCommand, tsxCommand, CommandStartError, type CommandOptions, type CommandResult } from "../observe/command.js";
