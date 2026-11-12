import type { Linter } from "eslint";
import { AS_BAN_SELECTORS } from "./enabled-rules.ts";

// The strict `no-restricted-syntax` selector set for .tsx files (formerly
// eslint-config-agent's). We keep all of it EXCEPT the nullish-coalescing (`??`) ban —
// `a ?? b` is good idiom (same call as retiring no-optional-chaining), not a
// smell. The `as`-cast ban stays: treat `as` like Rust's `unsafe` — allowed
// only when guarded by a justifying `eslint-disable` comment or centralized
// in a single typed helper. This override is only needed when react:false;
// the react config already replaces this rule with the catch-only variant on
// .tsx, which never had the `??` ban.
const tsxRestrictedSyntaxNoNullish = [
  {
    selector: "SwitchStatement > SwitchCase > ReturnStatement[argument=null]",
    message:
      "Switch case functions must provide an explicit return value. Default return values are not allowed.",
  },
  {
    selector: "SwitchStatement > SwitchCase > BlockStatement > ReturnStatement[argument=null]",
    message:
      "Switch case functions must provide an explicit return value. Default return values are not allowed.",
  },
  {
    selector: "SwitchStatement > SwitchCase[test=null]",
    message:
      "Default cases are not allowed in switch statements. Handle all possible cases explicitly.",
  },
  {
    selector: "SwitchStatement > SwitchCase ArrowFunctionExpression:not([returnType])",
    message: "Switch case arrow functions must have explicit return type annotations.",
  },
  {
    selector: "SwitchStatement > SwitchCase FunctionExpression:not([returnType])",
    message: "Switch case function expressions must have explicit return type annotations.",
  },
  {
    selector:
      "SwitchStatement > SwitchCase > BlockStatement ArrowFunctionExpression:not([returnType])",
    message: "Switch case arrow functions must have explicit return type annotations.",
  },
  {
    selector: "SwitchStatement > SwitchCase > BlockStatement FunctionExpression:not([returnType])",
    message: "Switch case function expressions must have explicit return type annotations.",
  },
  {
    selector: "FunctionDeclaration:has(SwitchStatement):not([returnType])",
    message: "Functions containing switch statements must have explicit return type annotations.",
  },
  {
    selector: "ArrowFunctionExpression:has(SwitchStatement):not([returnType])",
    message:
      "Arrow functions containing switch statements must have explicit return type annotations.",
  },
  {
    selector: "FunctionExpression:has(SwitchStatement):not([returnType])",
    message:
      "Function expressions containing switch statements must have explicit return type annotations.",
  },
  ...AS_BAN_SELECTORS,
  {
    selector: "PropertyDefinition[value]",
    message:
      "Class properties cannot have default values. Initialize properties in the constructor or through methods instead.",
  },
  {
    selector:
      "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env']",
    message:
      "Direct access to process.env properties is not allowed. Use process.env as a whole object instead (e.g., validate(process.env)).",
  },
  {
    selector:
      "ExportNamedDeclaration:not([source]):not(:has(VariableDeclaration)):not(:has(FunctionDeclaration)):not(:has(ClassDeclaration)):not(:has(TSInterfaceDeclaration)):not(:has(TSTypeAliasDeclaration)):not(:has(TSEnumDeclaration))",
    message:
      'Export specifier syntax "export { ... }" is not allowed. Use direct exports instead. And make sure to only use one export per file.',
  },
];

// When react:false, .tsx files carry the `??`-free selector set, the same
// size budgets as .ts (JSX/markup is verbose, so .tsx wants the SAME budgets
// as .ts, not less) and the same complexity limit. (react:true sets these on
// .tsx through the main block instead.)
export const tsxOverride: Linter.Config = {
  files: ["**/*.{tsx,jsx}"],
  rules: {
    "no-restricted-syntax": ["error", ...tsxRestrictedSyntaxNoNullish],
    "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
    "max-lines-per-function": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
    complexity: ["error", 25],
    // The main enabledRules block only matches `.{ts,js}` when
    // react:false, so `.tsx` (e.g. backend schema files) would
    // otherwise escape no-shadow entirely. Re-assert it here.
    "no-shadow": "off",
    "@typescript-eslint/no-shadow": "error",
  },
};
