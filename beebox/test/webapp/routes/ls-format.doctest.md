# `bbx ls --format`

`bbx ls` lists card files. With `--format`, each `{field}` placeholder in the
template is replaced by the scalar value at that dotted path in the card's YAML
frontmatter (e.g. `{title}`, `{exif.camera}`). Missing or non-scalar fields
render as the empty string. Each formatted line is `<relative-path>\t<rendered>`.

```ts setup
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { executeCommandStreaming } from "../../../src/webapp/routes/commands.js";

async function lsLines(boxRoot, args) {
  const out = [];
  await executeCommandStreaming({
    command: "ls",
    args,
    boxRoot,
    emit: (line) => { if (line.type === "output") out.push(line.text); },
  });
  return out;
}
```

## Format pulls scalar frontmatter fields

```ts
const box = await makeTmpBox();
await mkdir(join(box.root, "_content/inbox"), { recursive: true });
await writeFile(join(box.root, "_content/inbox/Hello.memo.card"), `---
title: Hello World
status: new
created: 2026-01-01T00:00:00Z
---
Body.
`);
const lines = await lsLines(box.root, { paths: ["_content/inbox"], format: "{title} ({status})" });
JSON.stringify(lines)
=> ["_content/inbox/Hello.memo.card\tHello World (new)"]
```

```ts cleanup
await box.cleanup();
```

## Nested fields resolve; missing fields are empty

```ts
const box = await makeTmpBox();
await mkdir(join(box.root, "_content/inbox"), { recursive: true });
await writeFile(join(box.root, "_content/inbox/Photo.image.card"), `---
title: Beach
exif:
  camera: Canon
---
`);
const nested = await lsLines(box.root, { paths: ["_content/inbox/Photo.image.card"], format: "{exif.camera}" });
JSON.stringify(nested)
=> ["_content/inbox/Photo.image.card\tCanon"]

const missing = await lsLines(box.root, { paths: ["_content/inbox/Photo.image.card"], format: "{nope}" });
JSON.stringify(missing)
=> ["_content/inbox/Photo.image.card\t"]
```

```ts cleanup
await box.cleanup();
```

## Bare `ls` (no format) lists paths only

```ts
const box = await makeTmpBox();
await mkdir(join(box.root, "_content/inbox"), { recursive: true });
await writeFile(join(box.root, "_content/inbox/Hello.memo.card"), "---\ntitle: Hi\n---\n");
const lines = await lsLines(box.root, { paths: ["_content/inbox"] });
JSON.stringify(lines)
=> ["_content/inbox/Hello.memo.card"]
```

```ts cleanup
await box.cleanup();
```
