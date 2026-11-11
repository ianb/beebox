import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import rule from "../no-px-font-size-class.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

function err(name: string, fix: string) {
  return [{ messageId: "pxFontSize", data: { name, fix } }];
}

describe("no-px-font-size-class", () => {
  it("passes and fails the expected class strings", () => {
    tester.run("no-px-font-size-class", rule, {
      valid: [
        '<div className="text-[0.6875rem] flex" />',
        '<div className="text-sm text-[1.25rem]" />',
        // Other px utilities are not font sizes.
        '<div className="w-[11px] text-[#fff] p-[10px]" />',
        // Not a className.
        '<div id="text-[11px]" title="text-[10px]" />',
        // Dynamic class names are skipped.
        "<div className={classes} />",
      ],
      invalid: [
        { code: '<div className="text-[11px]" />', errors: err("text-[11px]", "text-[0.6875rem]") },
        { code: '<div className="flex text-[10px] p-4" />', errors: err("text-[10px]", "text-[0.625rem]") },
        { code: '<div className="md:text-[13px]" />', errors: err("text-[13px]", "text-[0.8125rem]") },
        { code: '<div className="!text-[12px]" />', errors: err("text-[12px]", "text-[0.75rem]") },
        { code: '<div className="text-[11.5px]" />', errors: err("text-[11.5px]", "text-[0.7188rem]") },
        { code: '<div className="text-[11px]/4" />', errors: err("text-[11px]/4", "text-[0.6875rem]") },
        // Inside an expression container, cn() call, ternary and template.
        { code: '<div className={"text-[9px]"} />', errors: err("text-[9px]", "text-[0.5625rem]") },
        { code: '<div className={cn("p-2", on && "text-[9px]")} />', errors: err("text-[9px]", "text-[0.5625rem]") },
        { code: '<div className={on ? "text-[14px]" : "p-2"} />', errors: err("text-[14px]", "text-[0.875rem]") },
        { code: "<div className={`flex text-[10px] ${x}`} />", errors: err("text-[10px]", "text-[0.625rem]") },
        // Two in one attribute: two reports.
        {
          code: '<div className={cn("text-[9px]", "text-[10px]")} />',
          errors: [...err("text-[9px]", "text-[0.5625rem]"), ...err("text-[10px]", "text-[0.625rem]")],
        },
      ],
    });
  });
});
