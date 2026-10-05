# Tab titles, favicons, and issue links

Each page names itself in the tab, most specific part first, and gets its
section's favicon: the same tile shape everywhere, a distinct color and letter
per section.

```ts setup
import { PAGE_SECTIONS, pageTitle, sectionFavicon } from "../../../src/frontend/lib/page-identity.js";
import { issueSearchParams } from "../../../src/frontend/lib/issue-link.js";
```

```ts
JSON.stringify({
  issues: pageTitle("issues"),
  issue: pageTitle("issues", "Composer splices drafts"),
  streams: pageTitle("streams"),
  stream: pageTitle("streams", "issue-next-action-local"),
  recentUnfiltered: pageTitle("recent", null),
})
=> {"issues":"Issues · Workstreams","issue":"Composer splices drafts · Issues · Workstreams","streams":"Workstreams","stream":"issue-next-action-local · Workstreams","recentUnfiltered":"Recent · Workstreams"}
```

Every section's favicon is distinct, and none repeats a color or a letter.

```ts
const sections = Object.keys(PAGE_SECTIONS) as Array<keyof typeof PAGE_SECTIONS>;
JSON.stringify({
  distinctIcons: new Set(sections.map((section) => sectionFavicon(section))).size === sections.length,
  distinctColors: new Set(Object.values(PAGE_SECTIONS).map((s) => s.color)).size === sections.length,
  distinctGlyphs: new Set(Object.values(PAGE_SECTIONS).map((s) => s.glyph)).size === sections.length,
  svg: sectionFavicon("issues").startsWith("data:image/svg+xml,"),
})
=> {"distinctIcons":true,"distinctColors":true,"distinctGlyphs":true,"svg":true}
```

An issue link leaves out the default public visibility and names only private.

```ts
JSON.stringify({
  public: issueSearchParams({ relPath: "bugs/2026-01-01-x.md", visibility: "public" }),
  private: issueSearchParams({ relPath: "bugs/2026-01-01-x.md", visibility: "private" }),
})
=> {"public":{"issue":"bugs/2026-01-01-x.md"},"private":{"issue":"bugs/2026-01-01-x.md","issueVisibility":"private"}}
```
