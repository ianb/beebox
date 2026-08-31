# Codex CLI authentication status

Bee Box uses the same package-pinned Codex executable for status probes,
plugin management, history, and SDK turns. The status boundary distinguishes a
confirmed logout from a missing or incompatible CLI; callers can give each one
an honest remedy.

```ts setup
import {
  classifyCodexAuthStatus,
  createFakeCodexCli,
} from "../../src/services/codex-cli.js";
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
