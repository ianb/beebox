# doc-link-repair: basename-based markdown-link repair

The fixable half of doc-link decay. When a file moves, relative links to it
break; where its basename is unique repo-wide, the current location is
recoverable, so the broken link can be rewritten. Pure logic (fs/git injected).

```ts setup
import { repairFrontmatterPaths, repairLinks, duplicateBasenames, buildBasenameLookup, NON_UNIQUE_BASENAMES } from "../src/dev/doc-link-repair.js";

// A tiny fake tree: bugs/foo.md has moved to closed/bugs/foo.md.
const files = ["issues/closed/bugs/foo.md", "issues/features/bar.md", "beebox/docs/guide.md"];
const exists = (p) => files.includes(p);
const lookup = buildBasenameLookup(files);
const repair = (fromRel, content) => repairLinks({ fromRel, content, fileExists: exists, basenameLookup: lookup });
const repairFrontmatter = (fromRel, content) => repairFrontmatterPaths({ fromRel, content, fileExists: exists, basenameLookup: lookup });
```

## A stale link is rewritten to the file's current location

```ts
const r = repair("issues/features/bar.md", "see [foo](../bugs/foo.md) for context");
r.content
=> see [foo](../closed/bugs/foo.md) for context

JSON.stringify(r.rewrites)
=> [{"line":1,"from":"../bugs/foo.md","to":"../closed/bugs/foo.md"}]
```

## Frontmatter scalar and list paths use the same repair contract

```ts
const fm = repairFrontmatter("issues/features/bar.md", `---
title: Bar
design: ../../beebox/old/guide.md
issues:
  - ../bugs/foo.md
---
# Bar`);
fm.content
=> ---
title: Bar
design: ../../beebox/docs/guide.md
issues:
  - ../closed/bugs/foo.md
---
# Bar

JSON.stringify(fm.rewrites)
=> [{"line":3,"from":"../../beebox/old/guide.md","to":"../../beebox/docs/guide.md"},{"line":5,"from":"../bugs/foo.md","to":"../closed/bugs/foo.md"}]
```

## A link that already resolves is left untouched (anchor preserved)

```ts
const ok = repair("issues/features/bar.md", "[foo](../closed/bugs/foo.md#section)");
ok.rewrites.length
=> 0

ok.unfixable.length
=> 0
```

## An unfixable link (true rename/delete) is reported, never guessed

```ts
const gone = repair("issues/features/bar.md", "[x](../bugs/deleted-thing.md)");
gone.rewrites.length
=> 0

JSON.stringify(gone.unfixable)
=> [{"line":1,"target":"../bugs/deleted-thing.md","reason":"no-basename-match"}]
```

## Links inside inline code are left alone (they illustrate syntax)

```ts
const inline = repair("issues/features/bar.md", "the form is `[foo](../bugs/foo.md)` — a cross-link");
inline.rewrites.length
=> 0

inline.unfixable.length
=> 0
```

## Links inside a fenced code block are left alone

```ts
const fence = "`".repeat(3);
const fenced = repair("issues/features/bar.md", fence + "\n[foo](../bugs/foo.md)\n" + fence);
fenced.rewrites.length
=> 0
```

## An ambiguous basename (2+ candidates) is guarded, not rewritten

```ts
const amb = repairLinks({ fromRel: "docs/a.md", content: "[x](./missing/x.md)", fileExists: () => false, basenameLookup: buildBasenameLookup(["p/x.md", "q/x.md"]) });
JSON.stringify(amb.unfixable)
=> [{"line":1,"target":"./missing/x.md","reason":"ambiguous-basename"}]
```

## Whitelisted one-per-directory basenames are never auto-resolved

```ts
const readme = repairLinks({ fromRel: "docs/a.md", content: "[r](./missing/README.md)", fileExists: () => false, basenameLookup: buildBasenameLookup(["x/README.md"]) });
readme.unfixable[0].reason
=> non-unique-basename

NON_UNIQUE_BASENAMES.has("CLAUDE.md")
=> true
```

## duplicateBasenames flags shared basenames, excluding the whitelist

```ts
JSON.stringify(duplicateBasenames(["issues/bugs/x.md", "issues/closed/bugs/x.md"]).get("x.md"))
=> ["issues/bugs/x.md","issues/closed/bugs/x.md"]

// README.md / CLAUDE.md are intentionally one-per-dir — never counted as duplicates.
JSON.stringify([...duplicateBasenames(["a/README.md", "b/README.md", "c/dup.md", "d/dup.md"]).keys()])
=> ["dup.md"]
```
