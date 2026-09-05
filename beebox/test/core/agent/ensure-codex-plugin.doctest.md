# Registering the Codex plugin without hijacking the machine

The `beebox` plugin marketplace is one entry in the developer's global
Codex state, and every checkout on the machine — main, each worktree, the temp
checkout the hourly full suite runs in — reaches this code. So the installer's
job is not "make it point at me"; it is "make sure a working registration
exists", and only claim it when there isn't one.

```ts setup
import { installCodexPlugin, CodexPluginInstallError } from "../../../src/core/agent/ensure-codex-plugin.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

/** A fake `codex`, recording what was asked of it. */
function fakeCodex(responses: (args: string[]) => string) {
  const calls: string[] = [];
  const run = async (args: string[]): Promise<string> => {
    calls.push(args.join(" "));
    return responses(args);
  };
  // `<root>` rather than the real path: the assertions below are literal text,
  // and a developer's absolute home path is not committable (path-leak-check).
  return { run, get calls(): string[] { return calls.map((call) => call.replaceAll(PACKAGE_ROOT, "<root>")); } };
}

/** What `codex plugin list --json` prints for one installed plugin. */
function listing(fields: { version: string; path: string }): string {
  return JSON.stringify({
    installed: [{ pluginId: "beebox-codex@beebox", version: fields.version, source: { path: fields.path } }],
  });
}

/** What `codex plugin marketplace list --json` prints for one marketplace. */
function marketplaces(source: string | null): string {
  return JSON.stringify({
    marketplaces: source === null ? [] : [{ name: "beebox", marketplaceSource: { source } }],
  });
}

/** A real plugin root, so "the path still exists" means what it says. */
const PLUGIN_ROOT = `${PACKAGE_ROOT}/plugins/beebox-codex`;

class FakeCodexFailure extends Error {}
```

A registration at the expected version whose root still exists is left alone,
whichever checkout owns it. This is the worktree case: a session in one
worktree must not re-point the entry at itself while another checkout is using
it, so the only command that runs is the question.

```ts
const codex = fakeCodex(() => listing({ version: "0.1.1", path: PLUGIN_ROOT }));
await installCodexPlugin(codex.run);

JSON.stringify(codex.calls)
=> ["plugin list --json"]
```

Codex cachebusters are build metadata, not a wire-contract version change, so
they do not make every fresh process re-register the global marketplace:

```ts
const codex = fakeCodex(() => listing({
  version: "0.1.1+codex.local-20260831-120000",
  path: PLUGIN_ROOT,
}));
await installCodexPlugin(codex.run);

JSON.stringify(codex.calls)
=> ["plugin list --json"]
```

Since codex-cli 0.153.4 the list also carries the account's remote plugins,
whose `source` has an `id` and no `path`. Only our own entry needs a path; a
parser that demanded one everywhere failed every chat query behind it:

```ts
const codex = fakeCodex(() => JSON.stringify({
  installed: [
    { pluginId: "github@openai-curated-remote", version: "0.1.12", source: { source: "remote", id: "plugin_connector_1p_x" } },
    { pluginId: "beebox-codex@beebox", version: "0.1.1", source: { source: "local", path: PLUGIN_ROOT } },
  ],
}));
await installCodexPlugin(codex.run);

JSON.stringify(codex.calls)
=> ["plugin list --json"]
```

Our own entry without a local path is a registration this module does not
understand, and it re-registers rather than trusting it:

```ts
const codex = fakeCodex((args) => {
  if (args[1] === "list") return JSON.stringify({
    installed: [{ pluginId: "beebox-codex@beebox", version: "0.1.1", source: { source: "remote", id: "plugin_x" } }],
  });
  return "{}";
});
await installCodexPlugin(codex.run);

JSON.stringify(codex.calls.at(-1))
=> "plugin add beebox-codex@beebox --json"
```

The plugin not being installed here is a different fact from the registration
being broken, and collapsing the two is how a checkout hijacks the entry: if
"absent" meant "re-register at me", every fresh worktree would still claim the
marketplace. An existing marketplace whose root is on disk is one we can just
install from.

```ts continue
const borrow = fakeCodex((args) => {
  if (args[1] === "list") return JSON.stringify({ installed: [] });
  if (args[1] === "marketplace") return marketplaces(PACKAGE_ROOT);
  return "{}";
});
await installCodexPlugin(borrow.run);

JSON.stringify(borrow.calls, null, 2)
=> [
  "plugin list --json",
  "plugin marketplace list --json",
  "plugin add beebox-codex@beebox --json"
]
```

When there is no marketplace to install from — or its root is gone — this
checkout registers one. Someone has to.

```ts continue
const claim = fakeCodex((args) => {
  if (args[1] === "list") return JSON.stringify({ installed: [] });
  if (args[1] === "marketplace") return marketplaces("/nonexistent/deleted-temp-checkout");
  return "{}";
});
await installCodexPlugin(claim.run);

JSON.stringify(claim.calls.slice(-2))
=> ["plugin marketplace add <root> --json","plugin add beebox-codex@beebox --json"]
```

**The regression case.** A temp checkout registered the marketplace and was
then deleted, so `codex plugin list` — the very first thing the installer
does — is the command the dangling entry breaks. The old installer treated
that as fatal and threw, which meant it could never repair what it had caused;
every `codex plugin …` command on the machine stayed broken until a human ran
the removal by hand. Now the failed list *is* the repair signal.

```ts
const codex = fakeCodex((args) => {
  if (args[1] === "list") {
    // What Codex prints once the registered marketplace root is gone.
    throw new FakeCodexFailure("marketplace root does not contain a supported manifest");
  }
  return "{}";
});
await installCodexPlugin(codex.run);

JSON.stringify(codex.calls, null, 2)
=> [
  "plugin list --json",
  "plugin remove beebox-codex@beebox --json",
  "plugin marketplace remove beebox --json",
  "plugin marketplace add <root> --json",
  "plugin add beebox-codex@beebox --json"
]
```

The removals are best-effort — they run when the state is already broken, so
"nothing to remove" and "too broken to remove cleanly" are both fine. Only the
`add` has to succeed.

```ts continue
const brokenCleanup = fakeCodex((args) => {
  if (args[1] === "list" || args[1] === "remove" || args[2] === "remove") throw new FakeCodexFailure("no");
  return "{}";
});
await installCodexPlugin(brokenCleanup.run);

JSON.stringify(brokenCleanup.calls.slice(-2))
=> ["plugin marketplace add <root> --json","plugin add beebox-codex@beebox --json"]
```

A registration whose path is gone gets the same repair even when the list
itself still answers — a stale entry naming a culled worktree.

```ts
const codex = fakeCodex((args) => (
  args[1] === "list" ? listing({ version: "0.1.1", path: "/nonexistent/culled-worktree/plugins/beebox-codex" }) : "{}"
));
await installCodexPlugin(codex.run);

JSON.stringify(codex.calls.slice(-1))
=> ["plugin add beebox-codex@beebox --json"]
```

A version that isn't the one this checkout ships is also a re-point: the
plugin's wire contract is what the running code assumes.

```ts continue
const stale = fakeCodex((args) => (
  args[1] === "list" ? listing({ version: "0.0.9", path: PLUGIN_ROOT }) : "{}"
));
await installCodexPlugin(stale.run);

JSON.stringify(stale.calls.length)
=> 5
```

When the `add` itself fails there is nothing left to try, and the caller gets a
typed error with the cause attached rather than a raw exec failure.

```ts continue
const dead = fakeCodex(() => { throw new FakeCodexFailure("codex: command not found"); });
const caught = await installCodexPlugin(dead.run).catch((e: unknown) => e);

JSON.stringify([caught instanceof CodexPluginInstallError, caught instanceof Error ? caught.message : ""])
=> [true,"Could not install the Bee Box Codex plugin"]
```
