// # Launch options are hoisted into env vars
//
// agent-browser reads launch options only when its browser starts, and
// bin/browse's cookie step starts it before an `open` runs, so the flags must
// reach every child through their env vars (src/launch-options.ts).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { hoistLaunchOptions } from "../src/launch-options.js";

// Flags come out wherever they sit, before or after the subcommand; the rest
// keeps its order.
void test("Launch options leave the args and become env assignments.", async (t) => {
  t.check(hoistLaunchOptions(["--headed", "open", "/chats", "--args", "--use-fake-ui-for-media-stream"], {}), {
    args: ["open", "/chats"],
    env: { AGENT_BROWSER_HEADED: "true", AGENT_BROWSER_ARGS: "--use-fake-ui-for-media-stream" },
    flags: ["--headed", "--args"],
  });
});

// A boolean takes an explicit `true`/`false` when one follows, and nothing else.
void test("A boolean consumes only a following true or false.", async (t) => {
  t.check(hoistLaunchOptions(["open", "/", "--headed", "false"], {}).env, { AGENT_BROWSER_HEADED: "false" });

  t.check(hoistLaunchOptions(["--ignore-https-errors", "open", "/"], {}).args, ["open", "/"]);
});

// Repeatable options join with commas, after any value the env already has
// (bin/browse puts the Clerk extension there).
void test("A repeatable option appends to the env's own value.", async (t) => {
  const hoisted = hoistLaunchOptions(["open", "/", "--extension", "a", "--extension", "b"], { AGENT_BROWSER_EXTENSIONS: "clerk" });

  t.check(hoisted.env, { AGENT_BROWSER_EXTENSIONS: "clerk,a,b" });
});

void test("A value option without its value is refused.", async (t) => {
  await t.checkThrows(() => hoistLaunchOptions(["open", "/", "--args"], {}), "BrowseConfigError: --args requires a value");

  await t.checkThrows(() => hoistLaunchOptions(["open", "/", "--proxy", ""], {}), "BrowseConfigError: --proxy requires a value");
});

// The profile is bin/browse's: each worktree and session has its own.
void test("--profile is refused.", async (t) => {
  await t.checkThrows(
    () => hoistLaunchOptions(["open", "/", "--profile", "x"], {}),
    "BrowseConfigError: --profile is not supported: bin/browse gives each worktree and --session its own profile; use --session <name>",
  );
});
