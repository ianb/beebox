# Coding Conventions

Add these to your project's CLAUDE.md (or equivalent AI assistant instructions).

## Type Checking and Linting

Run checks after writing code. The build tool (esbuild) does NOT do type checking or linting — it just strips types. A pre-commit hook runs both automatically.

```bash
npm run typecheck    # TypeScript errors
npm run lint         # ESLint errors
npm run format:check # Prettier formatting check (or `npm run format` to auto-fix)
npm run lint:oxlint  # Supplemental linter (fast, catches patterns ESLint misses)
npm run lint:knip    # Dead code detector (unused files, exports, dependencies)
npm run lint:circular  # Circular dependency detector (madge)
```

- The tsconfig is strict — no implicit `any` allowed
- ESLint config is in `eslint.config.mjs` with rules reviewed individually
- oxlint provides supplemental checks (ambiguous constructors, useless spreads, identical ternary branches, etc.) — run periodically, not in pre-commit
- knip detects unused files, exports, and dependencies — run periodically to catch dead code
- madge detects circular dependencies — type-only cycles (`import type`) are acceptable, value import cycles are not

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
- **No optional chaining** (`?.`): use explicit null checks for clarity
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
