import baseConfig from "eslint-config-agent";
import unicornPlugin from "eslint-plugin-unicorn";

// ── Enabled rules ──────────────────────────────────────────────────
// Rules reviewed and accepted. Each has a comment explaining why.
const enabledRules = {
  // Prevents @ts-ignore/@ts-nocheck from silencing the compiler; @ts-expect-error with description still allowed
  "@typescript-eslint/ban-ts-comment": "error",
  // Prefer `interface` over `type` for object shapes
  "@typescript-eslint/consistent-type-definitions": "error",
  // Use `import type` for type-only imports — erased at compile time, helps bundle size
  "@typescript-eslint/consistent-type-imports": "error",
  // Ban Array() constructor — confusing behavior (new Array(3) !== [3]). Use [] instead.
  "@typescript-eslint/no-array-constructor": "error",
  // All zero-violation TS-recommended rules — catch real bugs, no ongoing cost
  "@typescript-eslint/no-duplicate-enum-values": "error",
  "@typescript-eslint/no-empty-object-type": "error",
  "@typescript-eslint/no-extra-non-null-assertion": "error",
  "@typescript-eslint/no-misused-new": "error",
  "@typescript-eslint/no-namespace": "error",
  "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
  "@typescript-eslint/no-require-imports": "error",
  "@typescript-eslint/no-this-alias": "error",
  "@typescript-eslint/no-unnecessary-type-constraint": "error",
  "@typescript-eslint/no-unsafe-declaration-merging": "error",
  "@typescript-eslint/no-unsafe-function-type": "error",
  "@typescript-eslint/no-unused-expressions": "error",
  "@typescript-eslint/no-wrapper-object-types": "error",
  "@typescript-eslint/prefer-as-const": "error",
  "@typescript-eslint/prefer-namespace-keyword": "error",
  "@typescript-eslint/triple-slash-reference": "error",
  // Ban explicit `any` — enforces noImplicitAny via tsconfig; this catches deliberate any shortcuts
  "@typescript-eslint/no-explicit-any": "error",
  // Catch dead code: unused imports, variables, parameters. Underscore prefix opts out.
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],

  // ── JS correctness (eslint recommended) ──────────────────────────
  "constructor-super": "error",
  "for-direction": "error",
  "getter-return": "error",
  "no-async-promise-executor": "error",
  "no-case-declarations": "error",
  "no-class-assign": "error",
  "no-compare-neg-zero": "error",
  "no-cond-assign": "error",
  "no-const-assign": "error",
  "no-constant-binary-expression": "error",
  "no-constant-condition": "error",
  "no-control-regex": "error",
  "no-debugger": "error",
  "no-delete-var": "error",
  "no-dupe-args": "error",
  "no-dupe-class-members": "error",
  "no-dupe-else-if": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-empty": "error",
  "no-empty-character-class": "error",
  "no-empty-pattern": "error",
  "no-empty-static-block": "error",
  "no-ex-assign": "error",
  "no-extra-boolean-cast": "error",
  "no-fallthrough": "error",
  "no-func-assign": "error",
  "no-global-assign": "error",
  "no-import-assign": "error",
  "no-invalid-regexp": "error",
  "no-irregular-whitespace": "error",
  "no-loss-of-precision": "error",
  "no-misleading-character-class": "error",
  "no-new-native-nonconstructor": "error",
  "no-nonoctal-decimal-escape": "error",
  "no-obj-calls": "error",
  "no-octal": "error",
  "no-prototype-builtins": "error",
  "no-redeclare": "error",
  "no-regex-spaces": "error",
  "no-self-assign": "error",
  "no-setter-return": "error",
  "no-shadow-restricted-names": "error",
  "no-sparse-arrays": "error",
  "no-this-before-super": "error",
  "no-unexpected-multiline": "error",
  "no-unreachable": "error",
  "no-unsafe-finally": "error",
  "no-unsafe-negation": "error",
  "no-unsafe-optional-chaining": "error",
  "no-unused-labels": "error",
  "no-unused-private-class-members": "error",
  "no-useless-backreference": "error",
  "no-useless-catch": "error",
  "no-useless-escape": "error",
  "no-var": "error",
  "no-with": "error",
  "prefer-const": "error",
  "prefer-promise-reject-errors": "error",
  "prefer-rest-params": "error",
  "prefer-spread": "error",
  "require-yield": "error",
  "use-isnan": "error",
  "valid-typeof": "error",

  // ── Import rules ─────────────────────────────────────────────────
  "import/first": "error",
  "import/newline-after-import": "error",
  "import/no-absolute-path": "error",

  // ── Security ─────────────────────────────────────────────────────
  "security/detect-bidi-characters": "error",
  "security/detect-buffer-noassert": "error",
  "security/detect-child-process": "error",
  "security/detect-disable-mustache-escape": "error",
  "security/detect-eval-with-expression": "error",
  "security/detect-new-buffer": "error",
  "security/detect-no-csrf-before-method-override": "error",
  "security/detect-non-literal-require": "error",
  "security/detect-possible-timing-attacks": "error",
  "security/detect-pseudoRandomBytes": "error",
  "security/detect-non-literal-regexp": "error",

  // ── Opinionated rules (kept) ─────────────────────────────────────
  // Enforce `as` style type assertions (not angle-bracket)
  "@typescript-eslint/consistent-type-assertions": "error",
  // Don't use new Symbol() (deprecated)
  "no-new-symbol": "error",
  // No variable shadowing
  "no-shadow": "error",
  // Limit cyclomatic complexity — JSX render functions may disable this
  complexity: ["error", 25],
  // No trailing whitespace
  "no-trailing-spaces": "error",
  // Enforce semicolons
  semi: ["error", "always"],
  // Double quotes, allow single to avoid escaping
  quotes: ["error", "double", { avoidEscape: true }],
  // No `export default class` — use named exports
  "custom/no-default-class-export": "error",
  // No default params — handle defaults explicitly in function body for visibility
  "default/no-default-params": "error",
  // No optional chaining (?.) — use explicit null checks for clarity
  "no-optional-chaining/no-optional-chaining": "error",
  // Don't throw non-Error values — ensures stack traces are always available
  "error/no-throw-literal": "error",
  // Use custom error classes, not new Error() — enables programmatic error inspection
  "error/no-generic-error": "error",
  "error/require-custom-error": "error",
  // No string literals in Error constructors — custom error classes define their own messages
  "error/no-literal-error-message": "error",

  // ── Unicorn rules ───────────────────────────────────────────────
  // Simplify regex where possible (e.g. [0-9] → \d)
  "unicorn/better-regex": "error",
  // Enforce === -1 / !== -1 for indexOf/findIndex checks
  "unicorn/consistent-existence-index-check": "error",
  // Enforce correct custom Error subclass pattern
  "unicorn/custom-error-definition": "error",
  // No whitespace inside empty braces — `{}` not `{ }`
  "unicorn/empty-brace-spaces": "error",
  // Uppercase hex escape sequences — \xAB not \xab
  "unicorn/escape-case": "error",
  // Require explicit .length > 0 instead of truthiness check on .length
  "unicorn/explicit-length-check": "error",
  // kebab-case for most files, PascalCase allowed for React components
  // Disabled: too disruptive for existing codebases with mixed naming
  // "unicorn/filename-case": ["error", { cases: { kebabCase: true, pascalCase: true } }],
  // Use `new` with builtins that require it (Map, Set, Promise, etc.)
  "unicorn/new-for-builtins": "error",
  // Use for-of instead of .forEach() — better control flow (break/continue/return)
  "unicorn/no-array-for-each": "error",
  // Array methods don't use thisArg in practice — likely a bug
  "unicorn/no-array-method-this-argument": "error",
  // Use .toReversed() instead of mutating .reverse()
  "unicorn/no-array-reverse": "error",
  // Use .toSorted() instead of mutating .sort()
  "unicorn/no-array-sort": "error",
  // Use for-of instead of C-style for (let i = 0; ...) loops
  "unicorn/no-for-loop": "error",
  // Use \u escapes not \x — \u is clearer and works for all code points
  "unicorn/no-hex-escape": "error",
  // Use Array.isArray() / typeof instead of unreliable instanceof on builtins
  "unicorn/no-instanceof-builtins": "error",
  // Catch invalid fetch() options (e.g. typo in method name)
  "unicorn/no-invalid-fetch-options": "error",
  // Use Array.from({length: n}) instead of confusing new Array(n)
  "unicorn/no-new-array": "error",
  // Use Buffer.alloc/Buffer.from instead of deprecated new Buffer()
  "unicorn/no-new-buffer": "error",
  // Don't alias `this` — use arrow functions or bind instead
  "unicorn/no-this-assignment": "error",
  // Use direct undefined check, not typeof x === "undefined"
  "unicorn/no-typeof-undefined": "error",
  // Ban unreadable IIFEs with arrow expression bodies
  "unicorn/no-unreadable-iife": "error",
  // Drop useless empty args on collection constructors (new Set([]) → new Set())
  "unicorn/no-useless-collection-argument": "error",
  // Don't pass undefined explicitly when it's the default
  "unicorn/no-useless-undefined": "error",
  // Drop unnecessary .0 fractions — 1.0 → 1
  "unicorn/no-zero-fractions": "error",
  // Lowercase hex in number literals — 0xFF not 0XFF
  "unicorn/number-literal-case": "error",
  // Use .find() instead of .filter()[0]
  "unicorn/prefer-array-find": "error",
  // Use .some() instead of .filter().length or .find() !== undefined
  "unicorn/prefer-array-some": "error",
  // Use blob.text()/blob.arrayBuffer() instead of FileReader
  "unicorn/prefer-blob-reading-methods": "error",
  // Use class fields instead of this.x = ... in constructor
  "unicorn/prefer-class-fields": "error",
  // Use String#codePointAt() instead of charCodeAt() — handles full Unicode
  "unicorn/prefer-code-point": "error",
  // Use Date.now() instead of new Date().getTime()
  "unicorn/prefer-date-now": "error",
  // Use import.meta.url/filename/dirname instead of __filename/__dirname
  "unicorn/prefer-import-meta-properties": "error",
  // Use .includes() instead of .indexOf() !== -1
  "unicorn/prefer-includes": "error",
  // Use KeyboardEvent.key instead of deprecated .keyCode/.charCode/.which
  "unicorn/prefer-keyboard-event-key": "error",
  // Use modern Math APIs (Math.hypot, Math.trunc, etc.) over manual equivalents
  "unicorn/prefer-modern-math-apis": "error",
  // Use `node:` protocol for Node.js built-in imports
  "unicorn/prefer-node-protocol": "error",
  // Use .trimStart()/.trimEnd() instead of deprecated .trimLeft()/.trimRight()
  "unicorn/prefer-string-trim-start-end": "error",
  // Require explicit separator in .join() — .join(",") not .join()
  "unicorn/require-array-join-separator": "error",
  // Require digits argument in .toFixed() — .toFixed(2) not .toFixed()
  "unicorn/require-number-to-fixed-digits-argument": "error",
  // Require targetOrigin in postMessage() for security
  "unicorn/require-post-message-target-origin": "error",
  // Always use `new` with throw — `throw new Error()` not `throw Error()`
  "unicorn/throw-new-error": "error",

  // ── Restricted syntax ─────────────────────────────────────────────
  // Catch must bind the error — prevents silently swallowing errors
  "no-restricted-syntax": [
    "error",
    {
      selector: "CatchClause:not([param])",
      message:
        "Catch clause must bind the error (use catch(e) instead of catch).",
    },
  ],

  // ── Parameter limits ──────────────────────────────────────────────
  // Max 2 positional params — use named params (options object) for more
  "max-params": ["error", 2],

  // ── Size limits ────────────────────────────────────────────────────
  // Keep files under 300 lines (excluding blanks/comments)
  "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
  // Keep functions under 150 lines (excluding blanks/comments)
  "max-lines-per-function": [
    "error",
    { max: 150, skipBlankLines: true, skipComments: true },
  ],
};

// ── Disabled rules ─────────────────────────────────────────────────
// Rules reviewed and rejected. Each has a comment explaining why.
const disabledRules = {
  // Redundant with TypeScript — TS already catches undeclared variables
  "no-undef": "off",
  // Superseded by @typescript-eslint/no-unused-vars which understands TS
  "no-unused-vars": "off",
  // Namespace imports (import * as) are fine
  "import/no-namespace": "off",
  // Pure style rule — not worth the churn
  "import/order": "off",
  // Non-literal filenames are common in apps
  "security/detect-non-literal-fs-filename": "off",
  // Flags all obj[variable] bracket access — too many false positives
  "security/detect-object-injection": "off",
  // ReDoS risk is negligible in most apps
  "security/detect-unsafe-regex": "off",
  // Broken eslint-import-resolver-typescript setup
  "import/no-extraneous-dependencies": "off",
  // One export per file — doesn't match typical module architecture
  "single-export/single-export": "off",
  // Requires className on every JSX element — nonsensical
  "custom/jsx-classname-required": "off",
  // Every file needs a test file — not everyone's testing strategy
  "ddd/require-spec-file": "off",
  // Bans URLs in code — API endpoints and config URLs are fine
  "default/no-hardcoded-urls": "off",
  // Bans localhost — dev servers use it
  "default/no-localhost": "off",
  // Forces internal classes to be exported
  "class-export/class-export": "off",
  "required-exports/required-exports": "off",
};

/**
 * Build the set of all rule keys from the base config so we can turn them off
 * before applying our reviewed rules.
 */
function allRulesOffFrom(config) {
  const off = {};
  for (const entry of config) {
    if (entry.rules) {
      for (const key of Object.keys(entry.rules)) {
        off[key] = "off";
      }
    }
  }
  return off;
}

/**
 * Returns a flat ESLint config array.
 *
 * @param {object} [options]
 * @param {boolean} [options.react] — include React/JSX rules (default: false)
 * @param {string[]} [options.ignores] — additional ignore patterns
 */
export function vibeCheck(options) {
  const react = options && options.react;
  const extraIgnores = (options && options.ignores) || [];

  const allRulesOff = allRulesOffFrom(baseConfig);

  // React-specific rules — only included when react option is true
  const reactRules = react
    ? {
        // React hooks
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "error",
        // React JSX
        "react/jsx-no-useless-fragment": "error",
        "react/self-closing-comp": "error",
        "react/no-unknown-property": "error",
        "react/jsx-no-target-blank": "error",
        "react/jsx-filename-extension": [
          "error",
          { extensions: [".tsx", ".jsx"] },
        ],
      }
    : {};

  const reactSettings = react ? { react: { version: "detect" } } : {};

  const filePatterns = react
    ? ["src/**/*.{ts,tsx,js,jsx}"]
    : ["src/**/*.{ts,js}"];

  return [
    ...baseConfig,
    {
      ignores: [
        "node_modules/**",
        "dist/**",
        "build/**",
        "out/**",
        "*.mjs",
        ...extraIgnores,
      ],
    },
    {
      files: filePatterns,
      plugins: {
        unicorn: unicornPlugin,
      },
      settings: {
        ...reactSettings,
      },
      rules: {
        ...allRulesOff,
        ...enabledRules,
        ...reactRules,
        ...disabledRules,
      },
    },
  ];
}

// Default export for backward compatibility
export default vibeCheck;
