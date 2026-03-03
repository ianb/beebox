# Article Fetcher Service

Tests for the article fetcher service — fetches web articles and converts
them to markdown. The fake returns canned markdown from an in-memory map.

```ts setup
import {
  createFakeArticleFetcher,
} from "../src/services/article-fetcher.js";
```

## Fake: basic usage

### Returns canned markdown for exact URL match

```
const fetcher = createFakeArticleFetcher([
  { url: "https://example.com/article", markdown: "# Hello World\n\nSome content." },
]);

const result = await fetcher.fetch("https://example.com/article");
print(result.markdown);
=>
# Hello World
«blankline»
Some content.

result.finalUrl
=> https://example.com/article
```

### Tracks fetched URLs

```
const fetcher = createFakeArticleFetcher([
  { url: "https://example.com/a", markdown: "A" },
  { url: "https://example.com/b", markdown: "B" },
]);

await fetcher.fetch("https://example.com/a");
await fetcher.fetch("https://example.com/b");
await fetcher.fetch("https://example.com/a");

print(fetcher.fetchedUrls.join("\n"));
=>
https://example.com/a
https://example.com/b
https://example.com/a
```

### Supports prefix matching with wildcard

```
const fetcher = createFakeArticleFetcher([
  { url: "https://example.com/*", markdown: "Wildcard match" },
]);

const result = await fetcher.fetch("https://example.com/any/path/here");
result.markdown
=> Wildcard match
```

### Supports custom finalUrl (redirect simulation)

```
const fetcher = createFakeArticleFetcher([
  {
    url: "https://short.link/abc",
    markdown: "Redirected content",
    finalUrl: "https://example.com/real-article",
  },
]);

const result = await fetcher.fetch("https://short.link/abc");
result.finalUrl
=> https://example.com/real-article
```

### Throws on unknown URL (404)

```
const fetcher = createFakeArticleFetcher([]);

const error = await fetcher.fetch("https://unknown.com/page").catch((e: any) => e);
error.message
=> HTTP 404: Not Found
error.statusCode
=> 404
```

### Throws on non-2xx status

```
const fetcher = createFakeArticleFetcher([
  { url: "https://example.com/down", markdown: "", status: 503 },
]);

const error = await fetcher.fetch("https://example.com/down").catch((e: any) => e);
error.message
=> HTTP 503
error.statusCode
=> 503
```
