# Absolute machine-path guard

`findAbsoluteMachinePaths` (`src/lib/absolute-path-check.ts`) flags a real
developer home directory embedded in card content — `bbx validate`'s Track B
check (`docs/implemented-plans/one-root-box-layout.md`) that a box carries no machine-
specific paths. Same allowlist shape as the monorepo's `bin/path-leak-check.ts`.

```ts setup
import { findAbsoluteMachinePaths } from "../../src/lib/absolute-path-check.js";
```

A real home path is flagged, macOS and Linux forms alike:

```ts
JSON.stringify(findAbsoluteMachinePaths("See /Users/beebox/src/boxes/test1 for the fixture."))
=> ["/Users/beebox/"]

JSON.stringify(findAbsoluteMachinePaths("Logs at /home/beebox/.local/share/beebox."))
=> ["/home/beebox/"]
```

The placeholder names used in `file:` URL examples and docs (`me`, `you`,
`user`, `x`) are not flagged:

```ts
JSON.stringify([
  findAbsoluteMachinePaths("open file:///Users/me/Desktop/scan.pdf"),
  findAbsoluteMachinePaths("open file:///Users/you/Desktop/scan.pdf"),
])
=> [[],[]]
```

Text with no absolute path — a box ref, a relative path, prose — carries
nothing:

```ts
JSON.stringify(findAbsoluteMachinePaths("See /_content/docs/report.md and ../notes.md."))
=> []
```

Multiple leaks in one text are all reported, in order:

```ts
JSON.stringify(findAbsoluteMachinePaths("/Users/beebox/a and /home/bbx-test1/b"))
=> ["/Users/beebox/","/home/bbx-test1/"]
```
