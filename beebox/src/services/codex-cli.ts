/** Typed boundary for package-pinned Codex authentication operations. */

import { execFile, spawn } from "node:child_process";
import { codexBinaryPath } from "./codex-binary.js";
import { CodexAuthAppServer } from "./codex-auth-app-server.js";

export type CodexAuthStatus =
  | { kind: "logged-in" }
  | { kind: "logged-out"; detail?: string | undefined }
  | { kind: "unavailable"; detail: string }
  | { kind: "inconclusive"; detail: string };

export interface CodexCliService {
  authStatus(): Promise<CodexAuthStatus>;
  authLogin(): Promise<CodexDeviceLogin>;
  authCancel(): Promise<{ success: boolean; error?: string }>;
  authLogout(): Promise<{ success: boolean; error?: string }>;
}

export interface CodexDeviceLogin {
  verificationUrl: string;
  userCode: string;
}

let activeLogin: { server: CodexAuthAppServer; loginId: string; device: CodexDeviceLogin } | null = null;
let lastLoginError: string | null = null;

export function redactCodexCliDetail(detail: string): string {
  return detail
    .replaceAll(/\bsk-[\w-]+/g, "<redacted-api-key>")
    .replaceAll(/((?:api key|access token)\s*-\s*)\S+/gi, "$1<redacted>");
}

export function classifyCodexAuthStatus(params: {
  errorCode: string | number | null;
  output: string;
}): CodexAuthStatus {
  const output = params.output.trim();
  if (/not logged in/i.test(output)) return { kind: "logged-out" };
  if (params.errorCode === 0 && /logged in/i.test(output)) return { kind: "logged-in" };
  if (params.errorCode === "ENOENT") return { kind: "unavailable", detail: redactCodexCliDetail(output) };
  return {
    kind: "inconclusive",
    detail: redactCodexCliDetail(output || `codex login status exited ${String(params.errorCode)}`),
  };
}

export function createCodexCliService(options?: { binaryPath?: string | undefined }): CodexCliService {
  const resolveBinary = (): string => options?.binaryPath ?? codexBinaryPath();
  return {
    authStatus() {
      return new Promise((resolve) => {
        let binary: string;
        try {
          binary = resolveBinary();
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
          resolve(status.kind === "logged-out" && lastLoginError
            ? { kind: "logged-out", detail: lastLoginError }
            : status);
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
    async authLogin() {
      if (activeLogin) {
        const previous = activeLogin;
        activeLogin = null;
        try {
          await previous.server.cancel(previous.loginId);
        } catch (error) {
          console.warn("[codex-auth] could not cancel superseded login; closing it:", error);
        } finally {
          previous.server.close();
        }
      }
      lastLoginError = null;
      const server = new CodexAuthAppServer(resolveBinary());
      try {
        await server.initialize();
        const result = await server.startLogin();
        const device = { verificationUrl: result.verificationUrl, userCode: result.userCode };
        activeLogin = { server, loginId: result.loginId, device };
        server.onCompleted((completed) => {
          if (activeLogin?.server !== server) return;
          if (!completed.success) {
            lastLoginError = redactCodexCliDetail(completed.error ?? "Codex authentication did not complete");
            console.error("[codex-auth] device login failed:", lastLoginError);
          }
          activeLogin = null;
          server.close();
        });
        server.onExit(() => {
          if (activeLogin?.server === server) activeLogin = null;
        });
        return device;
      } catch (error) {
        server.close();
        throw error;
      }
    },
    async authCancel() {
      const login = activeLogin;
      if (!login) return { success: true };
      try {
        await login.server.cancel(login.loginId);
        login.server.close();
        activeLogin = null;
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async authLogout() {
      await this.authCancel();
      lastLoginError = null;
      return new Promise((resolve) => {
        let binary: string;
        try {
          binary = resolveBinary();
        } catch (error) {
          resolve({ success: false, error: error instanceof Error ? error.message : String(error) });
          return;
        }
        execFile(binary, ["logout"], { timeout: 10_000 }, (error) => {
          resolve(error ? { success: false, error: error.message } : { success: true });
        });
      });
    },
  };
}

export interface FakeCodexCliService extends CodexCliService {
  status: CodexAuthStatus;
  statusCalls: number;
  loginPending: boolean;
}

export function createFakeCodexCli(options: { status: CodexAuthStatus }): FakeCodexCliService {
  const fake: FakeCodexCliService = {
    status: options.status,
    statusCalls: 0,
    loginPending: false,
    async authStatus() {
      fake.statusCalls += 1;
      return fake.status;
    },
    async authLogin() {
      fake.loginPending = true;
      return { verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" };
    },
    async authCancel() {
      fake.loginPending = false;
      return { success: true };
    },
    async authLogout() {
      fake.loginPending = false;
      fake.status = { kind: "logged-out" };
      return { success: true };
    },
  };
  return fake;
}
