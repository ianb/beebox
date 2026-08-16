# Assigning an issue to a workstream

The launcher changes only the required `workstream` frontmatter field and
preserves the rest of the issue exactly.

```ts setup
import { assignIssueWorkstream } from "../../../bin/assign-issue-workstream.js";
```

```ts
const source = "---\ntitle: Keep me\nworkstream: unattached\nneeds: [manual-testing]\n---\n\nBody.\n";
JSON.stringify(assignIssueWorkstream(source, "seam"))
=> "---\ntitle: Keep me\nworkstream: seam\nneeds: [manual-testing]\n---\n\nBody.\n"

const empty = "---\ntitle: Keep me\nworkstream:\nneeds: [manual-testing]\n---\n";
JSON.stringify(assignIssueWorkstream(empty, "seam"))
=> "---\ntitle: Keep me\nworkstream: seam\nneeds: [manual-testing]\n---\n"
```
