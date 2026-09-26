# Publication reference cards use stable identity

The card is an address to server-owned publication state. It stores only the
publication id, preserves same-id notes, and refuses to overwrite conflicts.

```ts setup
import { readFile, mkdir, symlink } from "node:fs/promises";
import { PublicationSchema, createPublicationCardTemplate } from "../../src/schemas/publication.js";
import { parseCardText } from "../../src/core/card-io.js";
import { ensurePublicationReferenceCard, hasPublicationReferenceCard } from "../../src/publish/publication-reference-card.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const pubId = "abcdefghijklmnopqrstuvwxyz";
```

The schema requires a valid publication id and does not store permission fields.

```ts
const valid = parseCardText(createPublicationCardTemplate({ pubId, title: "Home" }), {
  source: "home.publication.card",
  schemas: new Map([[PublicationSchema.type, PublicationSchema]]),
});
const missingId = PublicationSchema.frontmatterSchema.safeParse({ type: "publication", title: "Home" });
const withPermission = PublicationSchema.frontmatterSchema.safeParse({ type: "publication", pubId, approved: true });
JSON.stringify({ id: valid.fields["pubId"], missingId: missingId.success, parsedPermission: withPermission.success && "approved" in withPermission.data })
=> {"id":"abcdefghijklmnopqrstuvwxyz","missingId":false,"parsedPermission":false}
```

Preparation creates the deterministic path once and leaves later human notes intact.

```ts
const box = await makeTmpBox();
const first = await ensurePublicationReferenceCard({ boxRoot: box.root, pubId, title: "Home" });
await box.write(`${first.cardPath}`, `---\ntitle: My label\npubId: ${pubId}\n---\nHuman notes\n`);
const second = await ensurePublicationReferenceCard({ boxRoot: box.root, pubId, title: "Changed upstream title" });
const content = await box.read(first.cardPath);
await box.cleanup();
JSON.stringify({ first, second, preservesEdit: content.includes("My label") && content.includes("Human notes") })
=> {"first":{"cardPath":"_content/publications/abcdefghijklmnopqrstuvwxyz.publication.card","created":true},"second":{"cardPath":"_content/publications/abcdefghijklmnopqrstuvwxyz.publication.card","created":false},"preservesEdit":true}
```

A reference path collision or symlink is left untouched and rejected.

```ts
const box = await makeTmpBox();
const cardPath = `_content/publications/${pubId}.publication.card`;
await mkdir(box.path("_content/publications"), { recursive: true });
await box.write(cardPath, `---\ntitle: Wrong\npubId: bcdefghijklmnopqrstuvwxyz2\n---\n`);
const collision = await ensurePublicationReferenceCard({ boxRoot: box.root, pubId, title: "Home" }).then(() => "created", (error) => error.message);
const preserved = (await readFile(box.path(cardPath), "utf8")).includes("bcdefghijklmnopqrstuvwxyz2");
const listedAsReady = await hasPublicationReferenceCard(box.root, pubId);
await box.cleanup();
JSON.stringify({ refused: collision !== "created", actionable: collision.includes(cardPath) && collision.includes("Move or rename"), preserved, listedAsReady })
=> {"refused":true,"actionable":true,"preserved":true,"listedAsReady":false}
```

```ts
const box = await makeTmpBox();
const directory = box.path("_content/publications");
await mkdir(directory, { recursive: true });
const target = box.path("outside.card");
await box.write("outside.card", "leave alone");
await symlink(target, box.path(`_content/publications/${pubId}.publication.card`));
const rejected = await ensurePublicationReferenceCard({ boxRoot: box.root, pubId, title: "Home" }).then(() => false, (error) => error.message.includes("regular file"));
const stillLink = (await readFile(target, "utf8")) === "leave alone";
await box.cleanup();
JSON.stringify({ rejected, stillLink })
=> {"rejected":true,"stillLink":true}
```
