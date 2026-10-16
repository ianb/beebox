---
title: "A trailing // comment on a doctest's checked line is a syntax error"
workstream: unattached
area: agent-doctest
labels: [doctest]
filed-by: agent
discovered-by: agent
discovered-in: doctest-typecheck worktree — writing the checker's cache doctest, 2026-10-16
priority: normal
---

```ts
1 + 2 // three
=> 3
```

fails to load with `DoctestSyntaxError …:4: Expected ")" but found
"__doctest_watch"`. `emitExamples` (`agent-doctest/src/doctest-hooks/doctest-emit.ts`)
wraps the checked expression as `await __doctest_t.check(__doctest_withPrints(__doctest_prints, EXPR), …);`
on the same line, so the comment swallows the closing parenthesis and the
rest of the call. A comment on its own line before the expression works.

Likely fix: put the suffix on a new generated line when the last expression
line ends in a line comment (or always), keeping the line map.
