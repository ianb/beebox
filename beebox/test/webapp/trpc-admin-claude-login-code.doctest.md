# Admin: Claude Code sign-in delivers the pasted code to the login process

Claude Code's `auth login` opens a page on Anthropic's own site that shows a
one-time code and asks the CLI to read it from stdin. A headless server never
receives that code on its own, so the admin page must carry it:
`admin.claudeLogin` starts the login and returns the URL, `admin.claudeSubmitCode`
hands the code to the waiting process, and the status poll then flips.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { createFakeClaudeCli } from "../../src/services/claude-cli.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

```ts
const box = await makeTmpBox();
const claudeCli = createFakeClaudeCli({ loggedIn: false });
const ctx = {
  boxRoot: box.root,
  boxSlug: "test",
  eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
  services: { claudeCli },
  user: { email: "owner@example.com", name: "Owner" },
  authed: true,
  isOwner: true,
};
const admin = appRouter.createCaller(ctx).admin;
```

Submitting a code before any login is in progress is refused, not swallowed.

```ts continue
const refused = await admin.claudeSubmitCode({ code: "abc" }).then(() => "accepted", (e) => e.message);
refused
=> No sign-in in progress — start again
```

The login returns the sign-in URL (the new claude.com host); status is still
logged-out until the code arrives.

```ts continue
const started = await admin.claudeLogin();
const beforeCode = await admin.claudeStatus();
JSON.stringify([started.status, started.authUrl.startsWith("https://claude.com/cai/oauth/authorize"), beforeCode.loggedIn])
=> ["waiting",true,false]
```

Delivering the code completes the login; the next status poll sees it.

```ts continue
const submitted = await admin.claudeSubmitCode({ code: "  the-code-from-the-page  " });
const afterCode = await admin.claudeStatus();
JSON.stringify([submitted.accepted, afterCode.loggedIn])
=> [true,true]
```

The real service keeps the in-flight login at module scope, because every
mutation builds its own service instance: the instance that started the login
and the one that receives the code are different objects. Two instances agree
about whether a login exists (no process is spawned here — the assertion is on
the shared state, exercised through the refusal path).

```ts continue
const { createClaudeCliService } = await import("../../src/services/claude-cli.js");
const first = createClaudeCliService();
const second = createClaudeCliService();
const r1 = await first.authSubmitCode("x");
const r2 = await second.authSubmitCode("x");
JSON.stringify([r1.accepted, r2.accepted, r1.error === r2.error])
=> [false,false,true]
```

```ts cleanup
await box.cleanup();
```
