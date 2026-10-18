// runCommand: a command's whole result as one checkable value.

import { test } from "tap";
import "../../src/tap-check/tap.js";
import { any, runCommand, str, tsxCommand } from "../../src/exports/check.js";

void test("a command's exit code, stdout, and stderr come back together", async (t) => {
  t.check(runCommand([process.execPath, "-e", "console.log('out'); console.error('err'); process.exit(3)"]), {
    exitCode: 3,
    signal: null,
    stdout: "out\n",
    stderr: "err\n",
  });
});

void test("stdin, cwd, and env are passed through", async (t) => {
  t.check(runCommand([process.execPath, "-e", "process.stdin.pipe(process.stdout); console.error(process.env.WHO, process.cwd())"], {
    input: "piped",
    cwd: "/",
    env: { ...process.env, WHO: "tester" },
  }), { exitCode: 0, signal: null, stdout: "piped", stderr: "tester /\n" });
});

void test("a killed process reports its signal", async (t) => {
  t.check(runCommand([process.execPath, "-e", "setInterval(() => {}, 1000)"], { timeoutMs: 200 }), {
    exitCode: null,
    signal: "SIGTERM",
    stdout: "",
    stderr: "",
  });
});

void test("tsxCommand runs a TypeScript file from any cwd", async (t) => {
  t.check(runCommand(tsxCommand(new URL("./fixture-print.ts", import.meta.url).pathname, "a b"), { cwd: "/" }), {
    exitCode: 0,
    signal: null,
    stdout: str`args: a b${any(String)}`,
    stderr: "",
  });
});

void test("a command that cannot start throws", async (t) => {
  t.throws(() => runCommand(["/no/such/command"]), { name: "CommandStartError" });
});
