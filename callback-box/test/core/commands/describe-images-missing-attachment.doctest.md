# describe-images: missing attachment doesn't loop forever

An image card whose attached image file is gone (e.g. lost in a box clone —
see `issues/2026-07-07-capture-pipeline-retries-broken-capture-forever.md`)
is a permanent failure, not a transient one. `describe-images` used to just
skip such a card and, if every card in the call was missing its file, fail
the whole command with `"No valid images found"` — under a procedure step's
`set -euo pipefail`, that failed the entire run every time it was retried,
forever. It now marks the card `status: invalid` immediately and reports
success with nothing analyzed, so the card stops blocking whatever procedure
step keeps re-running against it.

```ts setup
import { runCommand, createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
// Registers the "describe-images" command.
import "../../../src/core/commands/describe-images.js";

process.env["GEMINI_KEY"] = "fake-key-not-called";
```

## A card with no attached image file gets marked invalid, not retried

```ts
const box = await makeTmpBox();
t.teardown(() => box.cleanup());

await box.write(
  "box/inbox/capture-001.attach/photo-001.image.card",
  `---
status: new
filename:
  ref: photo-001.jpg
  captured: 2026-05-14T16:37:00Z
  source: camera-environment
---
`
);
// No photo-001.jpg written alongside it -- the attachment is gone.

const { ctx } = createCollectorContext(box.root);
const result = await runCommand({
  name: "describe-images",
  args: { paths: ["box/inbox/capture-001.attach/photo-001.image.card"] },
  ctx,
});

JSON.stringify({ success: result.success, data: result.data })
=> {"success":true,"data":{"analyzed":0,"total":0,"failed":0,"analyses":[]}}
```

The card is now `invalid`, not stuck `new` for the next retry to trip over
again:

```ts continue
const card = await box.read("box/inbox/capture-001.attach/photo-001.image.card");
card.includes("status: invalid")
=> true

card.includes("Image file missing")
=> true
```
