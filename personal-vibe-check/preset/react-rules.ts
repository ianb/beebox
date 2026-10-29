import type { Linter } from "eslint";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";

// React-specific rules — only included when the react option is true.
export const reactRules: Linter.RulesRecord = {
  // jsx-a11y recommended, minus no-autofocus. ~15 rules catching real
  // accessibility bugs (interactive elements without keyboard
  // handlers, images/inputs without labels, invalid anchors, etc.).
  // no-autofocus is off because it fights a deliberate autofocus (e.g.
  // a chat composer that should grab focus on mount).
  ...jsxA11yPlugin.flatConfigs.recommended.rules,
  "jsx-a11y/no-autofocus": "off",
  // Every control has an accessible name. Screen readers, agents
  // driving the UI, and tests that click by role + name all need one;
  // an icon-only button with only `title` is the usual miss.
  // Recommended ships this "off" with these options; they are kept.
  // The rule sees native elements only: a component's own label prop
  // (e.g. a Button's `label`) is enforced by its types instead.
  "jsx-a11y/control-has-associated-label": [
    "error",
    {
      ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
      ignoreRoles: ["grid", "listbox", "menu", "menubar", "radiogroup", "row", "tablist", "toolbar", "tree", "treegrid"],
      includeRoles: ["alert", "dialog"],
    },
  ],
  // Not in recommended. A focusable element hidden from assistive tech
  // can take focus while announcing nothing.
  "jsx-a11y/no-aria-hidden-on-focusable": "error",
  // Not in recommended. Link text such as "click here" or "link" names
  // nothing out of context.
  "jsx-a11y/anchor-ambiguous-text": "error",
  // prefer-tag-over-role stays off: it asks for <output> on every
  // role="status" and <hr> for separators, which is churn without a
  // user-visible gain.
  // React hooks
  "react-hooks/rules-of-hooks": "error",
  "react-hooks/exhaustive-deps": "error",
  // React Compiler rules — enforce patterns compatible with automatic memoization
  "react-hooks/config": "error",
  "react-hooks/error-boundaries": "error",
  "react-hooks/component-hook-factories": "error",
  "react-hooks/gating": "error",
  "react-hooks/globals": "error",
  "react-hooks/immutability": "error",
  "react-hooks/preserve-manual-memoization": "error",
  "react-hooks/purity": "error",
  "react-hooks/refs": "error",
  "react-hooks/set-state-in-effect": "error",
  "react-hooks/set-state-in-render": "error",
  "react-hooks/static-components": "error",
  "react-hooks/unsupported-syntax": "error",
  "react-hooks/use-memo": "error",
  "react-hooks/incompatible-library": "error",
  // React JSX
  "react/jsx-no-useless-fragment": "error",
  "react/self-closing-comp": "error",
  "react/no-unknown-property": "error",
  "react/jsx-no-target-blank": "error",
  "react/jsx-filename-extension": ["error", { extensions: [".tsx", ".jsx"] }],
  // Boolean props must start with is/has/should/can/did/will
  "react/boolean-prop-naming": "error",
  // <input checked> requires onChange or readOnly — prevents uncontrolled/controlled mismatch
  "react/checked-requires-onchange-or-readonly": "error",
  // defaultProps values must have matching propType declarations
  "react/default-props-match-prop-types": "error",
  // Require displayName on components — helps React DevTools and error messages
  "react/display-name": "error",
  // Require forwardRef components to actually use the ref parameter
  "react/forward-ref-uses-ref": "error",
  // useState must destructure as [value, setValue] — symmetric naming
  "react/hook-use-state": "error",
  // Omit `={true}` on boolean JSX attributes — <Foo disabled /> not <Foo disabled={true} />
  "react/jsx-boolean-value": "error",
  // Use shorthand <></> fragment syntax instead of <React.Fragment>
  "react/jsx-fragments": "error",
  // Event handler props must be named on*/handle* — onX for props, handleX for definitions
  "react/jsx-handler-names": "error",
  // Require key prop on elements in arrays/iterators
  "react/jsx-key": "error",
  // Cap JSX nesting depth — encourages extracting sub-components
  "react/jsx-max-depth": ["error", { max: 4 }],
  // Disabled: arrow functions in JSX props create new refs each render, but React Compiler
  // auto-memoizes and the perf impact is negligible for most UI. Too noisy for the value.
  // "react/jsx-no-bind": "error",
  // Catch accidental comment text in JSX (e.g. {/* comment */} not // comment)
  "react/jsx-no-comment-textnodes": "error",
  // Wrap context values in useMemo — prevents unnecessary consumer re-renders
  "react/jsx-no-constructed-context-values": "error",
  // Prevent leaked renders like {count && <Foo/>} rendering "0"
  "react/jsx-no-leaked-render": "error",
  // No javascript: URLs in JSX — XSS risk
  "react/jsx-no-script-url": "error",
  // Don't spread the same props object more than once
  "react/jsx-props-no-spread-multi": "error",
  // Enforce consistent spacing: <tag /> and <tag></tag> (no space before closing >)
  "react/jsx-tag-spacing": [
    "error",
    {
      closingSlash: "never",
      beforeSelfClosing: "always",
      afterOpening: "never",
      beforeClosing: "never",
    },
  ],
  // Catch deprecated React APIs (createClass, componentWillMount, etc.)
  "react/no-deprecated": "error",
  // Catch invalid HTML attribute values (e.g. bad `rel` values on <a>/<link>)
  "react/no-invalid-html-attribute": "error",
  // Void elements (<br>, <img>, etc.) must not have children or dangerouslySetInnerHTML
  "react/void-dom-elements-no-children": "error",
  // NOTE: react/forbid-elements is not enabled globally but is useful per-project
  // to enforce a component vocabulary (e.g. ban <button> in favor of <Button>).
  // Enable it in your project's eslint config with the elements you want to restrict.
  // NOTE: react/jsx-no-duplicate-props, react/jsx-no-undef, and react/prop-types
  // are skipped — TypeScript already catches these.
};
