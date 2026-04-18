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

        // Template literal with plain identifier expression — static parts
        // allowed, identifier contributes no known tokens
        valid(`
          import { Button } from "./ui/Button";
          export const X = ({ x }) => <Button className={\`mb-4 \${x}\`}>Hi</Button>;
        `),

        // Template literal WITHOUT expression — allowed tokens
        valid(`
          import { Button } from "./ui/Button";
          export const X = () => <Button className={\`mb-4 flex-1\`}>Hi</Button>;
        `),

        // Conditional expression — both branches are allowed tokens
        valid(`
          import { Button } from "./ui/Button";
          export const X = ({ big }) => <Button className={big ? "p-6" : "p-2"}>Hi</Button>;
        `),

        // Template literal with a conditional expression — all fragments allowed
        valid(`
          import { Button } from "./ui/Button";
          export const X = ({ wide }) => <Button className={\`flex-1 \${wide ? "w-full" : "w-auto"}\`}>Hi</Button>;
        `),

        // Logical && — right side is allowed
        valid(`
          import { Button } from "./ui/Button";
          export const X = ({ narrow }) => <Button className={narrow && "mx-auto"}>Hi</Button>;
        `),

        // Nested conditionals — all branches allowed
        valid(`
          import { Button } from "./ui/Button";
          export const X = ({ size }) => <Button className={size === "lg" ? "p-6" : size === "sm" ? "p-1" : "p-3"}>Hi</Button>;
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

        // matchAll off (default): native div with disallowed class is NOT checked
        valid(
          `<div className="text-red-500 bg-plum shadow-lg" />`,
          [{ components: ["./ui/**"] }],
        ),

        // matchAll on: allowed tokens on a native element pass
        valid(
          `<div className="mb-4 flex-1 w-full" />`,
          [{ matchAll: true }],
        ),

        // matchAll on: dynamic className on a native element is skipped
        valid(
          `export const X = ({ cls }) => <div className={cls} />;`,
          [{ matchAll: true }],
        ),

        // matchAll on: element with no className prop is ignored
        valid(
          `<div />`,
          [{ matchAll: true }],
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

        // matchAll: native div with disallowed class is reported
        invalid(
          `<div className="text-red-500" />`,
          [
            {
              messageId: "disallowedClass",
              data: { class: "text-red-500", component: "div", prop: "className" },
            },
          ],
          [{ matchAll: true }],
        ),

        // matchAll: non-imported local component is checked
        invalid(
          `
          function Widget() { return null; }
          export const X = () => <Widget className="shadow-lg" />;
        `,
          [
            {
              messageId: "disallowedClass",
              data: { class: "shadow-lg", component: "Widget", prop: "className" },
            },
          ],
          [{ matchAll: true }],
        ),

        // matchAll: 'components' option is ignored — every element is checked
        invalid(
          `<div className="bg-plum" />`,
          [
            {
              messageId: "disallowedClass",
              data: { class: "bg-plum", component: "div", prop: "className" },
            },
          ],
          [{ matchAll: true, components: ["./nowhere/**"] }],
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

        // Conditional — disallowed class in one branch is reported
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = ({ err }) => <Button className={err ? "bg-danger" : "mt-2"}>Hi</Button>;
        `,
          ["bg-danger"],
        ),

        // Conditional — disallowed class in both branches, each reported once
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = ({ on }) => <Button className={on ? "bg-primary" : "bg-warm-200"}>Hi</Button>;
        `,
          ["bg-primary", "bg-warm-200"],
        ),

        // Template literal embeds a conditional with disallowed classes
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = ({ open }) => <Button className={\`flex-1 \${open ? "" : "hidden sm:flex"}\`}>Hi</Button>;
        `,
          ["hidden", "sm:flex"],
        ),

        // Logical && — disallowed class on right side reported
        invalid(
          `
          import { Button } from "./ui/Button";
          export const X = ({ bad }) => <Button className={bad && "bg-danger"}>Hi</Button>;
        `,
          ["bg-danger"],
        ),
      ],
    });
  });
});
