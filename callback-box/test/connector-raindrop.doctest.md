# Raindrop Connector

The Raindrop connector does two-way bookmark sync: pulls remote bookmarks into local card files, and pushes local changes back to the API.

```ts setup
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { initBox } from "../src/core/box.js";
import { createFakeRaindrop } from "../src/services/raindrop.js";
import { createRaindropConnector } from "../src/connectors/raindrop.js";
```

## Pull — creates local cards from remote bookmarks

When remote bookmarks exist but no local cards do, the connector pulls them:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed(
  "config/connectors/raindrop.secret.json",
  JSON.stringify({ token: "fake-token" }),
);
box.commitAll("add config");

const rd = createFakeRaindrop({
  collections: [{ _id: 10, title: "Reading", count: 1 }],
  bookmarks: [{
    _id: 501,
    title: "Example Article",
    link: "https://example.com/article",
    excerpt: "An interesting article",
    note: "",
    tags: ["tech"],
    collection: { $id: 10 },
    created: "2024-01-01T00:00:00Z",
    lastUpdate: "2024-01-01T00:00:00Z",
  }],
});

const connector = createRaindropConnector(box.root, rd);
const result = await connector.sync();
result.success
=> true
```

``` continue
result.created.length
=> 1
```

The card file is created in box/bookmarks:

``` continue
result.created[0]?.includes("Example_Article")
=> true
```

``` continue
result.created[0]?.endsWith(".bookmark.card")
=> true
```

The card contains the bookmark data:

``` continue
const content = await box.read(result.created[0]);
content.includes("https://example.com/article")
=> true
```

``` continue
content.includes("Reading")
=> true
```

``` cleanup
await box.cleanup();
```

## Pull — updates changed remote bookmarks

When a remote bookmark has been updated (newer `lastUpdate`), the local card is overwritten:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed(
  "config/connectors/raindrop.secret.json",
  JSON.stringify({ token: "fake-token" }),
);
box.commitAll("add config");

// First sync — pull the bookmark
const rd = createFakeRaindrop({
  collections: [{ _id: 10, title: "Reading", count: 1 }],
  bookmarks: [{
    _id: 600,
    title: "Original Title",
    link: "https://example.com",
    excerpt: "",
    note: "",
    tags: [],
    collection: { $id: 10 },
    created: "2024-01-01T00:00:00Z",
    lastUpdate: "2024-01-01T00:00:00Z",
  }],
});

const connector = createRaindropConnector(box.root, rd);
await connector.sync();

// Now update the remote bookmark
rd.bookmarks[0] = {
  ...rd.bookmarks[0],
  title: "Updated Title",
  lastUpdate: "2024-06-01T00:00:00Z",
};

// Second sync — should update the local card
const result2 = await connector.sync();
result2.success
=> true
```

``` continue
result2.updated.length
=> 1
```

``` continue
const content = await box.read(result2.updated[0]);
content.includes("Updated Title")
=> true
```

``` cleanup
await box.cleanup();
```

## Push — creates remote bookmarks from local cards

When a local bookmark card has no `raindrop-id`, it gets pushed to the API:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed(
  "config/connectors/raindrop.secret.json",
  JSON.stringify({ token: "fake-token" }),
);

// Create a local bookmark card without a raindrop-id
await box.seed(
  "box/bookmarks/new-bookmark.bookmark.card",
  '<bookmark>\n<title>My New Bookmark</title>\n<link>https://newsite.com</link>\n<note>Check this out</note>\n<tags><tag>web</tag></tags>\n</bookmark>\n',
);
box.commitAll("add config and bookmark");

const rd = createFakeRaindrop({ collections: [] });
const connector = createRaindropConnector(box.root, rd);
const result = await connector.sync();
result.success
=> true
```

The bookmark was created in the remote service:

``` continue
rd.bookmarks.length
=> 1
```

``` continue
rd.bookmarks[0]?.title
=> My New Bookmark
```

``` continue
rd.bookmarks[0]?.link
=> https://newsite.com
```

``` cleanup
await box.cleanup();
```
