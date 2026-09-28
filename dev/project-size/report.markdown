# Project size

How big the monorepo is, and where the lines are. Counts are non-blank lines
in tracked files. Commentary here is written by hand; every number comes from
`data/latest.json`, which `pnpm project-size` rewrites.

The repository tracks {{files}} files and {{lines}} non-blank lines.

```dataset byCategory
```

Code is {{code.lines}} lines. It includes comments, and this codebase
comments heavily. Tests are {{tests.lines}} lines and do not overlap with
code: a file that is a doctest, is named `*.test.*`, or is under a `test/`
directory counts only as a test. Documentation is {{docs.lines}} lines, and
plans and reports are the largest part of it.

## By package

```dataset byPackage
```

`beebox` is the product. The iOS app, the dev tooling in `bin/`, and the
workstreams dashboard together add about a fifth to its code.

## Tests

{{doctest.percent}}% of test lines are Markdown doctests
({{doctest.files}} files). The {{testts.files}} `*.test.ts` files hold
{{testts.lines}} lines, and most of them are outside `beebox`. See
`issues/code-quality/2026-09-27-convert-test-ts-files-to-doctests.md`.

```dataset testsByKind
```

```dataset testTsByPackage
```

## Code by extension

```dataset codeByExtension
```

## Over time

One row per day the collector ran.

```dataset history
```
