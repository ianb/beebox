# MAP.md coverage check

Tests for `src/core/maps/verify.ts`. Finalize stamps a map that passes this
check even when the agent did not change it, so the rules decide which maps
count as current. Each rule restates the refresh-maps prompt's format section.

```ts setup
import { verifyMapCoverage } from "../../../src/core/maps/verify.js";

function check(content: string, children: string[]): string {
  const r = verifyMapCoverage({ dir: "_content/work", content, children });
  return r.ok ? "ok" : r.problems.join("\n");
}
```

## A map in the prompt's format passes

Subdirectories and anchor files are listed; plain files may be left out; bare
and annotated bullets both count; nested bullets and prose are not checked.

```ts
print(check(
  [
    "# Map: _content/work",
    "",
    "Per-client folders.",
    "",
    "- `acme/` — contracts and invoices, 2024–2026",
    "- `2025/`",
    "  - `2025/q1/` — nested detail is ignored",
    "- `README.md`",
    "- `work.briefing.card` — context for this area",
  ].join("\n"),
  ["2025/", "README.md", "acme/", "notes.md", "work.briefing.card"],
));
=> ok
```

## Header must name the current path

A header left from an older layout fails, so the agent rewrites the map. Every
map on a box migrated to one root carried one of these.

```ts
print(check("# Map: store/work\n\n- `acme/`\n", ["acme/"]));
=> header is "# Map: store/work", expected "# Map: _content/work"
```

## Every subdirectory and anchor must be listed

```ts
print(check("# Map: _content/work\n\n- `acme/`\n", ["acme/", "beta/", "Work.landmark.card", "plain.md"]));
=>
does not list beta/
does not list Work.landmark.card
```

A subdirectory written without its trailing slash is a different name:

```ts
print(check("# Map: _content/work\n\n- `acme` — contracts\n", ["acme/"]));
=>
does not list acme/
lists acme, which is not in the directory's listing
```

## Every listed name must exist

A deleted entry, or one the ignore policy hides, fails:

```ts
print(check("# Map: _content/work\n\n- `acme/`\n- `old-client/` — gone\n", ["acme/"]));
=> lists old-client/, which is not in the directory's listing
```

## An empty map fails on every count

```ts
print(check("", ["acme/"]));
=>
header is "", expected "# Map: _content/work"
does not list acme/
```
