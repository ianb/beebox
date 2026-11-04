// A terminal that stops reading must not stop the router. The real condition is
// a stdout nobody drains: the child below fills it far past a pipe's buffer, and
// its main thread must still finish its timer. With a plain console.log it would
// block in `write` and never say so. The lines arrive once someone reads, and
// past the bound the terminal is told what it missed.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const writerUrl = new URL("../../../src/router/server/terminal-writer.ts", import.meta.url).href;

const SCRIPT = `
import { startTerminalWriter, writeToTerminal } from ${JSON.stringify(writerUrl)};
startTerminalWriter();
const line = "x".repeat(1024) + "\\n";
for (let i = 0; i < 1500; i += 1) writeToTerminal(line);
setTimeout(() => { process.stderr.write("alive\\n"); }, 100);
setTimeout(() => { writeToTerminal("last\\n"); }, 2000);
setTimeout(() => process.exit(0), 3000);
`;

test("a stdout nobody reads does not stop the main thread, and dropped lines are reported", async () => {
  const child = spawn(process.execPath, ["--import", "tsx/esm", "--input-type=module", "--eval", SCRIPT], { cwd: import.meta.dirname, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pause();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no sign of life; stderr: ${stderr}`)), 15_000);
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.includes("alive")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  // The main thread is alive while its stdout is full. Now read everything.
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (stdout += chunk));
  child.stdout.resume();
  await new Promise((resolve) => child.once("close", resolve));
  assert.match(stdout, /\[router\] the terminal fell behind; 500 lines are only in router\.log\nlast\n$/u);
});
