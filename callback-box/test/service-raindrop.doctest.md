# Raindrop service

Fake Raindrop maintains in-memory collections and bookmarks.

```ts setup
import { createFakeRaindrop } from "../src/services/raindrop.js";
import { withCallLog, printCalls } from "../src/services/call-log.js";
```

## Empty by default

```
const svc = createFakeRaindrop();
(await svc.listCollections()).length
=> 0
```

## Pre-loaded collections and bookmarks

```
const svc = createFakeRaindrop({
  collections: [{ _id: 1, title: "Dev", count: 2 }],
  bookmarks: [
    { _id: 100, title: "Example", link: "https://example.com", excerpt: "", note: "", tags: ["web"], collection: { $id: 1 }, created: "2025-01-01", lastUpdate: "2025-01-01" },
  ],
});
(await svc.listCollections())[0]?.title
=> Dev
```

``` continue
(await svc.listBookmarks(1))[0]?.tags[0]
=> web
```

## Creating bookmarks

```
const svc = createFakeRaindrop();
const bm = await svc.createBookmark({ title: "New", link: "https://new.com", tags: ["test"] });
bm.title
=> New
```

``` continue
bm.link
=> https://new.com
```

``` continue
// Bookmark was added to the internal array
svc.bookmarks.length
=> 1
```

## Updating bookmarks

```
const svc = createFakeRaindrop({
  bookmarks: [
    { _id: 42, title: "Old", link: "https://old.com", excerpt: "", note: "", tags: [], collection: { $id: 0 }, created: "2025-01-01", lastUpdate: "2025-01-01" },
  ],
});
const updated = await svc.updateBookmark(42, { title: "New Title" });
updated.title
=> New Title
```

``` continue
// Original link preserved
updated.link
=> https://old.com
```

## Call logging

```
const svc = withCallLog(createFakeRaindrop());
await svc.createBookmark({ title: "Logged", link: "https://logged.com" });
await svc.listBookmarks(0);
printCalls(svc.callLog)
=>
createBookmark({"title":"Logged","link":"https://logged.com"})
listBookmarks(0)
```
