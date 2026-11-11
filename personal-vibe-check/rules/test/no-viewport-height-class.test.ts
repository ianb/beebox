import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import rule from "../no-viewport-height-class.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

function err(name: string, fix: string) {
  return [{ messageId: "viewportHeight", data: { name, fix } }];
}

describe("no-viewport-height-class", () => {
  it("passes and fails the expected class strings", () => {
    tester.run("no-viewport-height-class", rule, {
      valid: [
        '<div className="min-h-dvh flex" />',
        '<div className="h-dvh" />',
        '<div className="max-h-dvh" />',
        // Similar names are not the banned utility.
        '<div className="h-screen-safe min-h-screens" />',
        // Not a className.
        '<div id="h-screen" title="min-h-screen" />',
        // Dynamic class names are skipped.
        "<div className={classes} />",
      ],
      invalid: [
        { code: '<div className="h-screen" />', errors: err("h-screen", "h-dvh") },
        { code: '<div className="flex min-h-screen p-4" />', errors: err("min-h-screen", "min-h-dvh") },
        { code: '<div className="max-h-screen" />', errors: err("max-h-screen", "max-h-dvh") },
        { code: '<div className="md:min-h-screen" />', errors: err("min-h-screen", "min-h-dvh") },
        { code: '<div className="!h-screen" />', errors: err("h-screen", "h-dvh") },
        { code: '<div className="min-h-[100vh]" />', errors: err("min-h-[100vh]", "min-h-dvh") },
        // Inside an expression container, cn() call, ternary and template.
        { code: '<div className={"min-h-screen"} />', errors: err("min-h-screen", "min-h-dvh") },
        { code: '<div className={cn("p-2", on && "h-screen")} />', errors: err("h-screen", "h-dvh") },
        { code: '<div className={on ? "h-screen" : "p-2"} />', errors: err("h-screen", "h-dvh") },
        { code: "<div className={`flex min-h-screen ${x}`} />", errors: err("min-h-screen", "min-h-dvh") },
        // Two in one attribute: two reports.
        {
          code: '<div className={cn("h-screen", "max-h-screen")} />',
          errors: [...err("h-screen", "h-dvh"), ...err("max-h-screen", "max-h-dvh")],
        },
      ],
    });
  });
});
