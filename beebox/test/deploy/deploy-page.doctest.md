# The deploy page

While a production deploy has the hub stopped, nginx serves a page that says
an update is running (`deploy/nginx/beebox.conf`). The page is public, so it
states only when the update started and how long updates usually take. Its
words come from `deployPageText`, and they stop promising a quick return once
a deploy overruns.

```ts setup
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { deployPageText, OVERRUN_MS, PROBABLY_FAILED_MS } from "../../src/shared/deploy-page-text.js";
import { PLACEHOLDERS, renderDeployPageTemplate } from "../../scripts/build-deploy-page.js";

const started = Date.UTC(2026, 8, 18, 21, 41);
const minute = 60_000;
const text = (elapsedMs: number, typicalSeconds: number | null) =>
  deployPageText({ startedMs: started, nowMs: started + elapsedMs, typicalSeconds, startedLabel: "9:41 PM" });
```

A deploy in its usual window says so, with the recorded typical duration.

```ts
text(3 * minute, 228).headline
=> This site is updating

text(3 * minute, 228).detail
=> The update started at 9:41 PM, 3 minutes ago. Updates usually take about 4 minutes. This page reloads when the site is back.
```

With no recorded window yet, the estimate is vague instead of invented. A
viewer whose clock runs behind the server's never sees a negative time.

```ts
text(-2 * minute, null).detail
=> The update started at 9:41 PM, less than a minute ago. Updates usually take a few minutes. This page reloads when the site is back.
```

Past ten minutes the page says the update is late.

```ts
OVERRUN_MS
=> 600000

text(12 * minute, 228).headline
=> This update is taking longer than usual

text(12 * minute, 228).detail
=> It started at 9:41 PM, 12 minutes ago. Updates usually take about 4 minutes. This page reloads when the site is back.
```

Past an hour, which is where a page stranded by a killed deploy ends up, it
says something has probably gone wrong.

```ts
PROBABLY_FAILED_MS
=> 3600000

text(3 * 60 * minute, 228).headline
=> This site is down

text(3 * 60 * minute, 228).detail
=> An update started at 9:41 PM, 3 hours ago, and has not finished. Updates normally take about 4 minutes, so something has probably gone wrong.
```

## The built page

`scripts/build-deploy-page.ts` bundles the browser code into one
self-contained HTML template. The server helper fills its placeholders with
`sed`, so the helper must use the same three names.

```ts
const template = await renderDeployPageTemplate();
const helper = await readFile("deploy/server-bin/bbx-deploy-window", "utf8");
JSON.stringify(Object.values(PLACEHOLDERS).map((p) => [template.split(p).length - 1, helper.includes(p)]))
=> [[1,true],[1,true],[1,true]]
```

The filled page, run with a stub DOM, rewrites the text in the reader's time
and reloads as soon as the site answers without the deploy header.

```ts continue
const page = template
  .replace(PLACEHOLDERS.startedMs, String(Date.now() - 3 * minute))
  .replace(PLACEHOLDERS.startedUtc, "2026-09-18 21:41 UTC")
  .replace(PLACEHOLDERS.typicalSeconds, "228");
const scripts = [...page.matchAll(/<script(?: type="application\/json" id="(\w[\w-]*)")?>([\s\S]*?)<\/script>/g)];
const nodes: Record<string, { textContent: string }> = {
  "bbx-deploy": { textContent: scripts[0]![2]! },
  "bbx-headline": { textContent: "" },
  "bbx-detail": { textContent: "" },
};
let reloads = 0;
let deployHeader = true;
const sandbox = {
  document: { getElementById: (id: string) => nodes[id] ?? null },
  location: { href: "https://box.example.com/a/b", reload: () => { reloads += 1; } },
  fetch: async () => ({ headers: new Headers(deployHeader ? { "X-Beebox-Deploy": "in-progress" } : {}) }),
  setInterval: () => 0,
  console,
};
runInNewContext(scripts[1]![2]!, sandbox);
await new Promise((resolve) => setTimeout(resolve, 0));
JSON.stringify([nodes["bbx-headline"]!.textContent, nodes["bbx-detail"]!.textContent.includes("3 minutes ago"), reloads])
=> ["This site is updating",true,0]

deployHeader = false;
runInNewContext(scripts[1]![2]!, sandbox);
await new Promise((resolve) => setTimeout(resolve, 0));
reloads
=> 1
```
