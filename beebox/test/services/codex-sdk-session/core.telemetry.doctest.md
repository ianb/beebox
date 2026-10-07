# Codex analytics follow the box setting, default off

Codex sends OpenAI usage analytics unless `analytics.enabled` is false. Those
events include hashes of the lines a change adds, which OpenAI's docs do not
mention, so a box opts in with `codexTelemetry: "on"`. The update check and
feedback upload are off on every run: the box pins Codex's version and never
files feedback.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { codexSdkConfig } from "../../../src/services/codex-sdk-session/core.js";
import { codexCliArgs } from "../../../src/services/codex-binary.js";
import { clearBoxConfigCache } from "../../../src/core/box/config.js";
import * as auth from "../../../src/core/agent/auth-preflight.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

async function setTelemetry(boxRoot: string, value: unknown) {
  await mkdir(join(boxRoot, "_config"), { recursive: true });
  await writeFile(join(boxRoot, "_config/box.json"), JSON.stringify(value === undefined ? {} : { codexTelemetry: value }));
  clearBoxConfigCache(boxRoot);
}

const fakeTurn = { sessionId: "s", output: "done", resultText: "done", durationMs: 1, status: "completed", error: null, usage: null, items: [] };
```

## The overrides every Codex run gets

```ts
codexSdkConfig({ systemPrompt: "be brief", analytics: false })
=> { developer_instructions: "be brief", analytics: { enabled: false }, feedback: { enabled: false }, check_for_update_on_startup: false }

codexSdkConfig({ systemPrompt: "", analytics: true }).analytics.enabled
=> true
```

Direct CLI calls (plugin install, login, the auth and history app-servers)
belong to no box. They get the same fixed settings with analytics off; plugin
installs are themselves analytics events.

```ts
codexCliArgs(["plugin", "add", "beebox@beebox", "--json"])
=> ["-c", "analytics.enabled=false", "-c", "feedback.enabled=false", "-c", "check_for_update_on_startup=false", "plugin", "add", "beebox@beebox", "--json"]
```

## Agent runs read the setting

Missing, `"off"`, and an unrecognized value all mean off. Only an explicit
`"on"` turns analytics on.

```ts
const box = await makeTmpBox();
const { runCodexAgent } = await t.mockImport("../../../src/core/agent/codex-run/core.ts", {
  "../../../src/core/agent/auth-preflight.ts": { ...auth, checkCodexAuth: async () => {} },
  "../../../src/core/agent/ensure-codex-plugin.ts": { ensureCodexPluginInstalled: async () => {} },
});
const seen: boolean[] = [];
for (const value of [undefined, "off", "maybe", "on"]) {
  await setTelemetry(box.root, value);
  await runCodexAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "" }, (options) => {
    seen.push(options.analytics);
    return { id: null, run: async () => fakeTurn };
  });
}
seen
=> [false, false, false, true]

await box.cleanup();
```

## Chat runs read it too

A chat finds its box from its working directory.

```ts
const box = await makeTmpBox();
const { createCodexChatBackend } = await t.mockImport("../../../src/services/claude-chat/codex-chat.ts", {
  "../../../src/core/agent/ensure-codex-plugin.ts": { ensureCodexPluginInstalled: async () => {} },
});
const seen: boolean[] = [];
for (const value of [undefined, "on"]) {
  await setTelemetry(box.root, value);
  let created!: () => void;
  const ready = new Promise<void>((resolve) => { created = resolve; });
  const backend = createCodexChatBackend((options) => {
    seen.push(options.analytics);
    created();
    return { id: null, run: async () => fakeTurn };
  });
  const run = backend.start({ cwd: box.root, systemPrompt: "", env: {} });
  await ready;
  await run.close();
}
seen
=> [false, true]

await box.cleanup();
```
