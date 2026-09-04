# `/api/history/blob/` decodes encoded path segments once

The frontend percent-encodes each filename segment. Fastify decodes the
wildcard route parameter once before the history route passes the path to Git,
including literal percent signs that resemble escapes.

```ts setup
import { execFileSync } from "node:child_process";
import { makeTestServer } from "../helpers/doctest-server.js";
import { buildHistoryBlobUrl } from "../../src/frontend/src/components/history/history-blob-url.js";

const server = await makeTestServer();
const filePath = "_content/media/folder #1/100%25?.txt";
await server.seed("_content/media/folder #1/100%25?.txt", "encoded path payload");
server.commitAll("add encoded history path");
const hash = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: server.boxRoot,
  encoding: "utf-8",
}).trim();
```

The URL reaches the blob whose Git path contains `#`, `?`, and literal `%25`:

```ts
const url = buildHistoryBlobUrl({ apiBase: "/api", hash, filePath });
const response = await server.rawRequest({ method: "GET", url });
`${response.statusCode} ${response.payload}`
=> 200 encoded path payload
```

```ts cleanup
await server.cleanup();
```
