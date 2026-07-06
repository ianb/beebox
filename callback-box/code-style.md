# Code Style

General coding conventions for backend and frontend. UI palette and primitive reference live in frontend.md. The *why* behind these rules — the durable design principles they implement — lives in [`docs/engineering-principles.md`](docs/engineering-principles.md).

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
- **Never resilient to the impossible.** Degrade only for failures that can genuinely happen. A seemingly-impossible state (a broken invariant) gets a hard failure, not a fallback — use `invariant()` / `assertNever()` (`src/lib/invariant.ts`), which always throw. `checkInvariant()` is the deliberate prod-degradation counterpart: it logs loudly and returns the condition so the caller branches explicitly (it does NOT narrow types). Dev and test fail hard where prod may degrade.
- **When to Result vs throw.** Return a `Result<T, E>` (`src/lib/result.ts`, keyed on `ok`) when callers genuinely branch on *why* it failed — the failure is part of the contract. Throw (typed class, `cause` chaining) when they can't act on it, and for broken invariants and infrastructure failures. One Result shape, not two.

### Logging levels

One policy for `console.*`, so a level carries meaning:

- **`console.error`** — a human needs to investigate. Carries enough context (box, card, operation) to debug from the line alone.
- **`console.warn`** — something unexpected happened but the code recovered. A degradation that stayed visible.
- **`console.debug`** — routine diagnostics; prefer none. Routine success prints nothing (per CLAUDE.md, noisy output is a bug).
- **`console.log`** — CLI user-facing output ONLY, never internal diagnostics.

Existing call sites migrate opportunistically as you touch them, not in a sweep.

### Async error handling

- **`Promise.allSettled` is the default over `Promise.all`** when the tasks are independent — `all` rejects on the first failure and abandons the rest (a silent drop of the others' results/errors). Use `all` only when a single failure genuinely should abort the batch; otherwise `allSettled` and inspect each outcome.
- A promise that's neither awaited, returned, `.then`-chained, nor explicitly `void`-ed is a lint error (`no-floating-promises`). `void expr` is the opt-in escape hatch for genuine fire-and-forget — and a `void`-ed promise still needs a `.catch` or a justifying comment, never a silent re-drop.
- **Cross-process locks go through `src/lib/file-lock.ts`** (PID liveness, sleep, crash recovery) — never a hand-rolled `.lock` file.
- **Same-file read-modify-write goes through `withCardLock(path, fn)`** (`src/lib/card-lock.ts`) — the in-process counterpart that serializes overlapping RMW on one file within a Node process (a lost-update bug `file-lock.ts` wouldn't even see, since both racers share a PID). Wrap the whole read-through-write-and-commit span. Don't nest it on the same file (it throws `ReentrantCardLockError` rather than deadlock).

### Exhaustiveness

Every dispatch over a closed union must fail to compile when a member is added — never rely on a `default:` to swallow the new case.

- `@typescript-eslint/switch-exhaustiveness-check` is **live in the preset**, configured strict: a bare `default:` does NOT count as exhaustive (`considerDefaultExhaustiveForUnions: false`), so a union `switch` must list every case. `default: assertNever(x)` stays legal as the blessed terminator; a `switch` over `number`/`string` still needs a `default:`.
- **`assertNever(x)`** (`src/lib/invariant.ts`) in the `default`/final `else` is the terminator for a `switch` or if-chain — it makes an unhandled new member a compile error, and throws if reached at runtime. The lint rule covers switches only; if-chains need `assertNever` in the final `else` by hand.
- **`Record<Union, Handler>` with `satisfies`** is the idiom for a wide/shallow union where a long case list would be noise — use it for shared-signature dispatch. Fall back to `switch` + `assertNever` when handlers need per-variant argument types (a plain `Record` doesn't preserve them).

### Defensiveness

Right-sized: defense concentrates at real boundaries; interior code trusts its types. Before adding a check, ask what produced the value.

1. Untrusted-boundary data (disk/YAML/HTTP/subprocess/LLM) may default, narrow, or catch-with-fallback freely — prefer `safeParse` where a schema exists.
2. A default may only replace a value the type system says can be absent. `?? x` on a required field is a type-system lie — fix the type instead.
3. Every non-rethrowing catch logs, or carries a one-line justification comment (the `/* ignore: <reason> */` convention).
4. UI polling is not exempt — a silent `.catch(() => {})` on a poll turns a dead backend into a frozen UI. Retry-resilience and observability are different properties; log even when the poll retries.
5. User-initiated actions never silently no-op: a toast/inline error, or at minimum a logged error.
6. Discriminated-union dispatch uses `assertNever`, never an invented `default` fallback.
7. Process-supervision code keeps the biggest defensive budget — each catch commented with the race it absorbs (`bin/router.ts` is the model).
8. Before adding a check, ask what produced the value: same-repo typed code → an assertion or nothing; disk/network/another process → keep the check.

### Lint rule suppression

Every rule in `@ianbicking/personal-vibe-check` is a deliberate choice, and the preset is ours to extend. Suppression is sometimes right, under strict limits:

- **Line-level only** — a single `// eslint-disable-next-line <rule> -- <concrete justification>`. Never a file-level or rule-level disable, never a blanket `/* eslint-disable */`.
- **Infrequent and signaled** — the justifying comment is mandatory and names why *this* case is a true false positive (e.g. a parse-boundary `as`).
- **A recurring legitimate exception gets encoded into the rule**, not accumulated as disables — add or adjust a rule in the preset rather than sprinkling the same suppression. See the monorepo root's `docs/eslint-rule-suppression-audit.md` for how silent drift happened before.
- **Never weaken a rule to make code pass.** Fix the code, or raise it with the boxholder first.

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
- **`as` type assertions are like Rust's `unsafe`**: allowed only when genuinely necessary — e.g. at a parse boundary where data arrives untyped. When you need one, either guard it with an `// eslint-disable-next-line no-restricted-syntax -- <why it's sound>` comment, or centralize the cast in a single well-named typed helper that does it once and is reused. Never sprinkle bare `as` to silence the type checker. (`as const` is always fine.)
  - **The `.ts`/`.tsx` asymmetry is deliberate.** The lint ban on `as` (`no-restricted-syntax`) is enforced in `.tsx` only; in `.ts` it's convention, not lint. Don't read the absence of a `.ts` error as permission — the rule is the same, only the enforcement tier differs. Note `as never` slips past the selector entirely, so it's a manual smell, not a caught one.
  - **The two blessed cast helpers are the sanctioned pattern** — reach for these instead of a raw cast: `cardFields(card, schema)` (`core/card-io.ts`) carries a card's already-Zod-validated `fields` through as the schema's inferred type, replacing `card.fields as unknown as XFields`; `parseCommandArgs(args, schema)` (`core/command-runner.ts`) validates a command's untyped `args` bag once at the dispatch boundary, replacing `args as unknown as XArgs`. Both fail loudly (a typed error) on a shape mismatch rather than flowing mis-typed data past a silent cast.
- **Explicit return types on exported functions**; inference is fine for locals.
- Files max 300 lines, functions max 150 lines (excluding blanks/comments)
- **Only export what's needed**: don't export functions/constants only used within their own file. Not currently knip-enforced — `knip.json` excludes the `exports` check because the codebase has a backlog of ~277 unused exports; enforce this by convention/review until that backlog is cleared.
