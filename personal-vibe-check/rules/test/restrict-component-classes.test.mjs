import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import rule from "../restrict-component-classes.mjs";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  },
});

const UI_COMPONENTS = [{ components: ["./ui/**", "./components/ui/**"] }];

function valid(code, options = UI_COMPONENTS) {
  return { code, options };
}

function invalid(code, errors, options = UI_COMPONENTS) {
  const normalized = errors.map((e) => {
    if (typeof e === "string") {
      return {
        messageId: "disallowedClass",
        data: { class: e, component: "Button", prop: "className" },
      };
    }
    return e;
  });
  return { code, options, errors: normalized };
}

describe("restrict-component-classes", () => {
  it("validates className tokens against the allowlist", () => {
    tester.run("restrict-component-classes", rule, {
      valid: [
        // Non-UI components are not subject to the rule
        valid(`
          import { Button } from "./not-ui/Button";
          export const X = () => <Button className="text-red-500 bg-plum">Hi</Button>;
        `),

        // Raw DOM elements are not subject to the rule
        valid(`<div className="text-red-500 bg-plum shadow" />`),

        // Plain allowed classes
        valid(`
          import { Button } from "./ui/Button";
          export const X = () => <Button className="mb-4">Hi</Button>;
        `),

        // Multiple allowed tokens
        valid(`
          import { Button } from "./ui/Button";
          export const X = () => <Button className="mb-4 flex-1 w-full">Hi</Button>;
        `),

        // Responsive prefix — strips, underlying token is allowed
        valid(`
          import { Button } from "./ui/Button";
          export const X = () => <Button className="md:mt-4 lg:p-6">Hi</Button>;
        `),

        // State prefix — strips, underlying token is allowed
        valid(`
          import { Button } from "./ui/Button";
          export const X = () => <Button className="hover:mt-2 focus:p-4">Hi</Button>;
        `),

        // Multiple stacked prefixes
        valid(`
          import { Button } from "./ui/Button";
          export const X = () => <Button className="md:hover:mt-4">Hi</Button>;
        `),

        // Negative margin
        valid(`
          import { Button } from "./ui/Button";
          export const X = () => <Button className="-mt-2 -mx-4">Hi</Button>;
        `),

        // Positioning
        valid(`
          import { Button } from "./ui/Button";
          export const X = () => <Button className="absolute inset-0 z-50">Hi</Button>;
        `),

        // Dynamic className — skipped
        valid(`
          import { Button } from "./ui/Button";
          export const X = ({ cls }) => <Button className={cls}>Hi</Button>;
        `),

        // Template literal with expression — skipped
        valid(`
          import { Button } from "./ui/Button";
          export const X = ({ x }) => <Button className={\`mb-4 \${x}\`}>Hi</Button>;
        `),

        // Template literal WITHOUT expression — allowed tokens
        valid(`
          import { Button } from "./ui/Button";
          export const X = () => <Button className={\`mb-4 flex-1\`}>Hi</Button>;
        `),

        // No options.components configured → nothing is checked
        valid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="text-red-500 bg-plum shadow">Hi</Button>;
        `,
          [{}],
        ),

        // props option limits which attributes are checked
        valid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="text-red-500">Hi</Button>;
        `,
          [{ components: ["./ui/**"], props: ["layout"] }],
        ),

        // custom props option — the 'layout' prop is checked with allowed tokens
        valid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button layout="mb-4">Hi</Button>;
        `,
          [{ components: ["./ui/**"], props: ["layout"] }],
        ),

        // Deeper glob — imports from ./components/ui/Button match "./components/ui/**"
        valid(
          `
          import { Button } from "./components/ui/Button";
          export const X = () => <Button className="mb-4">Hi</Button>;
        `,
        ),

        // Namespace import: namespace object itself used as element name — no name collision
        valid(`
          import * as UI from "./ui/index";
          export const X = () => <UI.Button className="mb-4">Hi</UI.Button>;
        `),

        // Custom allowedPatterns — only allow m- prefixes
        valid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="m-4 mt-8">Hi</Button>;
        `,
          [{ components: ["./ui/**"], allowedPatterns: ["^m(t|r|b|l|x|y)?-.+$"] }],
        ),
      ],

      invalid: [
        // Appearance class is rejected
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="text-red-500">Hi</Button>;
        `,
          ["text-red-500"],
        ),

        // Container-layout class is rejected (flex display, not flex-1 item)
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="flex">Hi</Button>;
        `,
          ["flex"],
        ),

        // Inner-layout classes (gap, items-, justify-) are rejected
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="items-center gap-4">Hi</Button>;
        `,
          ["items-center", "gap-4"],
        ),

        // Background color rejected
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="bg-plum">Hi</Button>;
        `,
          ["bg-plum"],
        ),

        // Mixed: one allowed, one disallowed → only the disallowed reports
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="mb-4 shadow-lg">Hi</Button>;
        `,
          ["shadow-lg"],
        ),

        // Prefixed disallowed class — prefix stripped, core is checked
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="dark:text-white">Hi</Button>;
        `,
          ["dark:text-white"],
        ),

        // Responsive + state prefix on a disallowed core
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="md:hover:bg-plum">Hi</Button>;
        `,
          ["md:hover:bg-plum"],
        ),

        // Custom prop name: 'layout' is checked, appearance rejected
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button layout="text-red-500">Hi</Button>;
        `,
          [
            {
              messageId: "disallowedClass",
              data: { class: "text-red-500", component: "Button", prop: "layout" },
            },
          ],
          [{ components: ["./ui/**"], props: ["layout"] }],
        ),

        // Custom allowedPatterns: only 'm-*' allowed → 'p-4' rejected
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className="p-4">Hi</Button>;
        `,
          ["p-4"],
          [{ components: ["./ui/**"], allowedPatterns: ["^m(t|r|b|l|x|y)?-.+$"] }],
        ),

        // Template literal without expression, disallowed token
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = () => <Button className={\`text-red-500\`}>Hi</Button>;
        `,
          ["text-red-500"],
        ),
      ],
    });
  });
});
