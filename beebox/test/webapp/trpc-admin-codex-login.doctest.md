# Admin: Codex device authentication

The Admin API exposes Codex's device-code ceremony without sending credentials
through Bee Box. Codex owns token persistence; the browser receives only the
verification URL and short-lived user code.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { createFakeCodexCli } from "../../src/services/codex-cli.js";
import { checkCodexAuth, resetCodexAuthCache } from "../../src/core/agent/auth-preflight.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

```ts
const box = await makeTmpBox();
const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
const ctx = {
  boxRoot: box.root,
  boxSlug: "test",
  eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
  services: { codexCli },
  user: { email: "owner@example.com", name: "Owner" },
  authed: true,
  isOwner: true,
};
const admin = appRouter.createCaller(ctx).admin;
```

Starting login returns the provider-owned verification destination and code.
It does not make the account appear authenticated before Codex completes the
flow.

```ts continue
const started = await admin.codexLogin();
const status = await admin.codexStatus();
JSON.stringify([started.verificationUrl, started.userCode, codexCli.loginPending, status.kind])
=> ["https://auth.openai.com/codex/device","ABCD-1234",true,"logged-out"]
```

Cancellation ends the pending ceremony, and logout clears authenticated state.

```ts continue
await admin.codexCancelLogin();
codexCli.loginPending
=> false

codexCli.status = { kind: "logged-in" };
const loggedOut = await admin.codexLogout();
const afterLogout = await admin.codexStatus();
JSON.stringify([loggedOut.success, afterLogout.kind])
=> [true,"logged-out"]
```

Logout also invalidates the run-path's positive authentication cache. A chat
after logout probes again and sees the logout instead of running on a stale
ten-minute success.

```ts continue
resetCodexAuthCache();
codexCli.status = { kind: "logged-in" };
await checkCodexAuth({ codexCli });
await admin.codexLogout();
await checkCodexAuth({ codexCli }).then(() => "ready", (error) => error.name)
=> CodexAuthError
```

```ts cleanup
await box.cleanup();
```
