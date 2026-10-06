# Two publication cards must not share a pubId

The `pubId` is the publication's identity. A copied card would ask to publish
one site twice, so `lintCardsDispatch` reports every card in the pair.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { lintCardsDispatch } from "../../../src/core/card-lint/core.js";
import { PublicationSchema } from "../../../src/schemas/publication.js";

const ctx = { cardSchemas: new Map([[PublicationSchema.type, PublicationSchema]]) };
function card(pubId: string): string {
  return `---\ntitle: Home\npubId: ${pubId}\nconnection: cf\ntier: secret\n---\n`;
}
```

```ts
const box = await makeTmpBox();
await box.write("_content/sites/Home.publication.card", card("abcdefghijklmnopqrstuvwxyz"));
await box.write("_content/old/Home copy.publication.card", card("abcdefghijklmnopqrstuvwxyz"));
await box.write("_content/sites/Blog.publication.card", card("bbbbbbbbbbbbbbbbbbbbbbbbbb"));
const result = await lintCardsDispatch(
  [box.path("_content/sites/Home.publication.card"), box.path("_content/old/Home copy.publication.card"), box.path("_content/sites/Blog.publication.card")],
  { boxRoot: box.root, ctx },
);
await box.cleanup();
JSON.stringify({ errors: result.totalErrors, distinct: result.results[2]!.errors.length })
=> {"errors":2,"distinct":0}

result.results[0]!.errors[0]!.message
=> Duplicate publication id abcdefghijklmnopqrstuvwxyz: _content/sites/Home.publication.card and _content/old/Home copy.publication.card claim one publication. Keep one card. Delete the copy, or give it a new id from `bbx pub id`.
```
