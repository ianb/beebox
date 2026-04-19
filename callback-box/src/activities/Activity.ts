import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ActivityInstance } from "./ActivityInstance.js";
import type { ModeConstructor } from "./ActivityMode.js";
import type {
  ActivityMetadata,
  CreateInstanceCtx,
  InstanceSummary,
  ListInstancesCtx,
} from "./types.js";

export class ActivityInstanceExistsError extends Error {
  constructor(public readonly type: string, public readonly name: string) {
    super(`Activity instance already exists: ${type}/${name}`);
    this.name = "ActivityInstanceExistsError";
  }
}

export abstract class Activity {
  abstract readonly type: string;
  abstract readonly metadata: ActivityMetadata;
  abstract readonly modes: Record<string, ModeConstructor>;

  getInstance(root: string): ActivityInstance {
    return new ActivityInstance(root);
  }

  instanceRoot(boxRoot: string, instanceName: string): string {
    return join(boxRoot, "store/activities", this.type, instanceName);
  }

  async listInstances({ boxRoot }: ListInstancesCtx): Promise<InstanceSummary[]> {
    const dir = join(boxRoot, "store/activities", this.type);
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: "utf-8" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const summaries: InstanceSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      const metaPath = join(dir, entry.name, ".callback-box/instance.json");
      try {
        const raw = await readFile(metaPath, "utf-8");
        const meta = JSON.parse(raw) as { displayName: string; createdAt: string };
        summaries.push({
          name: entry.name,
          displayName: meta.displayName,
          createdAt: meta.createdAt,
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return summaries;
  }

  async createInstance({ boxRoot, name, displayName }: CreateInstanceCtx): Promise<void> {
    const root = this.instanceRoot(boxRoot, name);
    const existing = await stat(root).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (existing !== null) throw new ActivityInstanceExistsError(this.type, name);

    await mkdir(join(root, ".callback-box"), { recursive: true });
    const meta = {
      displayName,
      createdAt: new Date().toISOString(),
      type: this.type,
    };
    await writeFile(
      join(root, ".callback-box/instance.json"),
      JSON.stringify(meta, null, 2) + "\n",
    );

    await this.seedInstance(this.getInstance(root), { displayName });
  }

  /**
   * Override to seed activity-specific state files and an instance CLAUDE.md.
   * Called by createInstance after framework bookkeeping is written.
   */
  async seedInstance(_instance: ActivityInstance, _ctx: { displayName: string }): Promise<void> {
    // default no-op
  }
}
