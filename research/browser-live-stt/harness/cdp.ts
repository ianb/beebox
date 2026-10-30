/**
 * Minimal CDP helper: launch real Chrome on an isolated profile and evaluate
 * in a page with a user gesture (SpeechRecognition.install requires one).
 * Uses Node's built-in WebSocket; no dependency.
 */
import { spawn, type ChildProcess } from "node:child_process";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export interface Page {
  eval: <T>(expression: string, opts?: { timeoutMs?: number }) => Promise<T>;
  close: () => Promise<void>;
  send: (method: string, params?: unknown) => Promise<unknown>;
  /** Protocol events seen so far, for network evidence. */
  events: { method: string; params: unknown }[];
}

export async function launch(opts: { profile: string; url: string; port: number; args?: string[]; headed?: boolean }): Promise<Page> {
  const chrome: ChildProcess = spawn(CHROME, [
    `--user-data-dir=${opts.profile}`,
    `--remote-debugging-port=${String(opts.port)}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(opts.headed === true ? [] : ["--headless=new"]),
    ...(opts.args ?? []),
    opts.url,
  ], { stdio: "ignore" });
  const exited = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));

  let wsUrl: string | undefined;
  for (let i = 0; i < 100 && wsUrl === undefined; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const list = await fetch(`http://127.0.0.1:${String(opts.port)}/json/list`).then((r) => r.json() as Promise<{ type: string; url: string; webSocketDebuggerUrl: string }[]>).catch(() => []);
    wsUrl = list.find((t) => t.type === "page" && t.url.startsWith(opts.url.split("?")[0]!))?.webSocketDebuggerUrl;
  }
  if (wsUrl === undefined) throw new Error("no page target");
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const events: { method: string; params: unknown }[] = [];
  const pending = new Map<number, (m: unknown) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; method?: string; params?: unknown };
    if (m.id !== undefined) pending.get(m.id)?.(m);
    else if (m.method !== undefined) events.push({ method: m.method, params: m.params });
  };
  const send = (method: string, params: unknown = {}): Promise<unknown> =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    events,
    eval: async <T>(expression: string, o: { timeoutMs?: number } = {}): Promise<T> => {
      const r = (await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
        timeout: o.timeoutMs ?? 600_000,
      })) as { result?: { result?: { value?: T }; exceptionDetails?: unknown } };
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result?.result?.value as T;
    },
    close: async () => {
      ws.close();
      chrome.kill();
      await exited;
    },
  };
}
