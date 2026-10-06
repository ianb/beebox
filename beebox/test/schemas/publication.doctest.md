# The publication card carries the request

A publication card is one publication. It requests a connection, an audience
tier, and for some tiers a slug or reader emails.

```ts setup
import { PublicationSchema, createPublicationCardTemplate } from "../../src/schemas/publication.js";
import { parseCardText } from "../../src/core/card-io.js";

const pubId = "abcdefghijklmnopqrstuvwxyz";
const base = { type: "publication", title: "Home", pubId, connection: "cf" };
function check(fields: Record<string, unknown>): string {
  const parsed = PublicationSchema.frontmatterSchema.safeParse({ ...base, ...fields });
  if (parsed.success) return "ok";
  return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}
```

Each tier accepts its own fields. `public` may carry a slug; `accounts` must
carry emails.

```ts
JSON.stringify([
  check({ tier: "public" }),
  check({ tier: "public", slug: "my-site" }),
  check({ tier: "secret" }),
  check({ tier: "accounts", emails: ["kim@example.com"] }),
  check({ tier: "any-account" }),
])
=> ["ok","ok","ok","ok","ok"]
```

A slug outside `public`, missing or empty emails on `accounts`, and emails on
another tier are rejected.

```ts
JSON.stringify([
  check({ tier: "secret", slug: "my-site" }),
  check({ tier: "accounts" }),
  check({ tier: "accounts", emails: [] }),
  check({ tier: "public", emails: ["kim@example.com"] }),
])
=> ["slug: slug is allowed only when tier is public","emails: tier accounts requires a non-empty emails list","emails: Too small: expected array to have >=1 items","emails: emails is allowed only when tier is accounts"]
```

The request fields themselves are required, and the title has the
publication title rule.

```ts
JSON.stringify([
  check({ tier: "nobody" }) === "ok",
  check({ tier: "secret", connection: "Bad Name" }) === "ok",
  check({ tier: "secret", title: "   " }) === "ok",
  PublicationSchema.frontmatterSchema.safeParse({ type: "publication", title: "Home", pubId, tier: "secret" }).success,
])
=> [false,false,false,false]
```

The template renders a card that parses back with the same fields.

```ts
const text = createPublicationCardTemplate({ pubId, title: "Team", connection: "cf", tier: "accounts", emails: ["kim@example.com"], body: "Notes\n" });
const card = parseCardText(text, { source: "Team.publication.card", schemas: new Map([[PublicationSchema.type, PublicationSchema]]) });
JSON.stringify({ tier: card.fields["tier"], emails: card.fields["emails"], body: text.endsWith("Notes\n") })
=> {"tier":"accounts","emails":["kim@example.com"],"body":true}
```
