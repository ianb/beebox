# Supervisor: child env allowlist, and the readiness-timeout/exit restart race (Track D, chunk D1)

Two `src/hub/supervisor.ts` behaviors, both found by cross-model review:

1. `buildChildEnv` must ALLOWLIST what a hub-spawned box child inherits from
   the hub's own env, not spread `process.env` wholesale -- `CB_SESSION_SECRET`
   and `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are hub-only
   credentials (see `supervisor.ts`'s `CHILD_ENV_ALLOWLIST` doc comment for
   why: the session secret is symmetric, so any box that could verify a
   cookie could also forge one for a sibling box).
2. When `launch()`'s readiness timeout fires and it kills the still-starting
   child itself, that kill's own eventual "exit" event must NOT ALSO be
   treated as an unexpected crash -- otherwise one failure gets counted (and
   restarted) twice, and two children end up running for one box slot.

```ts setup
import { buildChildEnv, Supervisor } from "../../src/hub/supervisor.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

/** A fake `ChildProc`: just enough surface for `Supervisor.launch()` to use
 *  (`pid`, `on("exit", ...)`, `catch()`) plus a way for the test to fire the
 *  "exit" event itself, standing in for the real process death that a real
 *  `killGroup()` would eventually cause. No real process is ever spawned. */
function makeFakeChild(pid) {
  const exitHandlers = [];
  return {
    pid,
    on(event, cb) {
      if (event === "exit") exitHandlers.push(cb);
    },
    catch() {},
    fireExit(code, signal) {
      for (const cb of exitHandlers) cb(code, signal);
    },
  };
}
```

## `buildChildEnv` allowlists, never spreads

```ts
const sourceEnv = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/callback",
  NODE_ENV: "production",
  PUBLIC_URL: "https://cb.example.org",
  CB_DIAG_API_KEY: "diag-key-value",
  CB_GOOGLE_TOKENS_FILE: "/home/callback/.google-tokens.json",
  THINKING_OPENAI_API_KEY: "sk-thinking-value",
  // Hub-only credentials -- must NEVER reach a child.
  CB_SESSION_SECRET: "hub-only-session-secret",
  GOOGLE_OAUTH_CLIENT_ID: "hub-only-oauth-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "hub-only-oauth-client-secret",
  // Not on the allowlist at all -- an arbitrary var from the hub's shell.
  SOME_UNRELATED_VAR: "should-not-leak",
};

const env = buildChildEnv({ sourceEnv, hubExtras: { CB_HUB_SECRET: "per-boot-hub-secret" } });

JSON.stringify({
  path: env.PATH,
  home: env.HOME,
  nodeEnv: env.NODE_ENV,
  publicUrl: env.PUBLIC_URL,
  diagKey: env.CB_DIAG_API_KEY,
  tokensFile: env.CB_GOOGLE_TOKENS_FILE,
  thinkingKey: env.THINKING_OPENAI_API_KEY,
  hubSecret: env.CB_HUB_SECRET,
})
=> {"path":"/usr/bin:/bin","home":"/home/callback","nodeEnv":"production","publicUrl":"https://cb.example.org","diagKey":"diag-key-value","tokensFile":"/home/callback/.google-tokens.json","thinkingKey":"sk-thinking-value","hubSecret":"per-boot-hub-secret"}
```

```ts continue
"CB_SESSION_SECRET" in env
=> false

"GOOGLE_OAUTH_CLIENT_ID" in env
=> false

"GOOGLE_OAUTH_CLIENT_SECRET" in env
=> false

"SOME_UNRELATED_VAR" in env
=> false
```

A source env with nothing set produces an env containing ONLY the hub
extras -- confirms the allowlist filters, it doesn't just fail to strip:

```ts continue
JSON.stringify(buildChildEnv({ sourceEnv: {}, hubExtras: { CB_HUB_SECRET: "x" } }))
=> {"CB_HUB_SECRET":"x"}
```

## A readiness-timeout kill's own exit event doesn't double-schedule a restart

```ts continue
const fixture = await makeTmpBox();
const children = [];
function spawnChild() {
  const child = makeFakeChild(900000 + children.length);
  children.push(child);
  return child;
}
function checkReady() {
  // Simulates "the child never becomes ready" without a real 30s wait.
  return Promise.reject(new Error("simulated readiness timeout"));
}

const config = {
  port: undefined,
  host: undefined,
  boxes: { fixture: { path: fixture.root } },
  configPath: fixture.path("hub.json"),
};
const supervisor = new Supervisor({ config, hubSecret: "test-hub-secret", spawnChild, checkReady });
await supervisor.startAll();
```

`startAll()` already ran the whole readiness-timeout catch path once: it
recorded the failure, killed the (fake) child, and scheduled exactly one
restart.

```ts continue
const afterTimeout = supervisor.getStatuses()[0];
JSON.stringify({ status: afterTimeout.status, restarts: afterTimeout.restarts })
=> {"status":"starting","restarts":1}
```

Now simulate the killed child's real exit event finally arriving (what a
real `killGroup()` would eventually cause) -- same generation, since the
scheduled restart hasn't run yet. Without the fix this double-counts the
same failure and schedules a second, overlapping restart.

```ts continue
children[0].fireExit(null, "SIGTERM");
const afterExit = supervisor.getStatuses()[0];
JSON.stringify({ status: afterExit.status, restarts: afterExit.restarts })
=> {"status":"starting","restarts":1}
```

```ts cleanup
await supervisor.stopAll();
await fixture.cleanup();
```
