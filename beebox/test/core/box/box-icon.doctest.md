# Rendering a box's mark

`renderBoxIcon` (`core/box/box-icon.ts`) turns a box's root-landmark symbol
into a PNG for the surfaces that need a real raster — an installed app's icon,
a notification. It renders **only** bundled Twemoji artwork: the route that
serves it is reachable unauthenticated on a standalone server (the box auth
hook waves through asset extensions), so it must never turn box files into
bytes it hands out.

```ts setup
import { renderBoxIcon } from "../../../src/core/box/box-icon.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const render = (box, size = 192) => renderBoxIcon({ boxRoot: box.root, slug: "kitchen", size });

/** Colour, so we know it drew artwork rather than a monochrome text glyph. */
async function describe(png: Buffer) {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let coloured = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) coloured++;
  }
  return `${info.width}x${info.height} ${coloured > 0 ? "colour" : "monochrome"}`;
}
```

## An emoji symbol renders, in colour, at the size asked for

Colour is the point: rendering the emoji as SVG *text* produced monochrome line
art, and nothing at all on a server with no emoji font.

```ts
const box = await makeTmpBox();
await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Kitchen\n  symbol: 🍳\n---\n");
const icon = await render(box);
await describe(icon.png)
=> 192x192 colour
```

```ts continue
await describe((await render(box, 180)).png)
=> 180x180 colour
```

The ETag covers the source and the size, so two sizes are not the same entity
and a card edit changes it.

```ts continue
(await render(box, 192)).etag === (await render(box, 180)).etag
=> false
```

## An image symbol does not render here

It is the box's own file. The caller answers with the app's own icon instead,
which is what such a box showed before any of this existed — handing the file
to an unauthenticated caller to improve on that is not a trade worth making.

```ts
const box = await makeTmpBox();
await box.write("_content/art/pan.png", "not really a png, and never read");
await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Kitchen\n  symbol:\n    src: /_content/art/pan.png\n---\n");
await render(box)
=> null
```

## A symbol with no artwork is an ordinary null

A word, a letter, or an emoji newer than the bundled set — the caller falls
back to the app's own icon rather than failing the request.

```ts
const box = await makeTmpBox();
await box.write("_content/Box.landmark.card", "---\nnavigation:\n  label: Kitchen\n  symbol: Kitchen\n---\n");
JSON.stringify([await render(box), await render(await makeTmpBox())])
=> [null,null]
```
