# Filtering the Landmarks page

"Find a landmark" in the app bar opens the Landmarks page, which has a filter
field above the hierarchy. `filterLandmarks` (`lib/landmark-filter.ts`)
keeps the `landmarks.list` rows whose label or directory contains the text,
plus each match's ancestor landmarks, so a match still shows where it sits.
Order and depth are `list`'s own.

```ts setup
import { filterLandmarks } from "../../src/lib/landmark-filter.js";

// `landmarks.list` order: root first, then by directory; depth counts ancestor landmarks.
const rows = [
  { dir: "", label: "Kitchen", depth: 0 },
  { dir: "garden", label: "Garden", depth: 0 },
  { dir: "garden/beds", label: "Raised beds", depth: 1 },
  { dir: "garden/beds/tomatoes", label: "Tomatoes", depth: 2 },
  { dir: "garden-tools", label: "Tools", depth: 0 },
  { dir: "travel", label: "Trip planning", depth: 0 },
];
const show = (text) => filterLandmarks(rows, text).map((row) => `${"  ".repeat(row.depth)}${row.label}`).join("\n");
```

| Text | Kept | Why |
|---|---|---|
| empty or spaces | every row | the page shows the whole hierarchy |
| `tomato` | Garden, Raised beds, Tomatoes | a deep match keeps its ancestors |
| `BEDS` | Garden, Raised beds, Tomatoes | case is ignored; `beds` is also in the child's directory |
| `trip` | Trip planning | a top-level match has no ancestors to add |
| `garden` | Garden, Raised beds, Tomatoes, Tools | directories match too; `garden-tools` is not under `garden` |
| `kitchen` | Kitchen | the root matches by its own label |
| `zebra` | nothing | |

```ts
show("  ") === show("")
=> true

filterLandmarks(rows, "").length
=> 6

show("tomato")
=> Garden
  Raised beds
    Tomatoes

show("BEDS")
=> Garden
  Raised beds
    Tomatoes

show("trip")
=> Trip planning

show("garden")
=> Garden
  Raised beds
    Tomatoes
Tools

show("kitchen")
=> Kitchen

filterLandmarks(rows, "zebra")
=> []
```

The root landmark pins to the top but is no one's parent (`depth` stays 0
under it), so a match below it does not bring the root along:

```ts
filterLandmarks(rows, "tools").map((row) => row.dir)
=> ["garden-tools"]
```
