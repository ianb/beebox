---
paths:
  - "**/*.doctest.md"
---

`.doctest.md` files are executable test documents. A Node.js loader transforms them into tap tests at runtime.

- ` ```ts setup ` blocks run at module scope (imports, helpers)
- Regular ` ``` ` blocks contain examples: `expression` then `=> expected`
- Multiple examples per block OK — separate with blank lines
- `=> value` on one line = single-line result; `=>` alone = multi-line result until blank line or end of block
- No `=>` means "just run, check it doesn't throw"
- `t.check()` wildcards work in expected values: `«*»` (anything), `«date»`, `«int»`, `«name»`, `«name=type»`
