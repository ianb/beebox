# external-url-check: git-based new-URL detection + verdict cache

`checkExternalUrls` only HEADs a URL the **first time it appears**: a URL already
present in the base git version is never re-checked. The network checker is
injected here so the git detection + the gitignored verdict cache are exercised
offline.

```ts setup
import { checkExternalUrls } from "../../src/core/external/url-check.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import type { UrlVerdict } from "../../src/core/external/url-fetch.js";

// A stub checker: records what it was asked to check, and reports any URL in
// `broken` as a hard 404, everything else as ok.
function stubChecker(broken: Set<string>, log: string[][]) {
  return (urls: string[]): Promise<UrlVerdict[]> => {
    log.push([...urls].toSorted());
    return Promise.resolve(
      urls.map((url) => ({
        url,
        reason: broken.has(url) ? "broken" : "ok",
        status: broken.has(url) ? 404 : 200,
        method: "HEAD",
        detail: broken.has(url) ? "HTTP 404" : "HTTP 200",
      })),
    );
  };
}

const NOW = "2026-06-28T00:00:00.000Z";
```

Commit a doc with one URL, then add a second URL without committing. A working-
tree check (base = HEAD) sees only the *new* URL — the committed one is never
handed to the checker:

```ts
const box = await makeTmpBox({ git: true });
await box.write("notes.md", "[old](https://host-a.linkcheck.dev/a)\n");
box.commitAll("seed");
await box.write(
  "notes.md",
  "[old](https://host-a.linkcheck.dev/a)\n[new](https://host-b.linkcheck.dev/b)\n",
);

const log: string[][] = [];
const r1 = await checkExternalUrls(box.root, {
  mode: { kind: "working" },
  now: NOW,
  check: stubChecker(new Set(), log),
});
JSON.stringify({ checkedThisRun: log[0], reportChecked: r1.checked, broken: r1.broken }, null, 2)
=>
{
  "checkedThisRun": [
    "https://host-b.linkcheck.dev/b"
  ],
  "reportChecked": 1,
  "broken": []
}
```

Now make a newly-added URL broken. It's reported, and recorded in the gitignored
cache so it keeps surfacing — and a *good* URL is stored nowhere:

```ts continue
await box.write(
  "notes.md",
  "[old](https://host-a.linkcheck.dev/a)\n[bad](https://host-c.linkcheck.dev/c)\n",
);
const r2 = await checkExternalUrls(box.root, {
  mode: { kind: "working" },
  now: NOW,
  check: stubChecker(new Set(["https://host-c.linkcheck.dev/c"]), []),
});
const cache = JSON.parse(await box.read(".beebox/url-checks.json"));
JSON.stringify(
  { broken: r2.broken.map((b) => b.url), cacheBroken: Object.keys(cache.broken), cachePending: Object.keys(cache.pending) },
  null,
  2,
)
=>
{
  "broken": [
    "https://host-c.linkcheck.dev/c"
  ],
  "cacheBroken": [
    "https://host-c.linkcheck.dev/c"
  ],
  "cachePending": []
}
```

A known-bad URL is re-checked even though it's no longer "new" (it's now in
HEAD's base set) — and once it returns ok it's dropped from the cache and the
report goes clean:

```ts continue
box.commitAll("commit the bad link");
const log3: string[][] = [];
const r3 = await checkExternalUrls(box.root, {
  mode: { kind: "working" },
  now: NOW,
  check: stubChecker(new Set(), log3), // c now resolves ok
});
const cache3 = JSON.parse(await box.read(".beebox/url-checks.json"));
JSON.stringify({ recheckedThisRun: log3[0], broken: r3.broken, cacheBroken: Object.keys(cache3.broken) }, null, 2)
=>
{
  "recheckedThisRun": [
    "https://host-c.linkcheck.dev/c"
  ],
  "broken": [],
  "cacheBroken": []
}
```

```ts continue
await box.cleanup();
```
</content>
