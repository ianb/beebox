# News Brief API

The briefs API manages the news brief reading workflow: listing briefs, reading individual briefs, marking them as read, providing feedback, and completing the reading flow. These routes involve git commits since they mutate card state.

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";

const BRIEF_XML = `<news-brief>
<title>Test Brief</title>
<date>2026-03-01</date>
<byline>A test brief for route testing</byline>
<content format="markdown">
<section id="s1" heading="First Section">
Some content here.
</section>
</content>
<sources>
<ref path="box/inbox/news/item1.news-item.card" />
</sources>
</news-brief>
`;
```

## Listing briefs

An empty box returns no briefs:

```
const ctx = await makeTestServer();
await ctx.inject({ method: "GET", url: "/api/briefs" })
=>
200
«*»"briefs": []«*»
```

``` cleanup
await ctx.cleanup();
```

Unread briefs come from `box/output/briefs/`:

```
const ctx = await makeTestServer();
await ctx.seed("box/output/briefs/2026-03-01_test.news-brief.card", BRIEF_XML);
ctx.commitAll("add test brief");
const res = await ctx.request({ method: "GET", url: "/api/briefs" });
res.body.briefs.length
=> 1
```

``` continue
res.body.briefs[0].relativePath
=> box/output/briefs/2026-03-01_test.news-brief.card

res.body.briefs[0].title
=> Test Brief

res.body.briefs[0].read
=> false
```

``` cleanup
await ctx.cleanup();
```

Read briefs live in `store/archive/briefs/` and have `read-at` and `read-reason` attributes:

```
const ctx = await makeTestServer();
const readBrief = BRIEF_XML.replace("<news-brief>", '<news-brief read-at="2026-03-01T12:00:00Z" read-reason="user">');
await ctx.seed("store/archive/briefs/2026-02-28_old.news-brief.card", readBrief);
ctx.commitAll("add archived brief");
const res = await ctx.request({ method: "GET", url: "/api/briefs" });
res.body.briefs[0].read
=> true
```

``` continue
res.body.briefs[0].readReason
=> user
```

``` cleanup
await ctx.cleanup();
```

Unread briefs are sorted before read ones:

```
const ctx = await makeTestServer();
await ctx.seed("box/output/briefs/2026-03-01_unread.news-brief.card", BRIEF_XML);
const readBrief = BRIEF_XML.replace("<news-brief>", '<news-brief read-at="2026-03-01T12:00:00Z" read-reason="user">');
await ctx.seed("store/archive/briefs/2026-02-28_read.news-brief.card", readBrief);
ctx.commitAll("add briefs");
const res = await ctx.request({ method: "GET", url: "/api/briefs" });
res.body.briefs[0].read
=> false
```

``` continue
res.body.briefs[1].read
=> true
```

``` cleanup
await ctx.cleanup();
```

## Loading a single brief

`GET /api/brief/:path` returns a parsed brief with its content sections:

```
const ctx = await makeTestServer();
await ctx.seed("box/output/briefs/2026-03-01_test.news-brief.card", BRIEF_XML);
const encodedPath = encodeURIComponent("box/output/briefs/2026-03-01_test.news-brief.card");
await ctx.inject({ method: "GET", url: `/api/brief/${encodedPath}` })
=>
200
«*»"brief": {
    "title": "Test Brief"«*»"heading": "First Section"«*»
  }«*»
```

``` cleanup
await ctx.cleanup();
```

Missing briefs return 404:

```
const ctx = await makeTestServer();
const encodedPath = encodeURIComponent("box/output/briefs/nope.news-brief.card");
const res = await ctx.request({ method: "GET", url: `/api/brief/${encodedPath}` });
res.statusCode
=> 404
```

``` cleanup
await ctx.cleanup();
```

## Marking a brief as read

`POST /api/brief/mark-read` moves the brief from `box/output/briefs/` to `store/archive/briefs/` and adds `read-at` and `read-reason` attributes:

```
const ctx = await makeTestServer();
await ctx.seed("box/output/briefs/2026-03-01_test.news-brief.card", BRIEF_XML);
ctx.commitAll("add brief");
const res = await ctx.request({
  method: "POST",
  url: "/api/brief/mark-read",
  payload: { briefPath: "box/output/briefs/2026-03-01_test.news-brief.card" },
});
res.statusCode
=> 200
```

The archived file has `read-at` and `read-reason` attributes:

``` continue
const archivedContent = await ctx.read(res.body.newPath);
archivedContent.includes('read-reason="user"')
=> true
```

``` cleanup
await ctx.cleanup();
```

Already-archived briefs are rejected:

```
const ctx = await makeTestServer();
const readBrief = BRIEF_XML.replace("<news-brief>", '<news-brief read-reason="user">');
await ctx.seed("store/archive/briefs/2026-03-01_test.news-brief.card", readBrief);
ctx.commitAll("add archived brief");
const res = await ctx.request({
  method: "POST",
  url: "/api/brief/mark-read",
  payload: { briefPath: "store/archive/briefs/2026-03-01_test.news-brief.card" },
});
res.statusCode
=> 400
```

``` cleanup
await ctx.cleanup();
```

Missing briefs return 404:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/brief/mark-read",
  payload: { briefPath: "box/output/briefs/nope.news-brief.card" },
});
res.statusCode
=> 404
```

``` cleanup
await ctx.cleanup();
```

## Complete reading with feedback

`POST /api/brief/complete-reading` applies structured feedback (overall rating, reactions, per-section feedback) and archives the brief:

```
const ctx = await makeTestServer();
await ctx.seed("box/output/briefs/2026-03-01_test.news-brief.card", BRIEF_XML);
ctx.commitAll("add brief");
const res = await ctx.request({
  method: "POST",
  url: "/api/brief/complete-reading",
  payload: {
    briefPath: "box/output/briefs/2026-03-01_test.news-brief.card",
    overallRating: "great",
    selectedReactions: [{ id: "interesting-topic", source: "guide" }],
    itemFeedback: [{ id: "s1", feedback: "thumbs-up" }],
  },
});
res.statusCode
=> 200
```

``` continue
const content = await ctx.read(res.body.newPath);
content.includes('overall-rating="great"')
=> true

content.includes('read-reason="user"')
=> true
```

``` cleanup
await ctx.cleanup();
```

Missing required fields are rejected:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/brief/complete-reading",
  payload: { briefPath: "box/output/briefs/test.news-brief.card" },
});
res.statusCode
=> 400
```

``` cleanup
await ctx.cleanup();
```

## Text feedback

`POST /api/brief/feedback` creates a feedback card linked to a brief section:

```
const ctx = await makeTestServer();
await ctx.seed("box/output/briefs/2026-03-01_test.news-brief.card", BRIEF_XML);
ctx.commitAll("add brief");
await ctx.inject({
  method: "POST",
  url: "/api/brief/feedback",
  payload: {
    briefPath: "box/output/briefs/2026-03-01_test.news-brief.card",
    targetId: "s1",
    comment: "Great section!",
  },
})
=>
200
«*»"success": true«*»"isVoice": false«*»
```

``` cleanup
await ctx.cleanup();
```

## Reactions

`GET /api/news-guide/reactions` returns available reactions from the news guide. An empty box returns no reactions:

```
const ctx = await makeTestServer();
await ctx.inject({ method: "GET", url: "/api/news-guide/reactions" })
=>
200
«*»"reactions": []«*»
```

``` cleanup
await ctx.cleanup();
```
