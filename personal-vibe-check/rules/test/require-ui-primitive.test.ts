import { RuleTester } from "eslint";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import rule from "../require-ui-primitive.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

interface Entry {
  message: string;
  allowIn?: string[];
}

interface Options {
  elements?: Record<string, Entry>;
  roles?: Record<string, Entry>;
  attributes?: Record<string, Entry>;
}

const INPUT: Entry = { message: "Use a field.", allowIn: ["src/ui/fields/field.tsx"] };
const MENU: Entry = { message: "Use <Menu>.", allowIn: ["src/ui/Menu.tsx"] };
const HASPOPUP: Entry = { message: "Use <Menu> or <Popover>." };

const DEFAULT: Options = {
  elements: { input: INPUT },
  roles: { menu: MENU },
  attributes: { "aria-haspopup": HASPOPUP },
};

/** A file path under ESLint's working directory, as RuleTester runs it. */
function file(relative: string): string {
  return path.join(process.cwd(), relative);
}

function valid(code: string, spec?: { options?: Options; filename?: string }): RuleTester.ValidTestCase {
  return {
    code,
    options: [spec?.options ?? DEFAULT],
    filename: file(spec?.filename ?? "src/app/Thing.tsx"),
  };
}

function invalid(
  code: string,
  spec: { errors: RuleTester.TestCaseError[]; options?: Options; filename?: string },
): RuleTester.InvalidTestCase {
  return {
    code,
    errors: spec.errors,
    options: [spec.options ?? DEFAULT],
    filename: file(spec.filename ?? "src/app/Thing.tsx"),
  };
}

const element = (name: string, message: string): RuleTester.TestCaseError => ({
  messageId: "element",
  data: { name, message },
});
const role = (name: string, message: string): RuleTester.TestCaseError => ({
  messageId: "role",
  data: { name, message },
});
const attribute = (name: string, message: string): RuleTester.TestCaseError => ({
  messageId: "attribute",
  data: { name, message },
});

describe("require-ui-primitive: elements", () => {
  it("reports configured elements outside their owners", () => {
    tester.run("require-ui-primitive", rule, {
      valid: [
        valid("<div><span /></div>"),
        valid("<input />", { filename: "src/ui/fields/field.tsx" }),
        // A component of the same name, a member expression and a namespaced name are not elements.
        valid("<Input /> ", { options: { elements: { Input: INPUT } } }),
        valid("<ui.input />"),
        valid("<svg:input />"),
        valid("<input />", { options: {} }),
        valid("<input />", { options: { roles: { menu: MENU } } }),
      ],
      invalid: [
        invalid('<input type="text" />', { errors: [element("input", "Use a field.")] }),
        invalid("<div><input /><input></input></div>", {
          errors: [element("input", "Use a field."), element("input", "Use a field.")],
        }),
        // An owner of another tag is not an owner of this one.
        invalid("<input />", {
          options: {
            elements: {
              input: INPUT,
              select: { message: "Use SelectField.", allowIn: ["src/x.tsx"] },
            },
          },
          filename: "src/x.tsx",
          errors: [element("input", "Use a field.")],
        }),
        // allowIn globs match the whole relative path.
        invalid("<input />", {
          filename: "src/ui/fields/field.tsx.bak.tsx",
          errors: [element("input", "Use a field.")],
        }),
        invalid("<textarea />", {
          options: {
            elements: { textarea: { message: "Use TextareaField.", allowIn: ["src/ui/**/*.tsx"] } },
          },
          filename: "src/app/Thing.tsx",
          errors: [element("textarea", "Use TextareaField.")],
        }),
      ],
    });
  });

  it("reports a tag held in a local constant", () => {
    tester.run("require-ui-primitive", rule, {
      valid: [
        valid('const Box = "div"; <Box />'),
        valid('let Input = "input"; <Input />'),
        valid("function f(Input) { return <Input />; }"),
        valid('const Input = "input"; <Input />', { filename: "src/ui/fields/field.tsx" }),
        valid("const Input = other; <Input />"),
      ],
      invalid: [
        invalid('const Input = "input"; <Input />', { errors: [element("input", "Use a field.")] }),
        invalid('const Input = "input"; function f() { return <Input></Input>; }', {
          errors: [element("input", "Use a field.")],
        }),
        invalid('const Input = cond ? "input" : "div"; <Input />', {
          errors: [element("input", "Use a field.")],
        }),
      ],
    });
  });

  it("matches allowIn globs", () => {
    tester.run("require-ui-primitive", rule, {
      valid: [
        valid("<textarea />", {
          options: {
            elements: { textarea: { message: "Use TextareaField.", allowIn: ["src/ui/**/*.tsx"] } },
          },
          filename: "src/ui/fields/area.tsx",
        }),
      ],
      invalid: [],
    });
  });
});

describe("require-ui-primitive: roles", () => {
  it("reports static role values, token by token", () => {
    tester.run("require-ui-primitive", rule, {
      valid: [
        valid('<div role="list" />'),
        valid('<div role="menu" />', { filename: "src/ui/Menu.tsx" }),
        // Dynamic values are skipped.
        valid("<div role={kind} />"),
        valid("<div role={`${kind}`} />"),
        valid("<div role={open ? kind : 'none'} />"),
        valid('<div role="" />'),
        // A spread of a non-literal may carry a role; it is not read.
        valid("<div {...props} />"),
        valid("<div {...{ role: kind }} />"),
        valid("<div {...{ [key]: 'menu' }} />"),
        // A let, a parameter and an import are not static.
        valid("let r = 'menu'; <div role={r} />"),
        valid("function f(r) { return <div role={r} />; }"),
        valid("import { r } from './r'; <div role={r} />"),
      ],
      invalid: [
        invalid('<div role="menu" />', { errors: [role("menu", "Use <Menu>.")] }),
        invalid("<ul role={'menu'} />", { errors: [role("menu", "Use <Menu>.")] }),
        invalid("<ul role={`menu`} />", { errors: [role("menu", "Use <Menu>.")] }),
        invalid("<ul role={open ? 'menu' : 'list'} />", { errors: [role("menu", "Use <Menu>.")] }),
        invalid('<div role="presentation  menu" />', { errors: [role("menu", "Use <Menu>.")] }),
        // A literal object spread, a constant, and both together.
        invalid('<div {...{ role: "menu" }} />', { errors: [role("menu", "Use <Menu>.")] }),
        invalid('<div {...{ "role": "menu", ...{ "aria-haspopup": true } }} />', {
          errors: [role("menu", "Use <Menu>."), attribute("aria-haspopup", "Use <Menu> or <Popover>.")],
        }),
        invalid('const r = "menu"; <div role={r} />', { errors: [role("menu", "Use <Menu>.")] }),
        invalid('const a = "menu"; const b = a; <div role={b} />', {
          errors: [role("menu", "Use <Menu>.")],
        }),
        invalid('const r = "menu"; function f() { return <div {...{ role: r }} />; }', {
          errors: [role("menu", "Use <Menu>.")],
        }),
        // A component's role prop is checked too.
        invalid('<Panel role="menu" />', { errors: [role("menu", "Use <Menu>.")] }),
      ],
    });
  });
});

describe("require-ui-primitive: createElement", () => {
  const TS = { filename: "src/app/make.ts" };
  it("reports createElement calls from react", () => {
    tester.run("require-ui-primitive", rule, {
      valid: [
        valid('import { createElement } from "react"; createElement("div", null)', TS),
        valid('import React from "react"; React.createElement(Input, {})', TS),
        valid('import React from "react"; React.createElement(tag, {})', TS),
        valid('import { createElement } from "react"; createElement("input", {})', {
          filename: "src/ui/fields/field.tsx",
        }),
        // Not React's createElement.
        valid('const document = {}; document.createElement("input")', TS),
        valid('import { createElement } from "./h"; createElement("input")', TS),
        valid('function createElement() {} createElement("input")', TS),
        valid('import { createElement } from "react"; createElement("div", { role: kind })', TS),
      ],
      invalid: [
        invalid('import { createElement } from "react"; createElement("input", {})', {
          ...TS,
          errors: [element("input", "Use a field.")],
        }),
        invalid('import { createElement as h } from "react"; h("input")', {
          ...TS,
          errors: [element("input", "Use a field.")],
        }),
        invalid('import React from "react"; React.createElement("input", null)', {
          ...TS,
          errors: [element("input", "Use a field.")],
        }),
        invalid('import * as R from "react"; R.createElement(`input`)', {
          ...TS,
          errors: [element("input", "Use a field.")],
        }),
        invalid('import { createElement } from "react"; const tag = "input"; createElement(tag)', {
          ...TS,
          errors: [element("input", "Use a field.")],
        }),
        invalid(
          'import { createElement } from "react"; createElement("div", { role: "menu", "aria-haspopup": true })',
          {
            ...TS,
            errors: [role("menu", "Use <Menu>."), attribute("aria-haspopup", "Use <Menu> or <Popover>.")],
          },
        ),
        invalid('import { createElement } from "react"; createElement("div", { ...{ role: "menu" } })', {
          ...TS,
          errors: [role("menu", "Use <Menu>.")],
        }),
      ],
    });
  });
});

describe("require-ui-primitive: attributes", () => {
  it("reports configured attributes on any element", () => {
    tester.run("require-ui-primitive", rule, {
      valid: [
        valid('<button aria-expanded="true" />'),
        valid("<button aria-haspopup />", {
          options: {
            attributes: { "aria-haspopup": { message: "x", allowIn: ["src/app/*.tsx"] } },
          },
        }),
      ],
      invalid: [
        invalid('<button aria-haspopup="menu" />', {
          errors: [attribute("aria-haspopup", "Use <Menu> or <Popover>.")],
        }),
        invalid("<Trigger aria-haspopup={open} />", {
          errors: [attribute("aria-haspopup", "Use <Menu> or <Popover>.")],
        }),
      ],
    });
  });

  it("reports an element, its attribute and its role together", () => {
    tester.run("require-ui-primitive", rule, {
      valid: [],
      invalid: [
        invalid('<input role="menu" aria-haspopup="true" />', {
          errors: [
            element("input", "Use a field."),
            role("menu", "Use <Menu>."),
            attribute("aria-haspopup", "Use <Menu> or <Popover>."),
          ],
        }),
      ],
    });
  });
});

describe("require-ui-primitive: options", () => {
  it("rejects an entry without a message", () => {
    assert.throws(
      () =>
        tester.run("require-ui-primitive", rule, {
          valid: [{ code: "<input />", options: [{ elements: { input: { allowIn: [] } } }] }],
          invalid: [],
        }),
      /should have required property 'message'/,
    );
  });
});
