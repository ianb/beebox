import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import plugin from "../tea-lint.mjs";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

describe("tea/no-module-state", () => {
  it("allows const, but bans top-level let/var", () => {
    tester.run("no-module-state", plugin.rules["no-module-state"], {
      valid: [
        "const CENTER = 250;",
        "const make = () => ({ n: 0 });",
        "function update(model) { let local = 1; return { ...model, local }; }",
        "export function init() { let x = 0; return { x }; }",
      ],
      invalid: [
        { code: "let count = 0;", errors: [{ messageId: "moduleState", data: { kind: "let" } }] },
        { code: "var flag = true;", errors: [{ messageId: "moduleState", data: { kind: "var" } }] },
      ],
    });
  });
});

describe("tea/no-model-mutation", () => {
  it("allows reads and spreads, bans mutation of model.…", () => {
    tester.run("no-model-mutation", plugin.rules["no-model-mutation"], {
      valid: [
        "function update(model) { return { ...model, x: 1 }; }",
        "const next = model.items.map((i) => i);",
        "const y = model.a.b;",
        "other.push(1);",
        "const arr = [...model.items]; arr.push(1);",
      ],
      invalid: [
        { code: "model.x = 1;", errors: [{ messageId: "mutation" }] },
        { code: "model.a.b = 2;", errors: [{ messageId: "mutation" }] },
        { code: "model.items[0] = 3;", errors: [{ messageId: "mutation" }] },
        { code: "model.items.push(1);", errors: [{ messageId: "mutation" }] },
        { code: "model.items.splice(0, 1);", errors: [{ messageId: "mutation" }] },
        { code: "model.set.add(1);", errors: [{ messageId: "mutation" }] },
        { code: "delete model.x;", errors: [{ messageId: "mutation" }] },
        { code: "model.n++;", errors: [{ messageId: "mutation" }] },
      ],
    });
  });
});

describe("tea/no-async-sketch", () => {
  it("bans async, await, .then, and new Promise", () => {
    tester.run("no-async-sketch", plugin.rules["no-async-sketch"], {
      valid: [
        "function update(model) { return model; }",
        "const draw = (v) => { v.circle(1, 2, 3); };",
      ],
      invalid: [
        { code: "async function f() {}", errors: [{ messageId: "async" }] },
        { code: "const g = async () => {};", errors: [{ messageId: "async" }] },
        { code: "await something;", errors: [{ messageId: "async" }] },
        { code: "promise.then(handle);", errors: [{ messageId: "async" }] },
        { code: "new Promise((resolve) => resolve());", errors: [{ messageId: "async" }] },
      ],
    });
  });
});

describe("tea/no-classes", () => {
  it("bans class declarations and expressions", () => {
    tester.run("no-classes", plugin.rules["no-classes"], {
      valid: ["const model = { mode: { type: 'idle' } };"],
      invalid: [
        { code: "class Planet {}", errors: [{ messageId: "noClass" }] },
        { code: "const C = class {};", errors: [{ messageId: "noClass" }] },
      ],
    });
  });
});
