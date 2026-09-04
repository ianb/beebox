import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";

const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TEMP_MAX_AGE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface CacheEntry {
  path: string;
  size: number;
  mtimeMs: number;
  temporary: boolean;
}

export function selectImageCacheEvictions(entries: CacheEntry[], now: number): string[] {
  const remove = new Set<string>();
  const retained: CacheEntry[] = [];
  for (const entry of entries) {
    const expired = now - entry.mtimeMs > (entry.temporary ? TEMP_MAX_AGE_MS : MAX_AGE_MS);
    if (expired) remove.add(entry.path);
    else if (!entry.temporary) retained.push(entry);
  }
  let total = retained.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of retained.toSorted((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= MAX_CACHE_BYTES) break;
    remove.add(entry.path);
    total -= entry.size;
  }
  return [...remove];
}

class PermitPool {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 2) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export class ImageTransformCache {
  private readonly root: string;
  private readonly permits = new PermitPool();
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  private lastSweep = 0;
  private sweepPromise: Promise<void> | null = null;

  constructor(boxRoot: string) {
    this.root = path.join(boxRoot, ".beebox", "image-cache", "v1");
  }

  async getOrCreate({ key, extension, generate }: {
    key: string;
    extension: string;
    generate: () => Promise<Buffer>;
  }): Promise<Buffer> {
    const target = path.join(this.root, `${key}.${extension}`);
    try {
      return await fs.readFile(target);
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
    }

    const existing = this.inFlight.get(target);
    if (existing !== undefined) return existing;
    const pending = this.permits.run(async () => {
      try {
        return await fs.readFile(target);
      } catch (error) {
        if (errnoCode(error) !== "ENOENT") throw error;
      }
      const content = await generate();
      await this.writeAtomic(target, content);
      await this.sweepIfDue();
      return content;
    });
    this.inFlight.set(target, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(target) === pending) this.inFlight.delete(target);
    }
  }

  private async writeAtomic(target: string, content: Buffer): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const temporary = `${target}.tmp-${String(process.pid)}-${randomBytes(6).toString("hex")}`;
    try {
      const handle = await fs.open(temporary, "wx");
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.unlink(temporary).catch((unlinkError: unknown) => {
        if (errnoCode(unlinkError) !== "ENOENT") console.warn(`[image-cache] could not remove ${temporary}:`, unlinkError);
      });
      throw error;
    }
  }

  private async sweepIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_INTERVAL_MS) return;
    if (this.sweepPromise !== null) return this.sweepPromise;
    const sweep = this.sweep(now);
    this.sweepPromise = sweep;
    try {
      await sweep;
      this.lastSweep = now;
    } catch (error) {
      console.warn(`[image-cache] could not sweep ${this.root}:`, error);
    } finally {
      if (this.sweepPromise === sweep) this.sweepPromise = null;
    }
  }

  private async sweep(now: number): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(this.root);
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return;
      throw error;
    }
    const entries = await Promise.all(names.map(async (name): Promise<CacheEntry | null> => {
      const candidate = path.join(this.root, name);
      try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) return null;
        return { path: candidate, size: stat.size, mtimeMs: stat.mtimeMs, temporary: name.includes(".tmp-") };
      } catch (error) {
        if (errnoCode(error) === "ENOENT") return null;
        throw error;
      }
    }));
    for (const candidate of selectImageCacheEvictions(entries.filter((entry): entry is CacheEntry => entry !== null), now)) {
      await fs.unlink(candidate).catch((error: unknown) => {
        if (errnoCode(error) !== "ENOENT") throw error;
      });
    }
  }
}
