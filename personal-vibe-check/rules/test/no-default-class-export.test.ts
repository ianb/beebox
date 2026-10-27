import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import { noDefaultClassExport } from "../../preset/no-default-class-export.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaVersion: 2022, sourceType: "module" } },
});

describe("no-default-class-export", () => {
  it("flags default class exports and autofixes them to named exports", () => {
    tester.run("no-default-class-export", noDefaultClassExport, {
      valid: [
        "export class Foo {}",
        "class Foo {} export default Foo;",
        "export default function foo() {}",
        "export default {};",
      ],
      invalid: [
        {
          code: "export default class Foo extends Bar { run() {} }",
          output: "export class Foo extends Bar { run() {} }",
          errors: [{ messageId: "noDefaultClassDeclaration", data: { className: "Foo" } }],
        },
        {
          code: "export default class extends Bar { run() {} }",
          output: "export class ClassName extends Bar { run() {} }",
          errors: [{ messageId: "noDefaultClassDeclaration", data: { className: "ClassName" } }],
        },
        {
          code: "export default (class Named { run() {} });",
          output: "export class Named { run() {} }",
          errors: [{ messageId: "noDefaultClassExpression" }],
        },
      ],
    });
  });
});
