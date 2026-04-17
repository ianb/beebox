# Coding Conventions

## Type Checking and Linting

Run checks after writing code. The build tool (esbuild) does NOT do type checking or linting — it just strips types. A pre-commit hook runs both automatically.

```bash
npm run typecheck    # TypeScript errors
npm run lint         # ESLint errors
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

## Code Style

- **Semicolons**: always (enforced by eslint)
- **Quotes**: double quotes (enforced by eslint)
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

## Data Source Tagging

UI elements that display data from a known source (card, commit, session, etc.) must be tagged with `data-cb-source` attributes for traceability. Use the `cbSource()` and `cbSourceItem()` helpers from `src/frontend/src/lib/source-tag.ts`. Tag the outermost meaningful data boundary — not every inner element. See `docs/data-source-tagging.md` for the full convention.

## Frontend Color Palette

Components reach for **semantic color roles**, not brand names. Defined in `src/frontend/tailwind.config.js`.

| Role | Use for | Shades |
|------|---------|--------|
| `primary` | Main brand actions, links, selected state | DEFAULT, dark (hover), light, 50, 100 |
| `accent` | Highlights, CTAs, focus rings, warning-lite | DEFAULT, dark, light, 50, 100 |
| `info` | Informational callouts, metadata badges | DEFAULT, dark, light, muted, 50, 100 |
| `danger` | Destructive actions, error messages | DEFAULT, dark, light, 50, 100 |
| `success` | Positive confirmations, connected state | DEFAULT, dark, light, 50, 100 |
| `warning` | Caution, dirty state, notes | DEFAULT, dark, light, 50, 100 |
| `coral` | App-nav gradient only (no semantic role) | DEFAULT, dark, light, 50 |
| `warm-50`..`warm-900` | Neutral surface + text scale (backgrounds, body text, borders) | Self-documenting scale |

**Rules:**
- **Never** use Tailwind defaults (`red-*`, `green-*`, `yellow-*`, `amber-*`, `purple-*`, `gray-*`, `blue-*`, etc.) for appearance. They're not part of the brand palette. The one exception is `gray-*` in dark-overlay UI (CapturePage, CommandRunner) that's intentionally Tailwind-default dark-theme.
- **Never** add new colors to `tailwind.config.js` without a semantic role. If you need a new color category, define a new role.
- **For shade variation** on an existing color, use opacity syntax (`bg-primary/50`, `text-danger/70`) before reaching for additional numeric shades.
- **Components in `components/`** own their appearance — they reference these semantic names directly. Page-level code (outside `components/`) can only use *outer-layout* classes via `className` (enforced by `restrict-component-classes` ESLint rule).

When a color role doesn't feel right for a use case, that's usually a sign that a new semantic role is warranted — discuss before inventing a one-off color.
