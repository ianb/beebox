# Code Style

General coding conventions for backend and frontend. UI palette and primitive reference live in FRONTEND.md.

## Type Checking and Linting

Run checks after writing code. The build tool (esbuild) does NOT do type checking or linting — it just strips types. A pre-commit hook runs both automatically.

```bash
pnpm typecheck    # TypeScript errors
pnpm lint         # ESLint errors
pnpm lint:oxlint  # Supplemental linter (fast, catches patterns ESLint misses)
pnpm lint:knip    # Dead code detector (unused files, exports, dependencies)
pnpm lint:circular  # Circular dependency detector (madge)
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

## Code Style

- **Semicolons**: always (enforced by eslint)
- **Quotes**: double quotes (enforced by eslint)
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
- **`as` type assertions are like Rust's `unsafe`** (banned in `.tsx` by lint, discouraged everywhere): allowed only when genuinely necessary — e.g. at a parse boundary where data arrives untyped. When you need one, either guard it with an `// eslint-disable-next-line no-restricted-syntax -- <why it's sound>` comment, or centralize the cast in a single well-named typed helper (`getChildren(el): ElementNode[]`) that does it once and is reused. Never sprinkle bare `as` to silence the type checker. (`as const` is always fine.)
- Prefer explicit types over inference where it aids readability
- Use meaningful variable names
- Files max 300 lines, functions max 150 lines (excluding blanks/comments)
- **Only export what's needed**: don't export functions/constants only used within their own file. Not currently knip-enforced — `knip.json` excludes the `exports` check because the codebase has a backlog of ~277 unused exports; enforce this by convention/review until that backlog is cleared.
