---
title: "Card frontmatter parsing: js-yaml is 4-7x faster than yaml on box cards"
workstream: unattached
needs: [decision]
area: beebox
labels: [performance]
filed-by: agent
discovered-in: worktree-perf-easy-wins — profiling bbx todos and bbx validate
---

Every card read parses its YAML frontmatter with the `yaml` package
(`parseFrontmatterMapping` in `src/core/card-io.ts`). In a CPU profile of
`bbx validate` on the test1 clone, `yaml` is 142 ms of 1,554 ms; in
`bbx todos`, 60 of 937 ms (2026-10-23, loaded machine). `bbx validate` also
parses each card's frontmatter twice: `unknownKeyWarnings` in
`src/core/card-lint/core/lint-cards.ts` parses it again.

`js-yaml` 4.3.0 is already in `node_modules` (a transitive dependency).
Benchmark on test1's 784 frontmatter blocks plus `ledger.yaml`, js-yaml
with `CORE_SCHEMA` (no timestamp-to-Date conversion, like `yaml`'s default):

| | yaml 2.9.0 | js-yaml 4.3.0 |
| --- | --- | --- |
| import | 15–27 ms | 3–5 ms |
| one cold pass over 784 blocks | 70 ms | 17 ms |
| warm pass | 39 ms | 5 ms |
| ledger.yaml (75 KB) | 13–17 ms | 3–5 ms |

Parsed values are deep-equal on all 785 inputs except an empty block:
`yaml` returns `null`, js-yaml `undefined` (`parseFrontmatterMapping`
already maps both to `{}`).

## Decision needed

Switch read-only parsing (`parse`) to js-yaml and keep `yaml` for
`stringify` and `parseDocument` (comment-preserving edits)? Two parsers in
one codebase is the cost. What else changes:

- Error messages for malformed frontmatter change wording. Lint output and
  tests that pin those messages would change; `YAMLParseError` is checked by
  name in one place.
- Duplicate keys throw in both; other edge cases (anchors, tags, very long
  keys) need a corpus check on a real box before switching.
- js-yaml would become a direct dependency.

Smaller step without a decision: parse once per card in `bbx validate`
(reuse the mapping `parseCardText` already built in `unknownKeyWarnings`).
