import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import rule from "../aria-label-needs-role.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

function err(element: string) {
  return [{ messageId: "labelNeedsRole", data: { element } }];
}

describe("aria-label-needs-role", () => {
  it("passes and fails the expected elements", () => {
    tester.run("aria-label-needs-role", rule, {
      valid: [
        '<div role="group" aria-label="Tasks" />',
        '<div aria-label="Tasks" role="status" aria-busy="true" />',
        // No label, nothing to ignore.
        '<div className="x" />',
        // A spread may carry the role.
        '<div {...props} aria-label="Tasks" />',
        '<div aria-label="Tasks" {...props} />',
        // Elements with their own role or a component are not checked.
        '<button aria-label="Close" />',
        '<nav aria-label="Main" />',
        '<Panel aria-label="Tasks" />',
        // aria-labelledby alone is out of scope.
        '<div aria-labelledby="h" />',
      ],
      invalid: [
        { code: '<div aria-label="Tasks" />', errors: err("div") },
        { code: '<span aria-label="Count">3</span>', errors: err("span") },
        { code: '<p aria-label="Note">x</p>', errors: err("p") },
        { code: '<i aria-label="Warning" />', errors: err("i") },
        { code: '<b aria-label="Bold" />', errors: err("b") },
        // Multi-line, with a dynamic label.
        { code: "<div\n  className=\"a\"\n  aria-label={label}\n>x</div>", errors: err("div") },
        // Mixed: only the unroled one is reported.
        {
          code: '<div><div role="group" aria-label="A" /><span aria-label="B" /></div>',
          errors: err("span"),
        },
      ],
    });
  });
});
