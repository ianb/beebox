/** Request-independent processing resumes sealed records after restart. */
import type { FastifyInstance } from "fastify";
import type { Services } from "../../../services/container.js";
import { withoutBoxWork, withBoxWork } from "../../../lib/box-maintenance.js";
import { startAwakeTimeout, type AwakeTimeout } from "../../../shared/awake-timeout.js";
import { getBoxTime } from "../../../lib/time.js";
import { listCaptures } from "../../../core/quick-capture/store.js";
import { processCapture, type CaptureWorkerContext } from "../../../core/quick-capture/worker.js";
import { quickChatChat } from "../../trpc/routers/quick-chat.js";

export function captureWorkerContext(args: { boxRoot: string; services: Services; owner: string | null }): CaptureWorkerContext {
  return { boxRoot: args.boxRoot, jev: args.services.jev,
    chat: quickChatChat({ boxRoot: args.boxRoot, user: args.owner === null ? null : { email: args.owner, name: args.owner } }) };
}
const pending = new Map<string, Set<Promise<unknown>>>();
export function scheduleCaptureProcessing(args: { boxRoot: string; services: Services; owner: string | null; id: string }): void {
  const task = withoutBoxWork(() => withBoxWork({ boxRoot: args.boxRoot, reason: "quick capture processing" },
    () => processCapture(captureWorkerContext(args), args.id))).catch((error: unknown) => {
    console.error(`[quick-capture] processing admission failed for ${args.id}:`, error);
  });
  let tasks = pending.get(args.boxRoot);
  if (tasks === undefined) { tasks = new Set(); pending.set(args.boxRoot, tasks); }
  tasks.add(task);
  void task.finally(() => { tasks.delete(task); });
}
export function startQuickCaptureLifecycle(args: { server: FastifyInstance; boxRoot: string; services: Services }): void {
  let timer: AwakeTimeout | undefined;
  let stopped = false;
  let running = false;
  let activeSweep: Promise<void> | undefined;
  const sweep = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const now = getBoxTime(args.boxRoot).getTime();
      const records = (await listCaptures(args.boxRoot)).toSorted((a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.id.localeCompare(b.id));
      for (const record of records) {
        const eligible = record.state === "accepted" || record.state === "preparing" || record.state === "sending" || (record.state === "blocked" && record.blockedByGone !== true)
          || (record.state === "failed" && record.nextAttemptAt !== undefined && Date.parse(record.nextAttemptAt) <= now);
        if (eligible) await withBoxWork({ boxRoot: args.boxRoot, reason: "quick capture recovery" }, () => processCapture(captureWorkerContext({ ...args, owner: record.owner }), record.id));
      }
    } finally { running = false; }
  };
  const run = (): void => {
    activeSweep = withoutBoxWork(sweep).catch((error: unknown) => {
      console.error("[quick-capture] recovery failed:", error);
    }).finally(() => {
      if (!stopped) timer = startAwakeTimeout({ timeoutMs: 60000, onTimeout: run });
    });
  };
  run();
  args.server.addHook("onClose", async () => {
    stopped = true; timer?.stop();
    await activeSweep;
    const tasks = pending.get(args.boxRoot);
    if (tasks !== undefined) { await Promise.allSettled([...tasks]); pending.delete(args.boxRoot); }
  });
}
