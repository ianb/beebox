---
paths:
  - "**/*.doctest.md"
---

A doctest is documentation whose code runs. Full reference:
`agent-doctest/docs/syntax.md` (monorepo-relative); the `doctest` skill covers
running and triage. The rules that matter most:

- **Narrate.** Open with the contract or the incident behind the code. Before
  each example, one sentence says what rule it shows. A heading alone is not
  enough; a block with no prose before it is a smell.
- **Show values.** Write the value the code produces: objects as literals
  (`=> { kind: "box" }`, any key order), strings without quotes. Not
  `JSON.stringify(...)`, and not `=> true` from a comparison.
- **Unknown or varying value:** write `=> ?`, run the file from the package
  directory (`cd beebox && pnpm exec tap test/<path>.doctest.md`), and paste
  the `suggested:` value after checking it. Varying parts arrive as wildcards
  (`«int»`, `«date»`, `«uuid»`, `«*»` inside a value). Better: pass fixed
  inputs. `=> «show»` records a value in the output without checking it; a
  bare `=> «*»` is refused.
- **Scope.** Each ` ```ts ` block is its own test. ` ```ts continue ` shares
  the previous block's variables; ` ```ts setup ` is for imports and helpers;
  ` ```ts cleanup ` releases what a test created, ` ```ts teardown ` what
  setup created.
- **Waiting:** `eventually(fn, { label })`, never a fixed sleep.
- Prose goes between fences, never inside one.
