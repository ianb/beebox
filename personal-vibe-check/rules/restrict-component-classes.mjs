/**
 * ESLint rule: restrict which Tailwind-style classes may appear on the
 * `className` prop (or configurable prop names) of designated components.
 *
 * Designed to enforce the convention:
 *   > Components own their appearance. Callers can only pass OUTER-LAYOUT
 *   > classes (margin, padding, flex/grid item behavior, sizing, position).
 *
 * A component's own file can use any classes internally. This rule only
 * checks call sites — places where the caller instantiates a UI component
 * and passes a `className` string.
 *
 * Which components are "UI components" is configured per-project by listing
 * the import source paths where they live (globs). Any JSX element whose
 * name was imported from a matching source is subject to the rule.
 *
 * Limitations:
 *   - Only string literals and template literals without expressions are
 *     validated. Dynamic expressions like `className={foo}` are skipped.
 *   - Re-exports / barrel files: the rule looks at the direct import source
 *     in the file using the component. If the project uses barrel exports,
 *     add the barrel path to the `components` patterns too.
 */

/**
 * Default allowlist of token patterns. Each entry is a RegExp.source string
 * applied against tokens after any responsive/state prefixes (`md:`, `hover:`
 * etc.) have been stripped.
 *
 * The allowlist intentionally excludes:
 *   - display classes (flex, grid, block, hidden) — these are inner layout
 *     of the component's own content, not outer positioning
 *   - inner-layout classes (items-*, justify-*, gap-*, space-*) — likewise
 *   - appearance classes (colors, fonts, borders, shadows) — use component
 *     intent/variant props instead
 */
const DEFAULT_ALLOWED_PATTERNS = [
  // Margin (including negative)
  "^-?(m|mt|mr|mb|ml|mx|my|ms|me)-.+$",
  // Padding
  "^(p|pt|pr|pb|pl|px|py|ps|pe)-.+$",
  // Sizing — width/height/size
  "^(w|h|size)-.+$",
  "^(min|max)-(w|h)-.+$",
  // Flex item behavior (not container)
  "^flex-(1|auto|initial|none)$",
  "^(shrink|grow)(-0)?$",
  "^basis-.+$",
  "^order-.+$",
  "^self-(auto|start|end|center|stretch|baseline)$",
  // Grid item behavior (not container)
  "^col-(auto|full|span-.+|start-.+|end-.+)$",
  "^row-(auto|full|span-.+|start-.+|end-.+)$",
  "^justify-self-(auto|start|end|center|stretch)$",
  "^place-self-(auto|start|end|center|stretch)$",
  // Positioning
  "^(static|fixed|absolute|relative|sticky)$",
  "^-?(inset|top|right|bottom|left)(-x|-y)?-.+$",
  "^-?z-.+$",
  // Aspect ratio — shapes the outer box
  "^aspect-.+$",
];

const DEFAULT_PROPS = ["className"];
const DEFAULT_COMPONENT_PATTERNS = [];

/**
 * Convert a simple glob to a RegExp.
 * Supports `*` (one segment) and `**` (any number of segments).
 * Everything else is treated literally.
 */
function globToRegex(glob) {
  let out = "^";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      out += ".*";
      i += 2;
      // Consume a following "/" so "**/foo" matches "foo" as well as "a/foo"
      if (glob[i] === "/") i += 1;
    } else if (c === "*") {
      out += "[^/]*";
      i += 1;
    } else if (/[.+?^${}()|[\]\\]/.test(c)) {
      out += "\\" + c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  out += "$";
  return new RegExp(out);
}

function matchesAnyGlob(source, patterns) {
  for (const pattern of patterns) {
    if (globToRegex(pattern).test(source)) return true;
  }
  return false;
}

/**
 * Strip Tailwind variant/modifier prefixes (everything up to and including
 * the final `:`). Leaves the underlying utility untouched.
 */
function stripPrefixes(token) {
  const lastColon = token.lastIndexOf(":");
  return lastColon === -1 ? token : token.slice(lastColon + 1);
}

/**
 * Collect every string fragment that *could* appear in the resulting className
 * at runtime, walking into template literals, conditional expressions, and the
 * right side of logical expressions. Expressions we can't reason about (plain
 * identifiers, call expressions, member expressions, etc.) contribute nothing,
 * so they're implicitly skipped — the rule only flags tokens it can prove will
 * show up.
 *
 * Returns an array of strings. Each string is later split into whitespace-
 * separated class tokens by the caller.
 */
function collectStringFragments(expr) {
  if (!expr) return [];
  if (expr.type === "Literal" && typeof expr.value === "string") {
    return [expr.value];
  }
  if (expr.type === "TemplateLiteral") {
    const out = [];
    for (const q of expr.quasis) {
      if (q.value.cooked) out.push(q.value.cooked);
    }
    for (const e of expr.expressions) {
      out.push(...collectStringFragments(e));
    }
    return out;
  }
  if (expr.type === "ConditionalExpression") {
    return [...collectStringFragments(expr.consequent), ...collectStringFragments(expr.alternate)];
  }
  if (expr.type === "LogicalExpression") {
    // For `&&` / `||` / `??`, the right side is what ends up assigned when the
    // test keeps the value. The left is a boolean/nullish gate — its string
    // value (if any) doesn't survive.
    return collectStringFragments(expr.right);
  }
  return [];
}

function extractStringFragments(valueNode) {
  if (valueNode === null || valueNode === undefined) return [];
  if (valueNode.type === "Literal" && typeof valueNode.value === "string") {
    return [valueNode.value];
  }
  if (valueNode.type === "JSXExpressionContainer") {
    return collectStringFragments(valueNode.expression);
  }
  return [];
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Restrict classes on designated components to a layout-only allowlist (margin, padding, flex/grid item behavior, sizing, position).",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          /**
           * Glob patterns matched against the `from "..."` source of imports
           * that bring in a UI component. A JSX element whose name was
           * imported from a matching source is subject to the rule.
           * Ignored when `matchAll: true`.
           */
          components: {
            type: "array",
            items: { type: "string" },
          },
          /**
           * When true, check every JSX element in the file — native HTML
           * elements (`<div>`, `<span>`, ...), locally-defined components,
           * and imported components alike — regardless of import source.
           * Use together with ESLint's `files`/`ignores` to scope the rule
           * to "page-level" code where appearance classes shouldn't live.
           *
           * Default: false. Mutually exclusive with `components` in effect:
           * when `matchAll` is true, `components` is ignored.
           */
          matchAll: { type: "boolean" },
          /**
           * Prop names to validate. Default: ["className"].
           */
          props: {
            type: "array",
            items: { type: "string" },
          },
          /**
           * Regex sources (strings) for allowed token shapes. Each token
           * (after stripping responsive/state prefixes) must match at least
           * one pattern. Omit to use the built-in layout allowlist.
           */
          allowedPatterns: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    ],
    messages: {
      disallowedClass:
        "Class '{{class}}' is not allowed on <{{component}}> — the {{prop}} prop only accepts layout classes (margin, padding, flex/grid item, sizing, position). Appearance belongs to component props, not className.",
      dynamicValue:
        "<{{component}} {{prop}}={...}> uses a dynamic value the rule cannot validate. Prefer a static string of layout classes.",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const matchAll = options.matchAll === true;
    const componentPatterns = options.components || DEFAULT_COMPONENT_PATTERNS;
    const propNames = new Set(options.props || DEFAULT_PROPS);
    const allowedPatterns = (options.allowedPatterns || DEFAULT_ALLOWED_PATTERNS).map(
      (p) => new RegExp(p),
    );

    // Imported component name → source (for elements we should check).
    // Unused when `matchAll` is true.
    const importedComponents = new Map();

    function isAllowedToken(token) {
      const core = stripPrefixes(token);
      for (const pattern of allowedPatterns) {
        if (pattern.test(core)) return true;
      }
      return false;
    }

    function reportDisallowed(node, componentName, propName, bad) {
      context.report({
        node,
        messageId: "disallowedClass",
        data: { class: bad, component: componentName, prop: propName },
      });
    }

    const visitors = {
      JSXAttribute(node) {
        const propName = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (propName === null || !propNames.has(propName)) return;

        const opening = node.parent;
        if (!opening || opening.type !== "JSXOpeningElement") return;
        const nameNode = opening.name;
        if (nameNode.type !== "JSXIdentifier") return;
        const componentName = nameNode.name;

        if (!matchAll && !importedComponents.has(componentName)) return;

        const fragments = extractStringFragments(node.value);
        const seen = new Set();
        for (const fragment of fragments) {
          for (const token of fragment.split(/\s+/).filter(Boolean)) {
            if (seen.has(token)) continue;
            seen.add(token);
            if (!isAllowedToken(token)) {
              reportDisallowed(node, componentName, propName, token);
            }
          }
        }
      },
    };

    // Only track imports when we need to discriminate by import source
    if (!matchAll) {
      visitors.ImportDeclaration = function (node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        if (!matchesAnyGlob(source, componentPatterns)) return;
        for (const spec of node.specifiers) {
          if (
            spec.type === "ImportSpecifier" ||
            spec.type === "ImportDefaultSpecifier" ||
            spec.type === "ImportNamespaceSpecifier"
          ) {
            importedComponents.set(spec.local.name, source);
          }
        }
      };
    }

    return visitors;
  },
};

export default rule;
export { DEFAULT_ALLOWED_PATTERNS };
