# Installing personal-vibe-check

Instructions for installing `@ianbicking/personal-vibe-check` into a TypeScript/React project. Written for agents — linear, prescriptive, with verification steps. For human-oriented documentation, see [`README.md`](./README.md).

## What this installs

A full static-analysis + formatting + pre-commit stack:

- **ESLint 9** with a curated rule set (the `vibeCheck()` preset from this package)
- **Prettier** with matching formatting rules
- **TypeScript** strict config (via `tsconfig.base.json`)
- **Knip** for dead-code / unused-export / unused-dependency detection
- **Madge** for circular-dependency detection
- **Oxlint** as a supplemental fast linter
- **Husky + lint-staged** pre-commit hook (formats + lints staged files)
- **Claude Code hook** (`PostToolUse`) that lints each file after it's edited/written

## Preferred: run `vibe-init`

Most projects should use the automated installer. It is idempotent — re-running it only creates things that are missing.

```bash
npm install --save-dev @ianbicking/personal-vibe-check
npx vibe-init
npx vibe-check
```

`vibe-init` prompts once for Knip's entry point (default: `src/index.ts`). Accept the default or provide your project's actual entry.

If `npx vibe-check` passes, the install is done. Stop here.

If `vibe-init` is not appropriate (see **When to go manual** below), skip to the manual section.

### What vibe-init creates

Concrete outputs, so you can evaluate whether to accept them:

1. Adds these scripts to `package.json` (only if missing): `typecheck`, `lint`, `format`, `format:check`, `lint:oxlint`, `lint:knip`, `lint:circular`, `prepare`.
2. Adds `lint-staged` config to `package.json`: `"src/**/*.{ts,tsx}": ["prettier --write", "eslint"]`.
3. Creates `eslint.config.mjs` importing `vibeCheck` (auto-detects React based on your `dependencies`).
4. Creates `prettier.config.mjs` re-exporting the shared Prettier config.
5. Creates `tsconfig.json` extending `@ianbicking/personal-vibe-check/tsconfig.base.json` — only if no `tsconfig.json` exists.
6. Creates `knip.json` with your entry point filled in.
7. Installs as devDependencies: `eslint@^9 prettier oxlint knip madge husky lint-staged`.
8. Runs `npx husky init` and writes `.husky/pre-commit` with `npx lint-staged` + `npm run typecheck`.
9. Adds a `PostToolUse` hook (`matcher: "Edit|Write"`, command: `npx vibe-check lint --hook`) to `.claude/settings.json`.
10. Copies `conventions.md` into the project root and appends `@conventions.md` to `CLAUDE.md` (creating CLAUDE.md if absent).

## When to go manual

Use the manual path instead of `vibe-init` when:

- The project is a **monorepo root** with per-workspace configs — `vibe-init` writes files at `cwd`, which may be the wrong scope. Run it per-workspace instead, or follow the manual steps per-workspace.
- The project **already has** `eslint.config.mjs` / `prettier.config.mjs` / `tsconfig.json` with non-trivial customizations — `vibe-init` skips existing files (will not overwrite), but you still need to merge manually.
- Running the npm install step is not acceptable right now (offline, sandboxed, CI-only install flow, etc.).

## Manual install

### 1. Install packages

```bash
npm install --save-dev @ianbicking/personal-vibe-check \
  eslint@^9 prettier oxlint knip madge husky lint-staged
```

ESLint must be pinned to v9 — v10 has breaking plugin incompatibilities. Other versions can float.

### 2. Create `eslint.config.mjs`

```js
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";

export default vibeCheck({
  react: true, // set to false for a Node/CLI project with no JSX
});
```

Optional advanced options:
- `ignores: ["dist/**", "generated/**"]` — extra glob patterns to ignore
- `restrictComponentClasses: { components: ["./components/ui/**"] }` — enable the `restrict-component-classes` rule for UI-component `className` hygiene (see `conventions.md`)

### 3. Create `prettier.config.mjs`

```js
export { default } from "@ianbicking/personal-vibe-check/prettier";
```

### 4. Create or update `tsconfig.json`

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

Remove `jsx` and `types` if the project has no JSX / no Node types. The base config handles `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, and friends — do not redeclare them.

### 5. Create `knip.json`

```json
{
  "$schema": "https://unpkg.com/knip@latest/schema.json",
  "entry": ["src/index.ts"],
  "project": ["src/**/*.{ts,tsx}"],
  "exclude": ["enumMembers", "duplicates", "types"]
}
```

Replace `src/index.ts` with the project's actual entry(ies). For a Vite/Next app, common entries include `src/main.tsx` or `src/app/**/page.tsx`.

### 6. Add `package.json` scripts

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "format": "prettier --write src/",
    "format:check": "prettier --check src/",
    "lint:oxlint": "oxlint -A no-unused-vars",
    "lint:knip": "knip",
    "lint:circular": "madge --circular --extensions ts,tsx src/",
    "prepare": "husky"
  },
  "lint-staged": {
    "src/**/*.{ts,tsx}": ["prettier --write", "eslint"]
  }
}
```

### 7. Set up hooks

**Husky pre-commit** (runs on `git commit`):

```bash
npx husky init
```

Then write `.husky/pre-commit`:
```
npx lint-staged
npm run typecheck
```

**Claude Code PostToolUse hook** (lints each file immediately after Claude edits/writes it). Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "npx vibe-check lint --hook" }
        ]
      }
    ]
  }
}
```

Create `.claude/` if it doesn't exist. Merge with existing hook config — do not replace the whole `hooks` object.

### 8. Install conventions

The package ships `conventions.md` — prose rules that ESLint cannot enforce (naming, error-handling patterns, file-size guidelines, etc.). Downstream agents should see them:

```bash
cp node_modules/@ianbicking/personal-vibe-check/conventions.md ./conventions.md
```

Then append `@conventions.md` to the project's `CLAUDE.md` (create it if absent) so Claude Code loads it automatically.

## Verification

After install (whether via `vibe-init` or manual), run:

```bash
npx vibe-check
```

This runs all five checks (`typecheck`, `lint`, `lint:oxlint`, `lint:knip`, `lint:circular`) in sequence, stopping on the first failure. If the project is freshly bootstrapped with no source yet, it passes trivially. If the project has existing code, expect errors — fix them before shipping.

Also verify the pre-commit hook:

```bash
git add . && git commit -m "test"
```

`lint-staged` should run. If it doesn't, `npx husky init` wasn't run or `.husky/pre-commit` is missing.

## Common failure modes

- **`npm error ERESOLVE`** on install — usually a React version mismatch between the project and the `eslint-plugin-react` bundled peer. Resolve by matching React versions, or install with `--legacy-peer-deps` if the conflict is spurious.
- **`Cannot find package '@ianbicking/personal-vibe-check'`** at lint time — the package is not installed at the eslint CLI's nearest `node_modules`. Common in monorepos when eslint runs from the root but the dep is in a workspace.
- **`Parsing error: Cannot read file 'tsconfig.json'`** from ESLint — the project root doesn't have a `tsconfig.json` that satisfies the TS-ESLint parser. Either create one (step 4 above) or pass `languageOptions.parserOptions.project` in `eslint.config.mjs`.
- **Husky hook doesn't run** — `git config core.hooksPath` points elsewhere, or `prepare` script wasn't run. Run `npm install` again to trigger `prepare`.
- **`vibe-check` reports "eslint: command not found"** — tools are installed at a different level (monorepo workspace vs root). Run `npx vibe-check` from the directory containing `node_modules/.bin/eslint`.

## Upgrading

```bash
npm update @ianbicking/personal-vibe-check
npx vibe-check
```

If rule changes surface new errors, fix them. The package follows semver — minor versions may tighten rules; major versions may require config changes. Review the commit log of this package for the "why" behind any new rule.
