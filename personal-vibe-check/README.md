# @ianbicking/personal-vibe-check

Opinionated TypeScript/React lint and static analysis preset. Bundles ESLint with 200+ reviewed rules, strict TypeScript config, and tooling for dead code detection and circular dependency checks.

## Quick Start

For an existing TypeScript project with a `package.json`:

```bash
npm install --save-dev @ianbicking/personal-vibe-check
npx vibe-init
```

`vibe-init` will:
1. Add npm scripts (`typecheck`, `lint`, `lint:oxlint`, `lint:knip`, `lint:circular`)
2. Create `eslint.config.mjs` importing the preset
3. Create `tsconfig.json` extending the base config (if none exists)
4. Create `knip.json` for dead code detection
5. Install CLI tools (`eslint`, `oxlint`, `knip`, `madge`) as devDependencies
6. Set up husky + lint-staged with a pre-commit hook

Then run all checks:

```bash
npx vibe-check
```

## Manual Setup

If you prefer to set things up yourself instead of using `vibe-init`:

### 1. Install

```bash
npm install --save-dev @ianbicking/personal-vibe-check eslint oxlint knip madge husky lint-staged
```

The package bundles all ESLint plugins as dependencies — you don't need to install them individually.

### 2. ESLint Config

Create `eslint.config.mjs`:

```js
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";
export default vibeCheck({ react: true });
```

Options:
- `react` (boolean) — include React hooks and JSX rules. Default: `false`.
- `ignores` (string[]) — additional glob patterns to ignore.

### 3. TypeScript Config

Create or update `tsconfig.json`:

```json
{
  "extends": "@ianbicking/personal-vibe-check/tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

The base config provides: `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noEmit`, `isolatedModules`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `resolveJsonModule`, `skipLibCheck`. Target ES2022, module ESNext, moduleResolution bundler.

Add project-specific options like `jsx`, `lib`, `types`, `include`, `exclude` yourself.

### 4. Knip Config (dead code detection)

Create `knip.json`:

```json
{
  "$schema": "https://unpkg.com/knip@latest/schema.json",
  "entry": ["src/index.ts"],
  "project": ["src/**/*.{ts,tsx}"],
  "exclude": ["enumMembers", "duplicates", "types"]
}
```

Set `entry` to your actual entry points. Add `ignore` and `ignoreDependencies` as needed.

### 5. Package Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "lint:oxlint": "oxlint -A no-unused-vars",
    "lint:knip": "knip",
    "lint:circular": "madge --circular --extensions ts,tsx src/",
    "prepare": "husky"
  },
  "lint-staged": {
    "src/**/*.{ts,tsx}": ["eslint"]
  }
}
```

### 6. Pre-commit Hook

```bash
npx husky init
```

Write `.husky/pre-commit`:

```
npx lint-staged
npm run typecheck
```

## The Five Checks

| Script | Tool | What it catches |
|--------|------|-----------------|
| `npm run typecheck` | `tsc --noEmit` | Type errors |
| `npm run lint` | ESLint | Code quality, style, security, React hooks |
| `npm run lint:oxlint` | oxlint | Ambiguous constructors, useless spreads, identical ternary branches |
| `npm run lint:knip` | knip | Unused files, exports, dependencies |
| `npm run lint:circular` | madge | Circular dependency chains (type-only cycles are OK) |

`npx vibe-check` runs all five in sequence, stopping on the first failure.

## Coding Conventions

The `CONVENTIONS.md` file in this package contains coding rules to add to your project's `CLAUDE.md` (or equivalent AI assistant instructions). The key rules enforced by lint:

- **Semicolons**: always
- **Quotes**: double quotes
- **No optional chaining** (`?.`): use explicit null checks
- **No default parameters**: handle defaults in function body
- **Max 2 positional parameters**: use a named params object for more
- **No `any` type**: enforced by both tsconfig and eslint
- **Catch must bind the error**: `catch(e)` not bare `catch`
- **Custom error classes**: not `new Error()` — enables programmatic error inspection
- **Files max 300 lines**, functions max 150 lines (excluding blanks/comments)
- **Only export what's needed**: knip detects unused exports
- **`import type` for type-only imports**

See `CONVENTIONS.md` for the full template with examples.

## What's Bundled

The package includes these as dependencies (you don't install them):

- `eslint`, `@eslint/js`, `@eslint/eslintrc`
- `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `typescript-eslint`
- `eslint-config-agent` (base rule set — all rules reviewed and selectively enabled/disabled)
- `eslint-plugin-import`, `eslint-plugin-react`, `eslint-plugin-react-hooks`
- `eslint-plugin-security`, `eslint-plugin-class-export`, `eslint-plugin-n`

Your project installs separately (as devDependencies):

- `eslint`, `oxlint`, `knip`, `madge` — CLI tools invoked by npm scripts
- `husky`, `lint-staged` — pre-commit hook infrastructure
- `typescript` — peer dependency (>= 5)

## Linking for Local Development

If you're developing the package alongside a project:

```bash
# In your project directory:
npm link ../personal-vibe-check
```

Note: `npm link` doesn't hoist binaries from the linked package, so you still need `eslint`, `oxlint`, `knip`, and `madge` as direct devDependencies in the consuming project.
