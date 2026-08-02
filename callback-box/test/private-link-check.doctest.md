# private-link-check: no public→private links

Lexical guard for doc-check: a tracked (public) file must never link into
`private-issues/`, the gitignored symlink some developers mount to a separate
private repo. The check is lexical (string/path matching, no `fs`) so it
catches the link on every machine — including one where the symlink exists
and would otherwise resolve.

```ts setup
import { isForbiddenPrivateLinkTarget, findPrivateLinkViolations, PRIVATE_LINK_REASON } from "../src/dev/private-link-check.js";
```

## Forbidden forms: relative, `../`-relative, root-relative, dev-browser URL

```ts
isForbiddenPrivateLinkTarget("private-issues/foo.md")
=> true

isForbiddenPrivateLinkTarget("../../private-issues/bar.md")
=> true

isForbiddenPrivateLinkTarget("/private-issues/baz.md")
=> true

isForbiddenPrivateLinkTarget("/dev/issues/private/some-thread")
=> true

isForbiddenPrivateLinkTarget("http://localhost:3210/main/test1/dev/issues/private/some-thread")
=> true
```

## Not flagged: prose-like substrings, other hosts, unrelated routes

```ts
// segment-exact: "not-private-issues-thing.md" must not match
isForbiddenPrivateLinkTarget("not-private-issues-thing.md")
=> false

isForbiddenPrivateLinkTarget("issues/features/private-issues-migration.md")
=> false

// an external URL to another host is fine unless its path is the dev/issues/private route
isForbiddenPrivateLinkTarget("https://example.com/private-issues/README.md")
=> false

isForbiddenPrivateLinkTarget("docs/testing.md")
=> false

isForbiddenPrivateLinkTarget("/dev/issues/public/some-thread")
=> false
```

## findPrivateLinkViolations flags inline links and reference-style definitions

```ts
const inline = findPrivateLinkViolations("issues/features/x.md", "see [private thread](../private-issues/thread.md) for detail");
JSON.stringify(inline)
=> [{"path":"issues/features/x.md","line":1,"target":"../private-issues/thread.md"}]

const refStyle = findPrivateLinkViolations("docs/x.md", "context: [ref]\n\n[ref]: /private-issues/thread.md");
JSON.stringify(refStyle)
=> [{"path":"docs/x.md","line":3,"target":"/private-issues/thread.md"}]
```

## Prose mentions and inline-code examples stay clean

```ts
const prose = findPrivateLinkViolations("issues/CLAUDE.md", "private-issues is a separate private repo; see the private README for details.");
prose.length
=> 0

const code = findPrivateLinkViolations("issues/CLAUDE.md", "the forbidden form looks like `[t](private-issues/foo.md)` — do not write this in a public file.");
code.length
=> 0

const fence = "```\n[t](private-issues/foo.md)\n```";
const fenced = findPrivateLinkViolations("issues/CLAUDE.md", fence);
fenced.length
=> 0
```

## A legal private→public link (the other direction) stays clean

```ts
const legal = findPrivateLinkViolations("issues/features/x.md", "[public doc](../../callback-box/docs/testing.md)");
legal.length
=> 0
```

## The reason string names the rule and the fix

```ts
PRIVATE_LINK_REASON
=> public files must not link into private-issues/ — it is a separate private repo; move the link into a private issue instead (private→public links are allowed)
```
