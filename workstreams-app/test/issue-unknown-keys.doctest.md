# Unknown frontmatter keys are reported, not swallowed

`issues/CLAUDE.md` defines a closed frontmatter schema, but `parseIssueFile` used
to drop anything outside it without a word. Eleven issues were filed carrying a
`stories:` list — pointing at slugs in the user-story catalog — and it reached no
tool for two months: not a filter, not a facet, not `--json`. Nobody was told,
because nothing said anything.

So the parser now reports what it did not recognise, and callers decide how loudly.

```ts setup
import { parseIssueFile } from "../src/server/issue-domain.js";

const parse = (frontmatter: string) => parseIssueFile({
  relPath: "bugs/2026-08-24-example.md",
  source: `---\n${frontmatter}\n---\n\nThe body.\n`,
});
```

## A key outside the schema is named

```ts
JSON.stringify(parse([
  'title: "Something broke"',
  "workstream: unattached",
  "stories: [connectors/configure-which-gmail-calendar-and-drive-content]",
].join("\n")).unknownKeys)
=> ["stories"]
```

## Several are sorted, so the report is stable

```ts
JSON.stringify(parse([
  'title: "Something broke"',
  "workstream: unattached",
  "zebra: 1",
  "apple: 2",
].join("\n")).unknownKeys)
=> ["apple","zebra"]
```

## Every documented field is recognised

If this list and `issues/CLAUDE.md` drift apart, a legitimate field starts being
reported as unknown on every issue that uses it — which is the failure this whole
mechanism would otherwise cause.

```ts
JSON.stringify(parse([
  'title: "Something broke"',
  "workstream: unattached",
  "needs: [design]",
  "design: ../../callback-box/docs/plans/foo.md",
  "area: callback-box",
  "labels: [soft-launch]",
  "priority: important",
  "next-action: discuss",
  "filed-by: agent",
  "discovered-by: agent",
  "discovered-in: worktree-foo — while doing X",
  "resolution: implemented",
].join("\n")).unknownKeys)
=> []
```
