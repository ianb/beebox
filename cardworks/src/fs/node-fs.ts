import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FileSystem } from "./types.js";

/**
 * Node.js filesystem implementation.
 */
export class NodeFileSystem implements FileSystem {
  async read(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf-8");
  }

  async readBinary(filePath: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(filePath);
    return new Uint8Array(buffer);
  }

  async write(filePath: string, content: string): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async list(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch {
      return [];
    }
  }

  resolve(base: string, relative: string): string {
    if (path.isAbsolute(relative)) {
      return relative;
    }
    const baseDir = path.dirname(base);
    return path.resolve(baseDir, relative);
  }
}
