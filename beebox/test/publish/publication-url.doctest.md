# Publication links use the approved hostname and tier route

```ts setup
import { publicationUrl, samePublicationAudience } from "../../src/shared/publication-url.js";
const pubId = "abcdefghijklmnopqrstuvwxyz";
```

A custom hostname takes the approved tier path. Public custom domains use the
root path, while a secret URL retains its unguessable publication path.

```ts
publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: { tier: "public", slug: "notes", customHostname: "www.example.org" } })
=> https://www.example.org/

publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: { tier: "secret", customHostname: "private.example.org" } })
=> https://private.example.org/s/abcdefghijklmnopqrstuvwxyz/
```

The workers.dev alias remains available with the same tier routing.

```ts
publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: { tier: "secret" } })
=> https://site.workers.dev/s/abcdefghijklmnopqrstuvwxyz/

publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: { tier: "public", slug: "notes" } })
=> https://site.workers.dev/p/notes/

publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: null })
=> null

samePublicationAudience({ requested: { tier: "public", customHostname: "new.example.org" }, approved: { tier: "public", customHostname: "old.example.org" } })
=> false

samePublicationAudience({ requested: { tier: "accounts", allowedEmails: ["b@example.org", "a@example.org"] }, approved: { tier: "accounts", allowedEmails: ["a@example.org", "b@example.org"] } })
=> true
```
