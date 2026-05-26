import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

let cachedBinary: string | null = null;

function resolveBinary(): string {
  if (cachedBinary !== null) return cachedBinary;
  const pkgPath = require.resolve("agent-browser/package.json");
  const pkgDir = dirname(pkgPath);
  cachedBinary = join(pkgDir, "bin", "agent-browser.js");
  return cachedBinary;
}

export class AgentBrowserError extends Error {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly args: readonly string[];
  constructor({ code, stderr, stdout, args }: { code: number; stderr: string; stdout: string; args: readonly string[] }) {
    super(`agent-browser exited ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`);
    this.name = "AgentBrowserError";
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
    this.args = args;
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export async function run(args: readonly string[]): Promise<RunResult> {
  const binary = resolveBinary();
  return new Promise((resolve, reject) => {
    const child = spawn("node", [binary, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new AgentBrowserError({ code: code === null ? -1 : code, stderr, stdout, args }));
    });
  });
}

export async function runPassthrough(args: readonly string[]): Promise<number> {
  const binary = resolveBinary();
  return new Promise((resolve, reject) => {
    const child = spawn("node", [binary, ...args], { stdio: "inherit" });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => resolve(code === null ? 1 : code));
  });
}
