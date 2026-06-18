# Clerk API

The Clerk API powers the browser extension: capturing web pages as commentary and exposing the commentary destinations + a pending-actions stub.

```ts setup
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "./helpers/doctest-server.js";
```

## GET `/api/clerk/commentary-destinations`

Lists landmarks whose `<destination for>` includes `commentary`. A triage-only
landmark is not offered as a commentary destination.

```
const ctx = await makeTestServer();
await ctx.seed("store/reading/Reading.landmark.card", `<landmark>
<navigation>
<label>Reading</label>
<symbol>📖</symbol>
</navigation>
<destination for="commentary"/>
</landmark>`);
await ctx.seed("store/recipes/Recipes.landmark.card", `<landmark>
<navigation>
<label>Recipes</label>
</navigation>
<triage-destination>
<rules>Recipes.</rules>
</triage-destination>
</landmark>`);

const res = await ctx.request({ method: "GET", url: "/api/clerk/commentary-destinations" });
JSON.stringify(res.body)
=> {"destinations":[{"dir":"store/reading","label":"Reading","symbol":"📖"}]}
```

``` cleanup
await ctx.cleanup();
```

## POST `/api/clerk/commentary`

Captures a page as a webpage card into a chosen destination, with an initially
empty commentary card inside its attach scope (and the frozen page beside it) —
committed together. The response carries the chat URL that opens the webpage
card (which renders the page plus its inline commentary) in a companion pane.

```
const ctx = await makeTestServer();
await ctx.seed("store/reading/Reading.landmark.card", `<landmark>
<navigation><label>Reading</label></navigation>
<destination for="commentary"/>
</landmark>`);

const res = await ctx.request({
  method: "POST",
  url: "/api/clerk/commentary",
  payload: {
    url: "https://example.com/article",
    title: "An Article",
    readableMarkdown: "# An Article\n\nBody text.",
    frozenHtml: "<html>frozen</html>",
    destinationDir: "store/reading",
    timestamp: "2026-03-01T12:00:00Z",
  },
});
res.statusCode
=> 200
```

The captured page is a webpage card recording the original URL, with the
readable rendering as its body:

``` continue
const files = await readdir(join(ctx.boxRoot, "store/reading"));
const cardFile = files.find((name) => name.endsWith(".webpage.card"));
const cardContent = await ctx.read(`store/reading/${cardFile}`);
cardContent.includes("source: https://example.com/article")
=> true

cardContent.includes("Body text.")
=> true
```

The frozen page and the empty commentary card sit in the webpage's attach scope:

``` continue
const attachDir = files.find((name) => name.endsWith(".attach"));
const attachFiles = await readdir(join(ctx.boxRoot, "store/reading", attachDir));
attachFiles.includes("page.frozen")
=> true

attachFiles.some((name) => name.endsWith(".commentary.card"))
=> true
```

The `open` URL opens a fresh chat scoped to the destination, with the card in
the companion pane:

``` continue
res.body.open.includes("contextDir=store%2Freading")
=> true

res.body.open.includes("companion=view%3Astore%2Freading%2F")
=> true
```

A `destinationDir` that isn't a real commentary destination is rejected:

``` continue
const bad = await ctx.request({
  method: "POST",
  url: "/api/clerk/commentary",
  payload: {
    url: "https://example.com/x",
    title: "X",
    readableMarkdown: "x",
    destinationDir: "store/nope",
  },
});
bad.statusCode
=> 400
```

Omitting `destinationDir` files into the inbox:

``` continue
const inboxRes = await ctx.request({
  method: "POST",
  url: "/api/clerk/commentary",
  payload: {
    url: "https://example.com/y",
    title: "Y Article",
    readableMarkdown: "# Y",
  },
});
inboxRes.statusCode
=> 200

inboxRes.body.open.includes("contextDir=box%2Finbox")
=> true

const inboxFiles = await readdir(join(ctx.boxRoot, "box/inbox"));
inboxFiles.some((name) => name.endsWith(".webpage.card"))
=> true
```

``` cleanup
await ctx.cleanup();
```

A frozen snapshot larger than Fastify's default 1 MB body limit must still be
accepted — a self-contained page with inlined CSS/images routinely exceeds it,
and a 413 here means the capture silently saves nothing:

```
const ctx = await makeTestServer();
const bigFrozen = `<html><body>${"a".repeat(2 * 1024 * 1024)}</body></html>`;
const res = await ctx.request({
  method: "POST",
  url: "/api/clerk/commentary",
  payload: {
    url: "https://example.com/big",
    title: "Big Page",
    readableMarkdown: "# Big Page\n\nBody.",
    frozenHtml: bigFrozen,
  },
});
res.statusCode
=> 200
```

``` continue
const inboxFiles = await readdir(join(ctx.boxRoot, "box/inbox"));
const attachDir = inboxFiles.find((name) => name.endsWith(".attach"));
const attachFiles = await readdir(join(ctx.boxRoot, "box/inbox", attachDir));
attachFiles.includes("page.frozen")
=> true
```

``` cleanup
await ctx.cleanup();
```

## GET `/api/clerk/actions`

Outbound actions are polled; currently the list is empty and dismissing returns a stub response:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "GET",
  url: "/api/clerk/actions",
});
res.body
=>
{
  "actions": []
}
```

``` continue
const dismiss = await ctx.request({
  method: "POST",
  url: "/api/clerk/actions/example/dismiss",
});
dismiss.body
=>
{
  "dismissed": "example"
}
```

``` cleanup
await ctx.cleanup();
```
