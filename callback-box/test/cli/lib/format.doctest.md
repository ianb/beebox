# Format Utilities

`stripAnsi` removes ANSI escape codes from text, useful for logging or when color support is disabled.

```ts setup
import { stripAnsi } from "../../../src/cli/lib/format.js";
```

```ts
stripAnsi("\u001B[32m✓ done\u001B[39m")
=> ✓ done

stripAnsi("\u001B[1m\u001B[36mHeader\u001B[39m\u001B[22m")
=> Header

stripAnsi("no codes here")
=> no codes here
```
