# Actions API

The actions API handles mutations — answering questions, creating cards, and triggering processing. These routes delegate to the command runner.

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";

const QUESTION_YAML = `---\ntype: question\nstatus: pending\nprompt: What color?\ninput:\n  type: text\n---\n`;

const SELECT_QUESTION_YAML = `---\ntype: question\nstatus: pending\nprompt: Pick one\ninput:\n  type: select\n  options:\n    - {id: red, label: Red}\n    - {id: blue, label: Blue}\n---\n`;
```

## Answering a question

`POST /api/actions/answer` answers a pending question card. The card is updated and committed:

```
const ctx = await makeTestServer();
await ctx.seed("box/inbox/test.question.card", QUESTION_YAML);
ctx.commitAll("add question");
const res = await ctx.request({
  method: "POST",
  url: "/api/actions/answer",
  payload: { questionPath: "box/inbox/test.question.card", answer: "Blue" },
});
res.statusCode
=> 200
```

``` continue
res.body.success
=> true

res.body.message
=> Question answered
```

The card now has `status: answered`:

``` continue
const content = await ctx.read("box/inbox/test.question.card");
content.includes("status: answered")
=> true

content.includes("Blue")
=> true
```

``` cleanup
await ctx.cleanup();
```

Missing questionPath returns 400:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/actions/answer",
  payload: { answer: "Blue" },
});
res.statusCode
=> 400
```

``` cleanup
await ctx.cleanup();
```

Missing both answer and selectedId returns 400:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/actions/answer",
  payload: { questionPath: "box/inbox/test.question.card" },
});
res.statusCode
=> 400
```

``` cleanup
await ctx.cleanup();
```

## Creating a card

`POST /api/actions/create` creates a card from a template:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/actions/create",
  payload: {
    path: "box/inbox/new.memo.card",
    template: "memo",
    args: { content: "Hello from the API" },
  },
});
res.statusCode
=> 200
```

``` continue
res.body.success
=> true

res.body.path
=> box/inbox/new.memo.card
```

The card exists on disk:

``` continue
const content = await ctx.read("box/inbox/new.memo.card");
content.includes("Hello from the API")
=> true
```

``` cleanup
await ctx.cleanup();
```

Missing path returns 400:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/actions/create",
  payload: { template: "memo" },
});
res.statusCode
=> 400
```

``` cleanup
await ctx.cleanup();
```

Missing template returns 400:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/actions/create",
  payload: { path: "box/inbox/test.memo.card" },
});
res.statusCode
=> 400
```

``` cleanup
await ctx.cleanup();
```
