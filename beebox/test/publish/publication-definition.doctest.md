# Publication definition

Publication definitions are strict agent-authored settings at
`src/publications/<name>/publication.json`. Content mode chooses a fixed source
directory; the definition cannot supply arbitrary paths or build commands.

```ts setup
import { publicationDefinitionSchema, readPublicationDefinition, publicationSourcePath } from "../../src/publish/publication-definition.js";
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

JSON.stringify(publicationDefinitionSchema.parse({ ...validDefinition, tier: "accounts", emails: ["a@example.test", "z@example.test"] }).emails)
=> ["a@example.test","z@example.test"]

publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "accounts" }).success
=> false

publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "accounts", slug: "example" }).success
=> false
```

## Content mode derives the fixed roots

```ts
publicationSourcePath({ boxRoot: "/box", name: "example", content: "static" }) === "/box/src/publications/example/site"
=> true

publicationSourcePath({ boxRoot: "/box", name: "example", content: "project" }) === "/box/src/publications/example/project"
=> true
```

## A malformed definition gets a field-specific error

```ts
const box = await makeTmpBox();
await box.write("src/publications/example/publication.json", JSON.stringify({ ...validDefinition, unknown: true }));
const loaded = await readPublicationDefinition({ boxRoot: box.root, name: "example" }).catch((error) => error.message);
await box.cleanup();

loaded.includes("unknown")
=> true
```

## Names cannot become arbitrary path segments

```ts
let nameError = "";
(() => { try { publicationSourcePath({ boxRoot: "/box", name: "../outside", content: "static" }); } catch (error) { nameError = error.message; } })();
nameError.includes("invalid publication name")
=> true
```
