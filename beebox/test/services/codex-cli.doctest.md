# Codex CLI authentication status

Bee Box uses the package-pinned Codex executable for status probes, device
login, plugin management, and history; SDK turns use the version-matched SDK
vendored runtime. The status boundary distinguishes a
confirmed logout from a missing or incompatible CLI; callers can give each one
an honest remedy.

```ts setup
import {
  classifyCodexAuthStatus,
  createCodexCliService,
  createFakeCodexCli,
} from "../../src/services/codex-cli.js";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

## The supported status answers are explicit

```ts
JSON.stringify(classifyCodexAuthStatus({ errorCode: 0, output: "Logged in using ChatGPT" }))
=> {"kind":"logged-in"}

JSON.stringify(classifyCodexAuthStatus({ errorCode: 1, output: "warning: config note\nNot logged in\nRun codex login" }))
=> {"kind":"logged-out"}
```

An absent executable and an answer whose contract changed are different from a
logout. Neither should tell the boxholder to log in.

```ts continue
JSON.stringify(classifyCodexAuthStatus({ errorCode: "ENOENT", output: "spawn codex ENOENT" }))
=> {"kind":"unavailable","detail":"spawn codex ENOENT"}

JSON.stringify(classifyCodexAuthStatus({ errorCode: 2, output: "error: unexpected argument 'status'" }))
=> {"kind":"inconclusive","detail":"error: unexpected argument 'status'"}

JSON.stringify(classifyCodexAuthStatus({ errorCode: 2, output: "API key - sk-secret_123" }))
=> {"kind":"inconclusive","detail":"API key - <redacted>"}
```

The fake is observable so cache tests can prove that a second check did not
shell out again.

```ts
const cli = createFakeCodexCli({ status: { kind: "logged-in" } });
await cli.authStatus();
await cli.authStatus();
cli.statusCalls
=> 2
```

## Starting again replaces a stale device ceremony

The production service talks to Codex app-server over JSONL. A second start
must cancel and replace an abandoned ceremony rather than handing the owner an
expired code. This scripted binary exercises that real client path, not the
domain fake used by the router test.

```ts
const dir = await mkdtemp(join(tmpdir(), "bbx-codex-auth-"));
const binary = join(dir, "codex-fixture.mjs");
await writeFile(binary, `#!/usr/bin/env node
import * as readline from "node:readline";
if (process.argv[2] === "login" && process.argv[3] === "status") {
  console.log("Not logged in");
  process.exit(1);
}
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") console.log(JSON.stringify({ id: message.id, result: {} }));
  if (message.method === "account/login/start") console.log(JSON.stringify({
    id: message.id,
    result: {
      type: "chatgptDeviceCode",
      loginId: "login-" + process.pid,
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "CODE-" + process.pid,
    },
  }));
  if (message.method === "account/login/cancel") console.log(JSON.stringify({ id: message.id, result: {} }));
});
`);
await chmod(binary, 0o755);
const realClient = createCodexCliService({ binaryPath: binary });
const first = await realClient.authLogin();
const second = await realClient.authLogin();
const replaced = [first.userCode !== second.userCode, await realClient.authCancel()];
await rm(dir, { recursive: true });
JSON.stringify(replaced)
=> [true,{"success":true}]
```
