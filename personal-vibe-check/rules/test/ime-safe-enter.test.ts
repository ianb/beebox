import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import rule from "../ime-safe-enter.ts";
import { imeSafeEnterCases } from "./ime-safe-enter.cases.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

const ERR = [{ messageId: "missingCompositionCheck" }];

describe("ime-safe-enter", () => {
  it("passes and fails the expected handlers", () => {
    tester.run("ime-safe-enter", rule, {
      valid: imeSafeEnterCases.valid,
      invalid: imeSafeEnterCases.invalid.map((code) => ({ code, errors: ERR })),
    });
  });
});
