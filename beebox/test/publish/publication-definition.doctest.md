# Publication definition

A publication card `<dir>/<Name>.publication.card` holds the strict,
agent-authored settings. The sibling attach folder chooses the content mode
(`<Name>.attach/static/` or `<Name>.attach/project/`); the card cannot supply
arbitrary paths or build commands.

```ts setup
import { definitionFromCard, publicationDefinitionSchema } from "../../src/publish/publication-definition.js";
import { readPublicationCardSource, resolvePublicationCardPath } from "../../src/publish/prepare/card-source.js";
import { createPublicationCardTemplate } from "../../src/schemas/publication.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const validDefinition = {
  pubId: "abcdefghijklmnop2345672345",
  connection: "personal",
  content: "static",
  title: "Example site",
  tier: "secret",
};
```

## The schema accepts a valid definition and refuses unknown keys

```ts
publicationDefinitionSchema.safeParse(validDefinition).success
=> true

publicationDefinitionSchema.safeParse({ ...validDefinition, source: "../../private" }).success
=> false

publicationDefinitionSchema.safeParse({ ...validDefinition, workerName: "other-box-worker" }).success
=> false
```

## Tier-specific audience fields stay strict

```ts
publicationDefinitionSchema.safeParse({ ...validDefinition, slug: "example" }).success
=> false

publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "public", slug: "example" }).success
=> true

publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "accounts", emails: ["reader@example.test"] }).success
=> true

JSON.stringify(publicationDefinitionSchema.parse({ ...validDefinition, tier: "accounts", emails: ["Reader@Example.test", "reader@example.test"] }).emails)
=> ["reader@example.test"]

JSON.stringify(publicationDefinitionSchema.parse({ ...validDefinition, tier: "accounts", emails: ["z@example.test", "a@example.test"] }).emails)
=> ["a@example.test","z@example.test"]

publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "accounts" }).success
=> false

publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "accounts", slug: "example" }).success
=> false
```

## The attach folder derives the content mode and source root

```ts
const box = await makeTmpBox();
const card = createPublicationCardTemplate({ pubId: validDefinition.pubId, title: "Example site", connection: "personal", tier: "secret" });
await box.write("_content/Example.publication.card", card);
await box.write("_content/Example.attach/static/index.html", "<h1>Hi</h1>");
const staticSource = await readPublicationCardSource({ boxRoot: box.root, cardPath: "_content/Example.publication.card" });
staticSource.definition.content
=> static

staticSource.sourceRoot === box.path("_content/Example.attach/static")
=> true

await box.write("_content/Site.publication.card", createPublicationCardTemplate({ pubId: "bcdefghijklmnop234567abcde", title: "Site", connection: "personal", tier: "secret" }));
await box.write("_content/Site.attach/project/package.json", "{}");
const projectSource = await readPublicationCardSource({ boxRoot: box.root, cardPath: "_content/Site.publication.card" });
projectSource.definition.content
=> project

projectSource.sourceRoot === box.path("_content/Site.attach/project")
=> true

await box.cleanup();
```

## A malformed card gets a field-specific error

```ts
const box = await makeTmpBox();
const base = createPublicationCardTemplate({ pubId: validDefinition.pubId, title: "Example site", connection: "personal", tier: "secret" });
await box.write("_content/Example.publication.card", base.replace("tier: secret", "tier: everyone"));
await box.write("_content/Example.attach/static/index.html", "x");
const loaded = await readPublicationCardSource({ boxRoot: box.root, cardPath: "_content/Example.publication.card" }).catch((error) => error.message);
await box.cleanup();

loaded.startsWith("publication card _content/Example.publication.card cannot be used")
=> true

loaded.includes("tier")
=> true
```

## Card paths cannot become arbitrary paths

```ts
const refused = (card) => { try { resolvePublicationCardPath(card); return "ok"; } catch (error) { return error.message; } };

resolvePublicationCardPath("_content/Example.publication.card")
=> _content/Example.publication.card

refused("../outside.publication.card")
=> publication card path '../outside.publication.card' is not a file inside the box

refused("_content/Example.card")
=> '_content/Example.card' is not a publication card; the path must end with .publication.card

refused("_content/Example.publication.card?x=1")
=> publication card path '_content/Example.publication.card?x=1' must not carry a query or fragment
```

## A publication card becomes a prepare definition

`definitionFromCard` joins the card's request fields with the content mode and
validates the result once, through the definition schema.

```ts continue
const cardPubId = "abcdefghijklmnopqrstuvwxyz";
JSON.stringify(definitionFromCard({ type: "publication", title: "Team", pubId: cardPubId, connection: "cf", tier: "accounts", emails: ["Kim@Example.com", "ari@example.com"] }, "static"))
=> {"pubId":"abcdefghijklmnopqrstuvwxyz","connection":"cf","content":"static","title":"Team","tier":"accounts","emails":["ari@example.com","kim@example.com"]}

JSON.stringify(definitionFromCard({ title: "Home", pubId: cardPubId, connection: "cf", tier: "public", slug: "home" }, "project"))
=> {"pubId":"abcdefghijklmnopqrstuvwxyz","connection":"cf","content":"project","title":"Home","tier":"public","slug":"home"}
```

A card that breaks a rule throws with the field named.

```ts continue
let message = "";
try { definitionFromCard({ title: "Home", pubId: cardPubId, connection: "cf", tier: "secret", slug: "home" }, "static"); }
catch (error) { message = error instanceof Error ? `${error.name}: ${error.message}` : "not an error"; }
message
=> PublicationDefinitionError: publication card abcdefghijklmnopqrstuvwxyz is invalid at card: Unrecognized key: "slug"
```
