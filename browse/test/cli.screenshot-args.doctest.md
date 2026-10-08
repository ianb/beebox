# `browse screenshot` argument parsing

`--help` must never become an output path: before this parser returned a
discriminated result, `bin/browse screenshot --help` took a screenshot and
wrote a file named `--help.json`.

```ts
import { parseScreenshotArgs } from "../src/cli.ts";

parseScreenshotArgs(["--help"]).kind
=> help

parseScreenshotArgs(["-h"]).kind
=> help

parseScreenshotArgs(["--bogus"])
=> { kind: "error", message: "unknown option --bogus" }

parseScreenshotArgs(["--slug"])
=> { kind: "error", message: "--slug needs a name" }

parseScreenshotArgs(["a.png", "b.png"]).kind
=> error

parseScreenshotArgs(["--full", "--slug", "login", "out/shot.png"])
=> { kind: "run", invocation: { path: "out/shot.png", slug: "login", full: true, annotate: false } }

parseScreenshotArgs([])
=> { kind: "run", invocation: { path: null, slug: "shot", full: false, annotate: false } }
```
