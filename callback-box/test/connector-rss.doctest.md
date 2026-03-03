# RSS Connector

The RSS connector fetches RSS/Atom feeds and creates news-item card files in `box/inbox/news/`. It tracks seen GUIDs to avoid duplicates.

```ts setup
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { initBox } from "../src/core/box.js";
import { createFakeFeedFetcher } from "../src/services/feed-fetcher.js";
import { createRssConnector } from "../src/connectors/rss.js";
```

## Pull — creates news-item cards from an RSS feed

When a feed has items the connector hasn't seen, it creates card files and a job:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed(
  "config/connectors/rss.json",
  JSON.stringify({
    feeds: [{ url: "https://example.com/feed.xml", title: "Test Blog" }],
  }),
);
box.commitAll("add config");

const fetcher = createFakeFeedFetcher([
  {
    url: "https://example.com/feed.xml",
    xml: `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Blog</title>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <guid>guid-1</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <description>A &lt;b&gt;great&lt;/b&gt; post</description>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/second</link>
      <guid>guid-2</guid>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`,
  },
]);

const connector = createRssConnector(box.root, fetcher);
const result = await connector.sync();
result.success
=> true

result.created.length
=> 2
```

The created cards are in `box/inbox/news/`:

``` continue
const newsFiles = await readdir(join(box.root, "box/inbox/news"));
newsFiles.length
=> 2

newsFiles.every(f => f.endsWith(".news-item.card"))
=> true
```

A card contains the feed item data:

``` continue
const cardContent = await readFile(join(box.root, "box/inbox/news", newsFiles[0]), "utf-8");
cardContent.includes("First Post")
=> true

cardContent.includes("A great post")
=> true
```

A news job was created:

``` continue
const allJobFiles = await readdir(join(box.root, "box/jobs"));
const jobFiles = allJobFiles.filter(f => f.endsWith(".job.card"));
jobFiles.length
=> 1
```

The fetcher was called with the right URL:

``` continue
fetcher.fetchedUrls.length
=> 1

fetcher.fetchedUrls[0]
=> https://example.com/feed.xml
```

``` cleanup
await box.cleanup();
```

## Deduplication — skips already-seen GUIDs

When synced again with the same feed, no new cards are created:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed(
  "config/connectors/rss.json",
  JSON.stringify({
    feeds: [{ url: "https://example.com/feed.xml" }],
  }),
);
box.commitAll("add config");

const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>My Feed</title>
    <item>
      <title>Only Post</title>
      <link>https://example.com/only</link>
      <guid>guid-only</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const fetcher = createFakeFeedFetcher([
  { url: "https://example.com/feed.xml", xml },
]);

const connector = createRssConnector(box.root, fetcher);

const first = await connector.sync();
first.created.length
=> 1
```

Second sync with the same feed produces no new cards:

``` continue
const second = await connector.sync();
second.created.length
=> 0

second.success
=> true
```

``` cleanup
await box.cleanup();
```

## Atom feed support

The connector also parses Atom feeds:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed(
  "config/connectors/rss.json",
  JSON.stringify({
    feeds: [{ url: "https://example.com/atom.xml" }],
  }),
);
box.commitAll("add config");

const fetcher = createFakeFeedFetcher([
  {
    url: "https://example.com/atom.xml",
    xml: `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <entry>
    <title>Atom Entry</title>
    <link href="https://example.com/atom-entry" />
    <id>atom-id-1</id>
    <published>2024-01-15T00:00:00Z</published>
    <summary>An atom entry summary</summary>
    <author><name>Alice</name></author>
  </entry>
</feed>`,
  },
]);

const connector = createRssConnector(box.root, fetcher);
const result = await connector.sync();
result.success
=> true

result.created.length
=> 1
```

``` continue
const newsFiles = await readdir(join(box.root, "box/inbox/news"));
const cardContent = await readFile(join(box.root, "box/inbox/news", newsFiles[0]), "utf-8");
cardContent.includes("Atom Entry")
=> true

cardContent.includes("An atom entry summary")
=> true
```

``` cleanup
await box.cleanup();
```

## Fetch error handling

When a feed URL returns an error, the connector reports it but doesn't fail entirely:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed(
  "config/connectors/rss.json",
  JSON.stringify({
    feeds: [
      { url: "https://example.com/good.xml" },
      { url: "https://example.com/bad.xml" },
    ],
  }),
);
box.commitAll("add config");

const fetcher = createFakeFeedFetcher([
  {
    url: "https://example.com/good.xml",
    xml: `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Good Feed</title>
    <item>
      <title>Good Post</title>
      <link>https://example.com/good</link>
      <guid>good-1</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`,
  },
  {
    url: "https://example.com/bad.xml",
    xml: "",
    status: 500,
  },
]);

const connector = createRssConnector(box.root, fetcher);
const result = await connector.sync();
result.success
=> false

result.created.length
=> 1

result.error.includes("bad.xml")
=> true
```

``` cleanup
await box.cleanup();
```
