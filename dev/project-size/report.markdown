# Project size

About {{lines}} non-blank lines in {{files}} tracked files. Line counts are
rounded to the nearest thousand; small packages and rare extensions are folded
into an "other" row. The numbers refresh with `pnpm project-size`. The
commentary is written by hand, so check it against the tables after a large
change.

## The short version

- **The product is most of it.** `beebox` is about {{beebox.percent}}% of the
  repository. Everything else — the iOS app, the dev tooling, the dashboard,
  the Chrome extension, the site — is supporting cast.
- **Documentation outweighs the tests.** {{docs.lines}} lines of docs
  against {{tests.lines}} lines of tests. Plans and reports alone are the
  biggest docs category. This is what agent-driven development looks like:
  every change is planned, reviewed, and written down.
- **Tests are doctests.** {{doctest.percent}}% of test lines are Markdown
  doctests. Counting only the code inside their fences, tests are about
  {{tests.codeOnly.percentOfCode}}% the size of the product code.

```dataset byCategory
```

Code includes comments, and this codebase comments heavily — `tokei` puts
roughly one line in four of TypeScript as comment. A file that is a doctest,
is named `*.test.*`, or lives under a `test/` directory counts only as a test,
never as code.

## Where the code lives

```dataset byPackage
```

`beebox` dwarfs everything: it holds the server, the web frontend, the card
schemas, and the box tooling. The next largest code bases are the native iOS
app and `bin/`, the tooling that runs worktrees, schedules, and landing. The
`issues/` queue and `research/` notes are docs only, and together they are
larger than any package except `beebox`.

## Tests

Doctests mix prose with fenced code. About {{doctest.prose.percent}}% of their
lines are prose — explanation between examples — and the rest is code and
expected output: {{doctest.code.lines}} lines inside fences against
{{doctest.prose.lines}} of prose.

```dataset testsByKind
```

The {{testts.files}} `*.test.ts` files ({{testts.lines}} lines) are the
exception, and almost all of them are outside `beebox`. Most should become
doctests; see `issues/code-quality/2026-09-27-convert-test-ts-files-to-doctests.md`.

```dataset testTsByPackage
```

## Languages

```dataset codeByExtension
```

TypeScript is nearly everything. Swift is the iOS app; shell is the thin
launchers in `bin/` and the deploy scripts.

## Over time

One row per day the collector ran.

```dataset history
```
