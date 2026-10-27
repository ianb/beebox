import type { Rule } from "eslint";

// Bans `export default class`, which hides the class name from imports and
// from rename tooling. The rule and its messages come from eslint-config-agent
// (its `custom/no-default-class-export`), copied here so the preset no longer
// depends on that package. The autofix only deletes `default` from a named
// declaration; rebuilding an anonymous class from its parts dropped
// decorators, type parameters and `implements`, so those are reported unfixed. Registered as the `custom` plugin
// in `base-config.ts`, which keeps the rule key `custom/no-default-class-export`.
export const noDefaultClassExport: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow default class exports in favor of named exports" },
    fixable: "code",
    messages: {
      noDefaultClassDeclaration:
        "Default class exports are not allowed. Use named exports instead: 'export class {{className}} {}'.",
      noDefaultClassExpression:
        "Default class expressions are not allowed. Use named class declarations instead: 'export class ClassName {}'.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      ExportDefaultDeclaration(node) {
        const declaration = node.declaration;
        if (declaration.type === "ClassDeclaration") {
          const className = declaration.id?.name ?? "ClassName";
          context.report({
            node,
            messageId: "noDefaultClassDeclaration",
            data: { className },
            fix: declaration.id
              ? (fixer) => fixer.replaceText(node, sourceCode.getText(node).replace(/^export\s+default\s+/u, "export "))
              : null,
          });
        } else if (declaration.type === "ClassExpression") {
          context.report({ node, messageId: "noDefaultClassExpression" });
        }
      },
    };
  },
};
