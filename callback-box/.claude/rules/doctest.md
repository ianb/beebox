---
paths:
  - "**/*.doctest.md"
---

`.doctest.md` files are executable test documents. A Node.js loader transforms them into tap tests at runtime.

- **Every code block declares `ts`** (`ts setup`, `ts`, `ts continue`, `ts cleanup`) so the doc browser highlights it. The runner ignores the language token — it keys only on the `setup`/`continue`/`cleanup` directive — but write the `ts` anyway for consistent rendering.
- ` ```ts setup ` blocks run at module scope (imports, helpers)
- Regular ` ```ts ` blocks contain examples: `expression` then `=> expected`
- Multiple examples per block OK — separate with blank lines. **Examples in a block share scope** (variables persist)
- ` ```ts continue ` blocks append to the previous block's scope — use for prose between code sections that share variables
- ` ```ts cleanup ` blocks register teardown code via `t.teardown()` — runs after the current test even on failure. **It tears down the test it follows** — examples in later (non-`continue`) blocks run *after* the cleanup, so a tmp box created in one block is already deleted by the time the next block runs. Keep everything that uses the resource in the same block (or chained `continue` blocks) and put the cleanup at the section's end.
- Multi-line template literals work in example blocks (blank lines, `=>`-looking lines, and `;` line-endings inside the literal are treated as string content). The tracker doesn't understand backticks inside regex literals or `${}` interpolations — avoid those spanning lines.
- `=> value` starts the expected result on the same line; continues on subsequent lines until a blank line or end of block. `=>` alone starts expected on the next line. Both forms work the same way — **a blank line always separates examples**
- `=> throws ErrorName` (or `=> throws ErrorName: message`) asserts the expression throws — matched against `err.name` (plus `: message` when given)
- No `=>` means "just run" — use for setup statements within a block
- Lines ending with `;` before a check expression are emitted as statements (e.g., `const x = foo();` then `x.length` then `=> 5`)
- `t.check()` wildcards work in expected values: `«*»` (anything), `«date»`, `«int»`, `«codeblock»` (matches ` ``` `), `«blankline»` (matches empty line in multi-line output), `«name=*»`, `«name=type»`
- **IMPORTANT: String results are compared literally WITHOUT quotes** — `=> Agent crashed` matches the string `"Agent crashed"`. Writing `=> "Agent crashed"` (with quotes) would expect the string `'"Agent crashed"'` (with literal quote characters). To test exact whitespace or distinguish types, use `JSON.stringify()`: `JSON.stringify(result.error)` then `=> "Agent crashed"`
- Trailing newlines on string results are automatically trimmed (code blocks can't express trailing newlines)
- `print("text")` accumulates lines; they drain into the next `=>` assertion combined with the expression result. Scope-local per test — concurrent tests don't interfere. Use for narrative output across multiple steps.
- Prose between code blocks is ignored — use it to document behavior
- Blocks are full TypeScript (compiled via esbuild) — `import type`,
  non-null assertions, and type annotations all work in setup and
  example blocks alike
