// # The exec route refuses arguments that leave the box browser
//
// docs/plans/shared-browser.md, Track C (`exec-args.ts`) and the Failure-modes
// row "Agent passes `--profile ~/.config/google-chrome` or `--cdp 9222`". The
// box has one browser and one profile; global flags and subcommands that pick
// another are refused with a 400 that names them.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { checkDashboardExecArgs, checkExecArgs, EXEC_BODY, execSubcommand, REFUSED_FLAGS, REFUSED_SUBCOMMANDS } from "../../../src/core/browser/exec-args.js";

// Plan Track C: ordinary page commands pass.
void test("Ordinary browser commands are accepted", (t) => {
  t.check(checkExecArgs(["open", "https://example.com"]), { ok: true });
  t.check(checkExecArgs(["snapshot", "-i"]), { ok: true });
  t.check(checkExecArgs(["click", "@e3"]), { ok: true });
  t.check(checkExecArgs(["--json", "--max-output", "5000", "get", "text", "@e1"]), { ok: true });
  t.end();
});

// Plan Track C: the refused-flag list, with the message from the Validation error UX bullet.
void test("A refused global flag is named in the message", (t) => {
  t.check(checkExecArgs(["--profile", "/x", "open", "https://example.com"]), {
    ok: false,
    refused: "--profile",
    message: "bbx browser: --profile is fixed for the box browser; the box uses one browser profile",
  });
  t.check(checkExecArgs(["--cdp", "9222", "snapshot"]), { ok: false, refused: "--cdp", message: "bbx browser: --cdp is fixed for the box browser; the box uses one browser profile" });
  t.end();
});

// Plan Track C: `--flag=value` is the same flag.
void test("The --flag=value form is refused too", (t) => {
  t.check(checkExecArgs(["open", "--profile=/x"]), { ok: false, refused: "--profile", message: "bbx browser: --profile is fixed for the box browser; the box uses one browser profile" });
  t.end();
});

// Plan Track C: `-p` is the short form of `--provider`.
void test("The short provider flag is refused", (t) => {
  t.check(checkExecArgs(["-p", "browserbase", "open", "https://example.com"]), {
    ok: false,
    refused: "-p",
    message: "bbx browser: -p is fixed for the box browser; the box uses one browser profile",
  });
  // The value can be glued to a short flag, so `-pbrowserbase` is the same flag.
  t.check(checkExecArgs(["-pbrowserbase", "open", "https://example.com"]), {
    ok: false,
    refused: "-p",
    message: "bbx browser: -p is fixed for the box browser; the box uses one browser profile",
  });
  t.end();
});

// Plan Track C: `--namespace` picks another daemon socket directory, so another set of sessions.
void test("--namespace is refused", (t) => {
  t.check(checkExecArgs(["--namespace", "other", "session", "list"]), {
    ok: false,
    refused: "--namespace",
    message: "bbx browser: --namespace is fixed for the box browser; the box uses one browser profile",
  });
  t.end();
});

// Plan Track C (round 2): `batch` parses each string as its own command, so it is refused outright.
void test("batch is refused so it cannot carry a connect", (t) => {
  t.check(checkExecArgs(["batch", "connect wss://x"]), { ok: false, refused: "batch", message: "bbx browser: \"batch\" is not available for the box browser" });
  t.check(checkExecArgs(["connect", "9222"]), { ok: false, refused: "connect", message: "bbx browser: \"connect\" is not available for the box browser" });
  t.end();
});

// Plan Track C: the subcommand is the first non-flag argument after skipping flag values.
void test("A flag's value that looks like a subcommand is not mistaken for one", (t) => {
  t.check(checkExecArgs(["--screenshot-dir", "connect", "snapshot"]), { ok: true });
  t.check(checkExecArgs(["--max-output", "batch", "snapshot"]), { ok: true });
  t.check(checkExecArgs(["--screenshot-dir", "x", "install"]), { ok: false, refused: "install", message: "bbx browser: \"install\" is not available for the box browser" });
  t.end();
});

// The command socket starts the session before a launching subcommand, found the same way.
void test("The subcommand skips flags and their values", (t) => {
  t.check(
    [["--json", "open", "x"], ["--max-output", "5", "session", "list"], ["--json"], ["close"]].map((args) => execSubcommand(args)),
    ["open", "session", null, "close"],
  );
  t.end();
});

// Plan Track C: a subcommand name later in the line is page text, not a command.
void test("A refused word after the subcommand is an ordinary argument", (t) => {
  t.check(checkExecArgs(["fill", "@e1", "connect"]), { ok: true });
  t.end();
});

// Plan Vocabulary lock-ins: the refused lists are exported constants.
void test("The refused lists are the plan's lists", (t) => {
  t.check([...REFUSED_FLAGS], ["--session", "--session-name", "--profile", "--cdp", "--auto-connect", "--provider", "-p", "--engine", "--executable-path", "--args", "--state", "--restore", "--config", "--headed", "--extension", "--namespace"]);
  t.check([...REFUSED_SUBCOMMANDS], ["connect", "batch", "dashboard", "install", "upgrade", "plugin", "mcp"]);
  t.end();
});

// Plan Track C: Zod body is 1-64 strings under 8 KB.
void test("The body schema bounds the argument list", (t) => {
  t.check(EXEC_BODY.safeParse({ args: ["open"] }).success, true);
  t.check(EXEC_BODY.safeParse({ args: [] }).success, false);
  t.check(EXEC_BODY.safeParse({ args: Array.from({ length: 65 }, () => "a") }).success, false);
  t.check(EXEC_BODY.safeParse({ args: ["a".repeat(8193)] }).success, false);
  t.check(EXEC_BODY.safeParse({ args: [1] }).success, false);
  t.end();
});

// Plan Track C: the proxied dashboard prefixes every command with `--session <name>`;
// only the box session passes, and the other refusals still apply.
void test("The dashboard's commands may name the box session and no other", (t) => {
  t.check(checkDashboardExecArgs(["--session", "box", "open", "https://example.com"]), { ok: true });
  t.check(checkDashboardExecArgs(["--session=box", "snapshot"]), { ok: true });
  const oneSession = { ok: false as const, refused: "--session", message: "the box browser has one session, \"box\"" };
  t.check(checkDashboardExecArgs(["--session", "personal", "open", "x"]), oneSession);
  t.check(checkDashboardExecArgs(["--session=personal", "open", "x"]), oneSession);
  t.check(checkDashboardExecArgs(["open", "x", "--session"]), oneSession);
  // A later `--session` overrides the first upstream, so each one is checked.
  t.check(checkDashboardExecArgs(["--session", "box", "--session", "other", "open", "x"]), oneSession);
  // "New session" with a provider or engine.
  t.check(checkDashboardExecArgs(["--provider", "browserbase", "--session", "box", "open", "x"]), {
    ok: false,
    refused: "--provider",
    message: "bbx browser: --provider is fixed for the box browser; the box uses one browser profile",
  });
  t.check(checkDashboardExecArgs(["--session", "box", "--engine", "lightpanda"]), {
    ok: false,
    refused: "--engine",
    message: "bbx browser: --engine is fixed for the box browser; the box uses one browser profile",
  });
  t.check(checkDashboardExecArgs(["--session", "box", "connect", "9222"]), { ok: false, refused: "connect", message: "bbx browser: \"connect\" is not available for the box browser" });
  t.end();
});
