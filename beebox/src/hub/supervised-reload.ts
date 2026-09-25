/** Surviving hub ownership across an old child's exit and successor readiness. */
import { acquireBoxMaintenance, type BoxMaintenance } from "../lib/box-maintenance.js";
import { DEV_BUNDLE_RELOAD_REQUEST, DEV_BUNDLE_RELOAD_NOW, DEV_BUNDLE_RELOAD_ABORTED, DEV_BUNDLE_RELOAD_EXIT_CODE } from "../lib/dev-bundle-reload.js";
import { invariant } from "../lib/invariant.js";
import { BOX_KILL_GRACE_MS, describeError } from "./child-process-utils.js";
import type { ManagedBox } from "./supervisor.js";

interface ReloadOptions {
  box: ManagedBox; launch: () => Promise<void>; isStopped: () => boolean; isReady: () => boolean;
}

export function installReloadHandler(options: ReloadOptions & { generation: number }): void {
  const { box, generation } = options;
  const request = async (): Promise<void> => {
    // A new generation can notice another build before its predecessor's
    // controller has finished releasing ownership. Do not lose that request.
    if (box.reloadPromise) await box.reloadPromise;
    if (box.generation !== generation || box.reloadPromise) return;
    box.reloadPromise = reloadSupervisedBox(options).finally(() => { delete box.reloadPromise; });
    await box.reloadPromise;
  };
  box.child?.on("message", (message: unknown) => {
    if (typeof message !== "object" || message === null || !("type" in message) || message.type !== DEV_BUNDLE_RELOAD_REQUEST) return;
    void request().catch((error: unknown) => { console.error(`[hub] reload cleanup failed: ${describeError(error)}`); });
  });
}

export async function reloadSupervisedBox({ box, launch, isStopped, isReady }: ReloadOptions): Promise<void> {
  const child = box.child;
  if (!child) return;
  let changing = false;
  let maintenance: BoxMaintenance | undefined;
  try {
    maintenance = await acquireBoxMaintenance(box.entry.path, { reason: "development reload" });
    if (box.child !== child || box.status !== "running") return;
    await maintenance.beginChanges();
    changing = true;
    let timer: NodeJS.Timeout | undefined;
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("exit", (exitCode) => resolve(exitCode));
      timer = setTimeout(() => reject(new BoxReloadError({ reason: "exit-timeout" })), BOX_KILL_GRACE_MS);
      child.send({ type: DEV_BUNDLE_RELOAD_NOW }, (error) => { if (error) reject(error); });
    }).finally(() => { clearTimeout(timer); });
    invariant(code === DEV_BUNDLE_RELOAD_EXIT_CODE, "Old child did not acknowledge reload");
    if (isStopped()) {
      await maintenance.complete();
      return;
    }
    box.child = undefined;
    box.port = undefined;
    box.restarts += 1;
    await maintenance.prepare();
    await launch();
    if (isReady()) await maintenance.complete();
    else throw new BoxReloadError({ reason: "not-ready" });
  } catch (error) {
    box.lastError = describeError(error);
    console.error(`[hub] ${box.slug} reload: ${box.lastError}`);
    if (changing) {
      if (box.restartTimer) clearTimeout(box.restartTimer);
      box.status = "unhealthy";
      box.consecutiveFailures += 1;
      await maintenance?.beginChanges();
    } else {
      child.send({ type: DEV_BUNDLE_RELOAD_ABORTED }, () => {});
    }
  } finally {
    await maintenance?.release();
  }
}

class BoxReloadError extends Error {
  constructor({ reason }: { reason: "exit-timeout" | "not-ready" }) {
    super(reason === "exit-timeout" ? "Old child did not exit after reload request" : "Replacement did not become ready; box remains closed for recovery");
    this.name = "BoxReloadError";
  }
}
