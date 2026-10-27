import type { Rule } from "eslint";
import type { ClassBody, Expression } from "estree";

// Bans `export default class`, which hides the class name from imports and
// from rename tooling. The rule and its messages come from eslint-config-agent
// (its `custom/no-default-class-export`), copied here with its autofix so the
// preset no longer depends on that package. Registered as the `custom` plugin
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
    const namedExport = (cls: { body: ClassBody; superClass?: Expression | null }, className: string): string => {
      const body = sourceCode.getText(cls.body);
      const superClass = cls.superClass ? ` extends ${sourceCode.getText(cls.superClass)}` : "";
      return `export class ${className}${superClass} ${body}`;
    };
    return {
      ExportDefaultDeclaration(node) {
        const declaration = node.declaration;
        if (declaration.type === "ClassDeclaration") {
          const className = declaration.id?.name ?? "ClassName";
          context.report({
            node,
            messageId: "noDefaultClassDeclaration",
            data: { className },
            fix: (fixer) =>
              fixer.replaceText(
                node,
                declaration.id
                  ? sourceCode.getText(node).replace(/^export\s+default\s+/, "export ")
                  : namedExport(declaration, className),
              ),
          });
        } else if (declaration.type === "ClassExpression") {
          const className = declaration.id?.name ?? "ClassName";
          context.report({
            node,
            messageId: "noDefaultClassExpression",
            fix: (fixer) => fixer.replaceText(node, namedExport(declaration, className)),
          });
        }
      },
    };
  },
};
