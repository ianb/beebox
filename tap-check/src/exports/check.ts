/**
 * `@ianbicking/tap-check/check`: the patterns and types for `t.check`, and the
 * observation helpers (`runCommand`, `eventually`, `printed`).
 *
 * `t.check`, `t.checkText`, and `t.checkThrows` themselves are methods on
 * tap's test object, added by `@ianbicking/tap-check/tap`.
 */

export {
  any,
  anything,
  instanceOf,
  is,
  isoDate,
  not,
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
export { runCommand, tsxCommand, CommandStartError, type CommandOptions, type CommandResult } from "../observe/command.js";
export { eventually, type EventuallyOptions } from "../observe/eventually.js";
export { printed, type Printed } from "../observe/printed.js";
