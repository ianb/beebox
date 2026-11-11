# Coding Conventions

Add these to your project's AGENTS.md (or CLAUDE.md, or equivalent AI assistant instructions).

## Type Checking and Linting

Run checks after writing code. The build tool (esbuild) does NOT do type checking or linting — it just strips types. A pre-commit hook runs both automatically.

```bash
npm run typecheck    # TypeScript errors
npm run lint         # ESLint errors
npm run format:check # Prettier formatting check (or `npm run format` to auto-fix)
npm run lint:oxlint  # Supplemental linter (fast, catches patterns ESLint misses)
npm run lint:knip    # Dead code detector (unused files, exports, dependencies)
npm run lint:circular  # Circular dependency detector (oxlint import/no-cycle)
```

- The tsconfig is strict — no implicit `any` allowed
- ESLint config is in `eslint.config.ts` with rules reviewed individually
- oxlint provides supplemental checks (ambiguous constructors, useless spreads, identical ternary branches, etc.) — run periodically, not in pre-commit
- knip detects unused files, exports, and dependencies — run periodically to catch dead code
- `lint:circular` detects circular dependencies — type-only cycles (`import type`) are acceptable, value import cycles are not

## Error Handling

- NEVER use `any` type (enforced via tsconfig and eslint)
- NEVER use bare `catch {}` — always bind the error: `catch(e)` to log it, or `catch(_e)` if truly unused
- ONLY catch the minimal, specific error you can handle
- If there's an error boundary with recovery, ALWAYS log the error somewhere
- Never silently ignore errors — at minimum log them
- Use custom error classes, not `new Error()` — enables programmatic error inspection

## React Compiler Compatibility

The linter enforces React Compiler rules (`react-hooks/*`). These ensure components and hooks follow patterns the compiler can optimize. Key points:

- Components and hooks must be **pure** — no side effects during render
- Never **mutate** props, state, or context — treat them as immutable
- Don't read **mutable globals** during render — pass values as props or use context
- Don't call **setState during render** — it causes infinite loops
- Keep **refs** out of render output — read/write refs only in effects and handlers
- `useMemo`/`useCallback` memoization must not be broken by surrounding code

Some rules flag code that **works correctly but can't be optimized** by the compiler:

- `react-hooks/unsupported-syntax` — the compiler skips this code. Refactor if possible; if the pattern is intentional, suppress with `// eslint-disable-next-line react-hooks/unsupported-syntax`
- `react-hooks/incompatible-library` — a third-party library isn't compiler-compatible. Suppress if no alternative exists: `// eslint-disable-next-line react-hooks/incompatible-library`

When suppressing these rules, add a comment explaining why.

## Code Style

Prettier handles formatting (indentation, line wrapping, spacing) automatically. It runs on staged files at pre-commit via lint-staged — no need to run it manually during development.

- **Semicolons**: always (enforced by eslint and prettier)
- **Quotes**: double quotes (enforced by eslint and prettier)
- **`as` type assertions** are banned in `.tsx` (and discouraged everywhere) — treat `as` like Rust's `unsafe`: allowed only when genuinely necessary (e.g. an untyped parse boundary), and then either guarded with an `// eslint-disable-next-line no-restricted-syntax -- <why>` comment or centralized in one typed helper. `as const` is always fine.
- **No default parameters**: handle defaults explicitly in function body
- **Max 2 positional parameters**: functions with more must use a named params object:
  ```typescript
  // Bad: too many positional params
  function save(path: string, content: string, hash: string) { ... }

  // Good: named params object
  function save(path: string, { content, hash }: SaveOptions) { ... }
  ```
- **Consistent naming between variables and parameters**: name object properties to match common variable names at call sites, so callers can use shorthand:
  ```typescript
  // Good: property names match local variables, enabling shorthand
  const content = readFile(path);
  const hash = computeHash(content);
  save(path, { content, hash });

  // Bad: property names don't match, forcing verbose call sites
  save(path, { fileContent: content, contentHash: hash });
  ```
- Prefer explicit types over inference where it aids readability
- Use meaningful variable names
- Files max 300 lines, functions max 150 lines (excluding blanks/comments)
- **Only export what's needed**: don't export functions/constants only used within their own file. knip enforces this.

## Enter Handlers and IME Composition

With `react: true`, `personal-vibe-check/ime-safe-enter` reports a keydown
handler that acts on Enter without checking IME composition. Enter also
confirms text typed through a Japanese, Chinese or Korean input method; a
handler that submits on it submits half-typed text. Return early first:

```ts
export function isComposing(event: KeyboardEvent): boolean {
  // Safari ends a composition with isComposing false but keyCode 229.
  return event.isComposing || event.keyCode === 229;
}

<input onKeyDown={(e) => { if (e.key === "Enter" && !isComposing(e.nativeEvent)) submit(); }} />
```

The rule checks functions given to JSX `onKeyDown`/`onKeyPress` (inline, or
a function or const in the same file) and to `addEventListener("keydown" |
"keypress", fn)`. A guard reads `isComposing`, `229`, or the `"Process"`
key, and it must control the Enter test: negated in the same `&&` chain or an
enclosing `if`, or an earlier `if (<guard>) return;` in an enclosing block. A
guard that is only logged, or comes after the action, does not count. No
options.

### Limitations

- Handlers on `<button>`, `<a>`, or an element with a button-like `role`
  are skipped: Enter activates them. The rule cannot see what a component
  renders, so `<TextField onKeyDown>` and `<Button onKeyDown>` are both
  checked.
- An Enter test that also requires Ctrl, Meta or Alt, and an Enter branch
  that only calls `preventDefault`/`stopPropagation`, are skipped.
- Handlers imported from another module are not checked.

## Names on Generic Elements

With `react: true`, `personal-vibe-check/aria-label-needs-role` reports
`aria-label` on a `div`, `span`, `p`, `i` or `b` that has no `role`. A generic
element exposes no accessible name, so screen readers never read the label.
Pick a role by what the element is:

```tsx
<div role="group" aria-label="Background tasks">...</div>   // labelled cluster
<div role="status" aria-busy="true" aria-label="Loading">...</div> // placeholder
<div role="img" aria-label="Pairing QR code" />              // drawn picture
```

or drop the label. No options.

### Limitations

- An element with a spread attribute is skipped, since the spread may carry
  the role.
- Only those five elements are checked; components are not, because the rule
  cannot see what they render.
- It does not check that the chosen role accepts a name.

## Native Dialogs

With `react: true`, `personal-vibe-check/prefer-native-dialog` reports a JSX
element other than `dialog` that has `role="dialog"` or `role="alertdialog"`.
Use a native `<dialog>` opened with `showModal()` for a modal, or a popover for
a non-modal overlay. A native modal dialog traps focus, closes on Escape and
makes the page behind it inert. A custom overlay has to set `inert` on the page
behind it. A true exception takes one
`// eslint-disable-next-line personal-vibe-check/prefer-native-dialog -- <reason>`.
No options.

### Limitations

- An element with a spread attribute, or a `role` that is not a string
  literal, is skipped.
- Components are not checked: a component that passes `role="dialog"` down to
  a `div` is invisible to the rule.
- `role="dialog foo"` (a token list) is not reported.

## Viewport Height Classes (opt-in, Tailwind)

The rule `personal-vibe-check/no-viewport-height-class` bans `h-screen`,
`min-h-screen`, `max-h-screen` (and `h-[100vh]` spellings) in `className`
strings. They are `100vh`, which overshoots the visible area on mobile Safari;
use `h-dvh`, `min-h-dvh`, `max-h-dvh`. It is not in the preset because it is
Tailwind-specific. Enable it in a Tailwind project's own config:

```ts
{ files: ["src/**/*.{ts,tsx}"], rules: { "personal-vibe-check/no-viewport-height-class": "error" } }
```

No options.

### Limitations

- Checks string literals and template text inside a `className` attribute,
  including `cn(...)` arguments and conditionals. Class names built in a
  separate const or another prop are not checked.

## Pixel Font Size Classes (opt-in, Tailwind)

The rule `personal-vibe-check/no-px-font-size-class` bans `text-[<n>px]` in
`className` strings. A pixel font size ignores the browser's default font
size, so text does not grow for a person who raised it. Write the size in rem:
px / 16, to at most four decimals with no trailing zeros (`text-[11px]` becomes
`text-[0.6875rem]`). A `/leading` suffix (`text-[11px]/4`) is reported too. It
is not in the preset because it is Tailwind-specific. Enable it in a Tailwind
project's own config:

```ts
{ files: ["src/**/*.{ts,tsx}"], rules: { "personal-vibe-check/no-px-font-size-class": "error" } }
```

No options.

### Limitations

- Checks string literals and template text inside a `className` attribute,
  including `cn(...)` arguments and conditionals. Class names built in a
  separate const or another prop are not checked.
- CSS `font-size: 11px` is not checked.

## Restricted Classes (opt-in)

The rule `personal-vibe-check/restricted-classes` bans configured class
patterns or combinations outside the files that own them. Use it when a
project has one primitive for a visual shape (a spinner, an anchored panel)
and a copy of the shape elsewhere should fail lint. Configure it in the
project's own config:

```ts
{
  files: ["src/**/*.tsx"],
  rules: {
    "personal-vibe-check/restricted-classes": ["error", {
      entries: [
        { all: ["animate-spin"], allowIn: ["src/components/ui/Spinner.tsx"], message: "Use <Spinner>." },
      ],
    }],
  },
}
```

**Options:**

- `entries` (required): `{ all: Pattern[], none?: Pattern[], allowIn?: string[], message: string }[]`.
  An entry fires on a class set that holds every `all` pattern and no `none`
  pattern. `allowIn` lists the owning files, as globs relative to ESLint's
  working directory; from another directory they match nothing.
- `callees` (default `["cn", "clsx", "twMerge"]`): class helpers whose
  arguments are read, anywhere in the file.
- `stylePosition`: `{ values: string[], allowIn?: string[], message }` bans
  inline `style={{ position: "fixed" }}` for the listed values.

**Patterns:** `[variants:]utility-glob`, where `*` matches any characters
(`focus-visible:ring-*`). Responsive variants (`sm`, `md`, `lg`, `xl`, `2xl`)
and `dark` are ignored; every other variant on a class must be in the
pattern, so `hover:ring-2` does not match `focus-visible:ring-*`. `|`
separates alternatives (`outline-none|focus:outline-none`); `!` adds an
exclusion (`focus:outline-*!focus:outline-none`).

**Reading:** string literals, template literals (a token touching `${}` is
dropped), `a ? x : y`, `a && x`, `a || x`, and class helper arguments
including arrays and object keys (`clsx({ fixed: open })`). The classes that
always render are checked alone and with each conditional operand on its own.

### Limitations

- A class string in an identifier or member expression (`className={classes}`)
  is not read.
- Two conditional operands are never combined, so a banned combination split
  across two independent operands (`a && "absolute"`, `b && "top-full z-50"`)
  is missed.
- `twMerge` overrides are not simulated: `cn("fixed", "static")` is reported.
- A class string in a prop other than `className` is read only through a
  class helper call.

## Required UI Primitives (opt-in)

The rule `personal-vibe-check/require-ui-primitive` bans configured intrinsic
elements, ARIA roles and attributes outside the files that own them. Use it
when a project has a primitive for a control (a text field, a menu) and a raw
`<input>` or `role="menu"` elsewhere should fail lint. Configure it in the
project's own config:

```ts
{
  files: ["src/**/*.tsx"],
  rules: {
    "personal-vibe-check/require-ui-primitive": ["error", {
      elements: {
        input: { allowIn: ["src/components/ui/fields/field.tsx"], message: "Use a field primitive." },
      },
      roles: { menu: { allowIn: ["src/components/ui/Menu.tsx"], message: "Use <Menu>." } },
      attributes: { "aria-haspopup": { message: "Use <Menu> or <Popover>." } },
    }],
  },
}
```

**Options:** `elements`, `roles` and `attributes`, each a map from a name to
`{ message: string, allowIn?: string[] }`. `allowIn` lists the owning files, as
globs relative to ESLint's working directory, as in `restricted-classes`.
List each owning file; a directory glob exempts every new file in it.

- `elements`: a JSX element whose name is the lower-case tag.
- `roles`: a static `role` value (string, template with no expressions, or
  the branches of `a ? x : y`) on any element, token by token.
- `attributes`: the attribute on any element, whatever its value.

### Limitations

- Components are not elements: the rule cannot see what they render.
- A role or attribute passed through a spread, and a role held in an
  identifier, are not read.
- `React.createElement("input")` is not checked.

## Component Name Suffixes (opt-in)

The rule `personal-vibe-check/component-name-suffix` bans configured suffixes
on component names. Use it when a project has settled one word per overlay
kind (`Dialog`, `Popover`, `Menu`) and a `ThingModal` or `ThingPopup` would
read as a second kind. Configure it in the project's own config:

```ts
{
  files: ["src/**/*.tsx"],
  rules: {
    "personal-vibe-check/component-name-suffix": ["error", {
      banned: { Modal: "Name it ...Dialog and render <ModalDialog>.", Popup: "Name it ...Popover or ...Menu." },
      allowIn: ["src/components/ui/BboxOverlay.tsx"],
    }],
  },
}
```

**Options:** `banned`, a map from a suffix to the message naming the agreed
word; `allowIn`, files skipped entirely, as globs relative to ESLint's working
directory (as in `restricted-classes`).

A name is checked when it starts with an upper-case letter and belongs to a
function declaration or a `const` whose value is a function expression, an
arrow function, or a `memo(...)`/`forwardRef(...)` call.

### Limitations

- It checks names only, not what the component renders.
- Classes, anonymous default exports, destructured names and components
  built another way (`const X = makeComponent()`) are not checked.

## Restricting `className` on Components (opt-in)

The rule `personal-vibe-check/restrict-component-classes` enforces the convention:

> **Components own their appearance. Callers can only pass outer-layout classes** (margin, padding, flex/grid item behavior, sizing, position) via the `className` prop.

Appearance changes (colors, fonts, borders, shadows) go through the component's typed intent/variant props — not className. This keeps the component's visual contract intact while letting callers control how it sits in the surrounding layout.

**Enable in your project's `eslint.config.ts`:**

```js
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default vibeCheck({
  react: true,
  restrictComponentClasses: {
    // Glob patterns matched against import source paths.
    // Any component imported from a matching path is subject to the rule.
    components: ["./ui/**", "./components/ui/**"],
  },
});
```

**Default allowlist** covers: margins, padding, sizing (`w-*`, `h-*`, `size-*`, `max-*`, `min-*`), flex item behavior (`flex-1`, `grow`, `shrink`, `basis-*`, `order-*`, `self-*`), grid item behavior (`col-*`, `row-*`), positioning (`absolute`, `relative`, `inset-*`, `top-*` etc.), z-index, and `aspect-*`. Responsive (`md:`, `lg:`, ...) and state (`hover:`, `focus:`, `dark:`, ...) prefixes are transparent — the rule validates the underlying utility.

**Options:**
- `components`: array of glob patterns for import sources. Use `*` for one segment, `**` for many. Required unless `matchAll` is set.
- `matchAll` (default `false`): when `true`, check every JSX element's `className` in the file — native HTML (`<div>`, `<span>`, ...), local components, and imported components alike. `components` is ignored when this is on. Use together with ESLint's `files`/`ignores` to scope to "page-level" code.
- `props` (default `["className"]`): prop names to validate.
- `allowedPatterns` (default: built-in layout list): array of regex source strings. Replaces the built-in list if provided.

**Two-tier pattern** — restrict UI components everywhere, restrict everything (including `<div>`) outside `components/` subdirectories:

```js
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default [
  // Base: imported UI components restricted everywhere
  ...vibeCheck({
    react: true,
    restrictComponentClasses: {
      components: ["./components/ui/**", "./ui/**"],
    },
  }),
  // Stricter: outside components/, check every element
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/components/**"],
    rules: {
      "personal-vibe-check/restrict-component-classes": [
        "error",
        { matchAll: true },
      ],
    },
  },
];
```

Files inside `components/` (where appearance classes legitimately live) fall back to the base rule — only imported UI components are restricted. Files outside `components/` (pages, renderers, app-shell) get the stricter rule — even `<div className="bg-white shadow">` is rejected.

**Limitations:**
- Only static strings and template literals without expressions are validated. Dynamic expressions like `className={cls}` are silently skipped.
- Barrel/re-export files: the rule checks the direct `import from` source in the file using the component. If components are re-exported through a barrel, add the barrel path to `components` too.
