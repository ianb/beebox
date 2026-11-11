import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import rule from "../prefer-native-dialog.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

function err(role: string, element: string) {
  return [{ messageId: "preferDialog", data: { role, element } }];
}

describe("prefer-native-dialog", () => {
  it("passes and fails the expected elements", () => {
    tester.run("prefer-native-dialog", rule, {
      valid: [
        "<dialog />",
        '<dialog role="dialog" />',
        '<div role="group" />',
        '<div role="alert" />',
        "<div />",
        // A spread may carry or replace the role.
        '<div {...props} role="dialog" />',
        '<div role="dialog" {...props} />',
        // A non-literal role is not checked.
        "<div role={role} />",
        '<div role={cond ? "dialog" : "group"} />',
        "<div role={`dialog`} />",
        // Components are not checked.
        '<Panel role="dialog" />',
        // A value-less role.
        "<div role />",
      ],
      invalid: [
        { code: '<div role="dialog" />', errors: err("dialog", "div") },
        { code: '<section role="alertdialog" aria-modal="true" />', errors: err("alertdialog", "section") },
        { code: "<div role={'dialog'} />", errors: err("dialog", "div") },
        { code: '<div className="a" role="dialog" aria-label="Search">x</div>', errors: err("dialog", "div") },
        {
          code: '<div><div role="dialog" /><div role="group" /></div>',
          errors: err("dialog", "div"),
        },
      ],
    });
  });
});
