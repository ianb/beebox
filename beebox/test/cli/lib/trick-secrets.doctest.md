# Trick secret declarations

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { readTrickSecrets, resolveTrickSecret, TrickSecretError } from "../../../src/cli/lib/trick-secrets.js";
```

## Reads a declaration without running the trick

```ts
const box = await makeTmpBox();
const trickDir = box.path(join("src", "tricks", "scripts", "images"));
await mkdir(trickDir, { recursive: true });
await writeFile(join(trickDir, "secrets.json"), JSON.stringify([
  { name: "openai-images", reason: "image-generation", env: "OPENAI_API_KEY" },
]));
const declarations = await readTrickSecrets(trickDir);
JSON.stringify(declarations)
=> [{"name":"openai-images","reason":"image-generation","env":"OPENAI_API_KEY"}]
```

```ts cleanup
await box.cleanup();
```

## Resolves through the derived child environment

```ts
const seen = [];
const resolved = await resolveTrickSecret({
  env: { BBX_SERVER_URL: "http://localhost:3210", BBX_BOX_NAME: "test1", BBX_AGENT_TOKEN: "agent-token" },
  declaration: { name: "openai-images", reason: "image-generation", env: "OPENAI_API_KEY" },
  fetchImpl: async (url, init) => {
    seen.push({ url, body: init?.body, authorization: init?.headers?.Authorization });
    return new Response(JSON.stringify({ value: "secret-value", suspect: false }), { status: 200 });
  },
});
resolved.suspect
=> false
```

```ts continue
seen[0].url
=> http://localhost:3210/test1/api/secrets/resolve

seen[0].body
=> {"name":"openai-images","purpose":"image-generation"}

seen[0].authorization
=> Bearer agent-token

resolved.value
=> secret-value
```

## Invalid declarations fail before execution

```ts
const invalidBox = await makeTmpBox();
const invalidDir = invalidBox.path(join("src", "tricks", "scripts", "bad"));
await mkdir(invalidDir, { recursive: true });
await writeFile(join(invalidDir, "secrets.json"), "[{\"name\":\"x\",\"reason\":\"bad reason\",\"env\":\"PATH\"}]");
await readTrickSecrets(invalidDir)
=> throws TrickSecretError
```

```ts cleanup
await invalidBox.cleanup();
```
