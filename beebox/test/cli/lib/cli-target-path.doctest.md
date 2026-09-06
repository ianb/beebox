# `resolveCliTargetPath` — the shared `bbx` path-argument guard

`validate`, `ls`, `mv`, `rm`, and `create` each take a box-path CLI
argument and independently hand-rolled `path.isAbsolute(p) ? p :
<join>`. `resolveCliTargetPath` (`src/cli/lib/cli-target-path.ts`) is the
one place that resolution now happens, guarding two leaks
(`docs/plans/display-path-guard.subplan.md`): a boxholder DISPLAY-FORM path
(`Config:box.json`) is rejected outright, and a canonical box-ref form
(`/_config/box.json`) — which `path.isAbsolute` can't distinguish from a
real OS-absolute path — resolves against `boxRoot`, not the filesystem root.

```ts setup
import { DisplayFormPathArgError,
  ReservedSegmentPathArgError, resolveCliTargetPath } from "../../../src/cli/lib/cli-target-path.js";
```

## A plain relative argument joins onto `relativeTo`

```ts
resolveCliTargetPath({ boxRoot: "/box", raw: "recipes/Soup.recipe.card", relativeTo: "/box" })
=> /box/recipes/Soup.recipe.card

resolveCliTargetPath({ boxRoot: "/box", raw: "recipes/Soup.recipe.card", relativeTo: "/somewhere/else" })
=> /somewhere/else/recipes/Soup.recipe.card
```

## A canonical box-ref form (`/_config/...`) resolves against `boxRoot`, not as an OS-absolute path

Before this fix, `path.isAbsolute("/_config/box.json")` was `true`, so the
argument was used AS-IS — resolving from the real filesystem root, not the
box root, and silently finding nothing:

```ts
resolveCliTargetPath({ boxRoot: "/box", raw: "/_config/box.json", relativeTo: "/somewhere/else" })
=> /box/_config/box.json

resolveCliTargetPath({ boxRoot: "/box", raw: "/_bookkeeping/jobs/x.job.card", relativeTo: "/box" })
=> /box/_bookkeeping/jobs/x.job.card
```

## A genuine OS-absolute path (not naming an area) is used as-is

```ts
resolveCliTargetPath({ boxRoot: "/box", raw: "/box/_content/recipes/Soup.recipe.card", relativeTo: "/box" })
=> /box/_content/recipes/Soup.recipe.card

resolveCliTargetPath({ boxRoot: "/box", raw: "/etc/passwd", relativeTo: "/box" })
=> /etc/passwd
```

## A display-form path throws `DisplayFormPathArgError`, naming the canonical form

```ts
function tryResolve(raw: string): string {
  try {
    return resolveCliTargetPath({ boxRoot: "/box", raw, relativeTo: "/box" });
  } catch (e) {
    return e instanceof DisplayFormPathArgError ? `DisplayFormPathArgError: ${e.message}` : "unexpected error";
  }
}

tryResolve("Config:box.json")
=> DisplayFormPathArgError: `Config:box.json` is the boxholder's display form; write `/_config/box.json`

tryResolve("Bookkeeping:jobs/x.job.card")
=> DisplayFormPathArgError: `Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`
```

`content:` is never a display form (a real URI scheme; `_content` displays
bare) — it resolves as an ordinary relative argument instead of throwing:

```ts continue
tryResolve("content:box.json")
=> /box/content:box.json
```

A `<label>://` double-slash form is a URL, never a display form:

`path.join` normalizes the doubled slash away, same as any other relative
argument:

```ts continue
tryResolve("Config://box.json")
=> /box/Config:/box.json
```

## Nested reserved area names are refused

A path nesting a non-`_tmp` area name below the root throws
`ReservedSegmentPathArgError` (`box-reserved-segments.ts`) — same guard shape
as the display-form rejection, and both share the `BoxPathArgError` base the
commands catch:

```ts
function tryReserved(raw: string): string {
  try {
    return resolveCliTargetPath({ boxRoot: "/box", raw, relativeTo: "/box" });
  } catch (e) {
    return e instanceof ReservedSegmentPathArgError ? `ReservedSegmentPathArgError: ${e.message}` : "unexpected error";
  }
}

tryReserved("/_content/recipes/_config/x.card")
=> ReservedSegmentPathArgError: _content/recipes/_config/x.card: "_config" is a reserved box-area name, legal only at the box root (a nested _tmp is the one exception) — rename this entry

tryReserved("_content/scratch/_tmp/x.txt")
=> /box/_content/scratch/_tmp/x.txt

tryReserved("/_config/_template-updates/_content/briefing.md")
=> /box/_config/_template-updates/_content/briefing.md
```
