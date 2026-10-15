# A test an agent can read and write
## Supporting: a whole doctest, 18 lines
- Prose, a code block, and the expected value after `=>`
- The reporter was chosen for an agent reading a pipe (3aecb4c05, Jun 9)

````markdown
# Assigning an issue to a workstream

The launcher changes only the required `workstream` frontmatter field and
preserves the rest of the issue exactly.

```ts setup
import { assignIssueWorkstream } from "../assign-issue-workstream.js";
```

```ts
const source = "---\ntitle: Keep me\nworkstream: unattached\nneeds: [manual-testing]\n---\n\nBody.\n";
JSON.stringify(assignIssueWorkstream(source, "seam"))
=> "---\ntitle: Keep me\nworkstream: seam\nneeds: [manual-testing]\n---\n\nBody.\n"
```
````

```text
Tap output: all three .taprc files now set reporter=tap + color=false —
the consumers of test runs are agents reading through a pipe, and the
interactive reporters (min/terse/base) emit cursor-control sequences
even when piped.
```

Notes:
Path: bin/test/assign-issue-workstream.doctest.md. Today: 1,035 doctest files against 142 conventional test files. The cost shows up later as the flake load (bottleneck 5).
