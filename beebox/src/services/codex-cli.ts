/** Typed boundary for the package-pinned Codex CLI's authentication status. */

import { spawn } from "node:child_process";
import { codexBinaryPath } from "./codex-binary.js";

export type CodexAuthStatus =
  | { kind: "logged-in" }
  | { kind: "logged-out" }
  | { kind: "unavailable"; detail: string }
  | { kind: "inconclusive"; detail: string };

export interface CodexCliService {
  authStatus(): Promise<CodexAuthStatus>;
}

export function classifyCodexAuthStatus(params: {
  errorCode: string | number | null;
  output: string;
}): CodexAuthStatus {
  const output = params.output.trim();
  if (/not logged in/i.test(output)) return { kind: "logged-out" };
  if (params.errorCode === 0 && /logged in/i.test(output)) return { kind: "logged-in" };
  if (params.errorCode === "ENOENT") return { kind: "unavailable", detail: output };
  return { kind: "inconclusive", detail: output || `codex login status exited ${String(params.errorCode)}` };
}

export function createCodexCliService(): CodexCliService {
  return {
    authStatus() {
      return new Promise((resolve) => {
        let binary: string;
        try {
          binary = codexBinaryPath();
        } catch (error) {
          resolve({ kind: "unavailable", detail: error instanceof Error ? error.message : String(error) });
          return;
        }
        const child = spawn(binary, ["login", "status"], { stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        let settled = false;
        const finish = (status: CodexAuthStatus): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(status);
        };
        child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.on("error", (error) => {
          finish({ kind: "unavailable", detail: error.message });
        });
        child.on("close", (code) => {
          finish(classifyCodexAuthStatus({ errorCode: code, output }));
        });
        const timer = setTimeout(() => {
          child.kill();
          finish({ kind: "inconclusive", detail: "codex login status timed out" });
        }, 10_000);
      });
    },
  };
}

export interface FakeCodexCliService extends CodexCliService {
  status: CodexAuthStatus;
  statusCalls: number;
}

export function createFakeCodexCli(options: { status: CodexAuthStatus }): FakeCodexCliService {
  const fake: FakeCodexCliService = {
    status: options.status,
    statusCalls: 0,
    async authStatus() {
      fake.statusCalls += 1;
      return fake.status;
    },
  };
  return fake;
}
