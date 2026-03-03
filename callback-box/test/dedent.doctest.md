# dedent

Strips common leading whitespace from multi-line strings. Used in procedure card content so prompts and scripts can be indented naturally within XML.

```ts setup
import { dedent } from "../src/core/procedure/dedent.js";
```

Removes the shared indentation from all lines:

```
JSON.stringify(dedent("  hello\n  world"))
=> "hello\nworld"
```

A leading blank line is stripped (common when text starts after an XML opening tag):

```
JSON.stringify(dedent("\n    line one\n    line two"))
=> "line one\nline two"
```

Mixed indentation — only the common prefix is removed:

```
JSON.stringify(dedent("    outer\n      inner\n    outer"))
=> "outer\n  inner\nouter"
```

Trailing whitespace on each line is trimmed:

```
JSON.stringify(dedent("  hello  \n  world  "))
=> "hello\nworld"
```

Already-flush text passes through unchanged:

```
JSON.stringify(dedent("no indent\nsecond line"))
=> "no indent\nsecond line"
```

Single line:

```
dedent("hello")
=> hello
```

Empty lines are preserved but don't affect indentation:

```
JSON.stringify(dedent("    a\n\n    b"))
=> "a\n\nb"
```
