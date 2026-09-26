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
```

Shared-host routes put the public slug at the host root and keep secret URLs
under the unguessable PubId path. They take precedence over legacy custom hosts.

```ts
const sharedPublic = { tier: "public", slug: "hello", sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: "/hello/" } };
publicationUrl({ workersHostname: null, pubId, scope: sharedPublic })
=> https://publish.example.org/hello/

publicationUrl({ workersHostname: null, pubId, scope: { tier: "secret", sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: `/s/${pubId}/` } } })
=> https://publish.example.org/s/abcdefghijklmnopqrstuvwxyz/

publicationUrl({ workersHostname: "legacy.workers.dev", pubId, scope: { ...sharedPublic, customHostname: "legacy.example.org" } })
=> https://publish.example.org/hello/

publicationUrl({ workersHostname: null, pubId, scope: { ...sharedPublic, sharedHost: { ...sharedPublic.sharedHost, path: "//attacker.example/" } } })
=> null

samePublicationAudience({ requested: sharedPublic, approved: { ...sharedPublic, sharedHost: { ...sharedPublic.sharedHost, hostname: "other.example.org" } } })
=> false
```

```ts
samePublicationAudience({ requested: { tier: "accounts", allowedEmails: ["b@example.org", "a@example.org"] }, approved: { tier: "accounts", allowedEmails: ["a@example.org", "b@example.org"] } })
=> true
```
