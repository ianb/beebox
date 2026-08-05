import { isRecord } from "@shared/is-record";

const APP_SOURCE = "callback-box-app";
const RELAY_SOURCE = "callback-clerk-relay";
const STATUS_TIMEOUT_MS = 4000;
const MUTATION_TIMEOUT_MS = 60000;

export interface ArrangementRelayResult {
  ok: boolean;
  state?: "ready" | "applied" | "partial";
  message: string;
  undoAvailable?: boolean;
}

const pending = new Map<string, (result: ArrangementRelayResult) => void>();
let installed = false;

function parseResult(value: unknown): ArrangementRelayResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.message !== "string") return null;
  if (value.ok === false) return { ok: false, message: value.message };
  if (value.state !== "ready" && value.state !== "applied" && value.state !== "partial") return null;
  return {
    ok: true,
    state: value.state,
    message: value.message,
    undoAvailable: value.undoAvailable === true,
  };
}

function onMessage(event: MessageEvent): void {
  if (event.source !== window || event.origin !== location.origin) return;
  const data: unknown = event.data;
  if (!isRecord(data) || data.source !== RELAY_SOURCE || data.type !== "tab-arrangement-response") return;
  if (typeof data.correlationId !== "string") return;
  const resolve = pending.get(data.correlationId);
  const result = parseResult(data.result);
  if (resolve === undefined || result === null) return;
  pending.delete(data.correlationId);
  resolve(result);
}

function ensureListener(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("message", onMessage);
}

export function requestTabArrangement(options: {
  action: "status" | "apply" | "undo";
  transferId: string;
  proposal?: unknown;
}): Promise<ArrangementRelayResult> {
  ensureListener();
  const correlationId = crypto.randomUUID();
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: ArrangementRelayResult): void => {
      if (settled) return;
      settled = true;
      pending.delete(correlationId);
      resolve(result);
    };
    pending.set(correlationId, done);
    const suffix = options.action === "status" ? "status-request" : `${options.action}-request`;
    window.postMessage({
      source: APP_SOURCE,
      type: `tab-arrangement-${suffix}`,
      correlationId,
      transferId: options.transferId,
      ...(options.proposal === undefined ? {} : { proposal: options.proposal }),
    }, location.origin);
    const timeout = options.action === "status" ? STATUS_TIMEOUT_MS : MUTATION_TIMEOUT_MS;
    setTimeout(() => done({ ok: false, message: "Callback Clerk did not answer. It may still be working; inspect Chrome before retrying." }), timeout);
  });
}
