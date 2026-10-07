# A body that repeats its title as a heading

The card page shows the title from `title:`. `leadingTitleHeading` finds a
body whose first non-blank line is an H1 with the same text, so lint can warn
and the card view can hide it. The match ignores case and surrounding spaces.

```ts setup
import { blankLeadingTitleHeading, leadingTitleHeading } from "../../src/shared/leading-title-heading.js";
```

```ts
leadingTitleHeading("# Trip Report\n\nWe drove down on Friday.", "Trip Report")
=> { line: 1 }

leadingTitleHeading("\n\n  # trip report  \nWe drove down.", " Trip Report ")
=> { line: 3 }

leadingTitleHeading("# Trip Report ##\n", "Trip Report")
=> { line: 1 }
```

An H2, an H1 after a paragraph, a heading with emphasis, and an empty title
do not match:

```ts
leadingTitleHeading("## Trip Report\n", "Trip Report")
=> null

leadingTitleHeading("We drove down.\n\n# Trip Report\n", "Trip Report")
=> null

leadingTitleHeading("# *Trip Report*\n", "Trip Report")
=> null

leadingTitleHeading("# Trip Report\n", "")
=> null

leadingTitleHeading("#Trip Report\n", "Trip Report")
=> null
```

`blankLeadingTitleHeading` empties that line instead of removing it, so later
lines keep their numbers:

```ts
JSON.stringify(blankLeadingTitleHeading("# Trip Report\nWe drove down.", "Trip Report"))
=> "\nWe drove down."

JSON.stringify(blankLeadingTitleHeading("## Trip Report\nWe drove down.", "Trip Report"))
=> "## Trip Report\nWe drove down."
```
