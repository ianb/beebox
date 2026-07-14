/**
 * Local ESLint plugin enforcing the TEA (Elm-Architecture) sketch discipline.
 * Applied only to sketch dirs (examples/, experiments/) via eslint.config.mjs.
 * The types + runtime deep-freeze already make violations fail; these rules are
 * the belt that fails them at lint time, before a run, with a clear message.
 *
 * Rules:
 *   - no-module-state    — no top-level `let`/`var` (all state lives in Model).
 *   - no-model-mutation  — no assignment/delete/mutating-method on `model.…`.
 *   - no-async-sketch    — no async/await/.then/new Promise (runs are sync).
 *   - no-classes         — no class declarations/expressions.
 *
 * `no-classes` is a custom rule rather than a config-level `no-restricted-syntax`
 * entry on purpose: adding a second `no-restricted-syntax` for the sketch dirs
 * would replace (not extend) the vibe-check preset's own selectors there,
 * silently weakening the shared config. A standalone rule composes cleanly.
 */

/** Walk a MemberExpression chain down to its base object node. */
function rootObject(node) {
  let current = node;
  while (current.type === "MemberExpression") current = current.object;
  return current;
}

/** True when a MemberExpression is rooted at an identifier named `model`. */
function rootedAtModel(memberExpression) {
  const root = rootObject(memberExpression);
  return root.type === "Identifier" && root.name === "model";
}

// Array/Map/Set methods that mutate in place.
const MUTATORS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

const noModuleState = {
  meta: {
    type: "problem",
    docs: { description: "Disallow top-level let/var in sketch modules; all state lives in Model." },
    schema: [],
    messages: {
      moduleState:
        "No module-level `{{kind}}` in a sketch — all mutable state must live in Model and change only via `update`. Use `const` for fixed data/functions.",
    },
  },
  create(context) {
    return {
      VariableDeclaration(node) {
        if (node.parent.type !== "Program") return;
        if (node.kind === "const") return;
        context.report({ node, messageId: "moduleState", data: { kind: node.kind } });
      },
    };
  },
};

const noModelMutation = {
  meta: {
    type: "problem",
    docs: { description: "Disallow mutating a `model` parameter; return a new Model instead." },
    schema: [],
    messages: {
      mutation: "Don't mutate `model` — `update` must return a new Model. Build and return a fresh value instead.",
    },
  },
  create(context) {
    function report(node) {
      context.report({ node, messageId: "mutation" });
    }
    return {
      AssignmentExpression(node) {
        if (node.left.type === "MemberExpression" && rootedAtModel(node.left)) report(node);
      },
      UpdateExpression(node) {
        if (node.argument.type === "MemberExpression" && rootedAtModel(node.argument)) report(node);
      },
      UnaryExpression(node) {
        if (node.operator === "delete" && node.argument.type === "MemberExpression" && rootedAtModel(node.argument)) {
          report(node);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || !MUTATORS.has(callee.property.name)) return;
        if (rootedAtModel(callee)) report(node);
      },
    };
  },
};

const noAsyncSketch = {
  meta: {
    type: "problem",
    docs: { description: "Disallow async/await/.then/new Promise in sketch modules." },
    schema: [],
    messages: {
      async: "No async in a sketch — {{what}}. Runs are synchronous and deterministic.",
    },
  },
  create(context) {
    function reportAsyncFn(node) {
      if (node.async) context.report({ node, messageId: "async", data: { what: "`async` functions are not allowed" } });
    }
    return {
      FunctionDeclaration: reportAsyncFn,
      FunctionExpression: reportAsyncFn,
      ArrowFunctionExpression: reportAsyncFn,
      AwaitExpression(node) {
        context.report({ node, messageId: "async", data: { what: "`await` is not allowed" } });
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Promise") {
          context.report({ node, messageId: "async", data: { what: "`new Promise` is not allowed" } });
        }
      },
      MemberExpression(node) {
        if (!node.computed && node.property.type === "Identifier" && node.property.name === "then") {
          context.report({ node, messageId: "async", data: { what: "`.then` is not allowed" } });
        }
      },
    };
  },
};

const noClasses = {
  meta: {
    type: "problem",
    docs: { description: "Disallow class declarations/expressions in sketch modules." },
    schema: [],
    messages: {
      noClass: "No classes in a sketch — model state as plain data and modes as a discriminated-union field.",
    },
  },
  create(context) {
    function report(node) {
      context.report({ node, messageId: "noClass" });
    }
    return { ClassDeclaration: report, ClassExpression: report };
  },
};

const plugin = {
  meta: { name: "eslint-plugin-tea" },
  rules: {
    "no-module-state": noModuleState,
    "no-model-mutation": noModelMutation,
    "no-async-sketch": noAsyncSketch,
    "no-classes": noClasses,
  },
};

export default plugin;
