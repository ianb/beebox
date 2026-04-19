import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export class ActivityInstance {
  constructor(public readonly root: string) {}

  get name(): string {
    return basename(this.root);
  }

  private full(relativePath: string): string {
    return join(this.root, relativePath);
  }

  async readJson<T>(relativePath: string): Promise<T> {
    const raw = await readFile(this.full(relativePath), "utf-8");
    return JSON.parse(raw) as T;
  }

  async writeJson(relativePath: string, value: unknown): Promise<void> {
    const full = this.full(relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(value, null, 2) + "\n");
  }

  async readJsonl<T>(relativePath: string): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(this.full(relativePath), "utf-8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  }

  async appendJsonl(relativePath: string, entry: unknown): Promise<void> {
    const full = this.full(relativePath);
    await mkdir(dirname(full), { recursive: true });
    await appendFile(full, JSON.stringify(entry) + "\n");
  }

  async readText(relativePath: string): Promise<string> {
    return readFile(this.full(relativePath), "utf-8");
  }

  async writeText(relativePath: string, content: string): Promise<void> {
    const full = this.full(relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}
