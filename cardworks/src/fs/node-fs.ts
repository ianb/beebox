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

  async glob(basePath: string, pattern: string): Promise<string[]> {
    const results: string[] = [];

    // Convert glob pattern to regex using placeholders
    let regexPattern = pattern;

    // First, protect ** and * with placeholders (using unlikely strings)
    regexPattern = regexPattern.replace(/\*\*\//g, "<<GLOBSTARSLASH>>");
    regexPattern = regexPattern.replace(/\*\*/g, "<<GLOBSTAR>>");
    regexPattern = regexPattern.replace(/\*/g, "<<STAR>>");
    regexPattern = regexPattern.replace(/\?/g, "<<QUESTION>>");

    // Escape regex special chars
    regexPattern = regexPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");

    // Replace placeholders with regex equivalents
    regexPattern = regexPattern.replace(/<<GLOBSTARSLASH>>/g, "(.*/)?");
    regexPattern = regexPattern.replace(/<<GLOBSTAR>>/g, ".*");
    regexPattern = regexPattern.replace(/<<STAR>>/g, "[^/]*");
    regexPattern = regexPattern.replace(/<<QUESTION>>/g, "[^/]");

    const regex = new RegExp(`^${regexPattern}$`);

    // Recursively walk the directory
    await this.walkDir(basePath, basePath, regex, results);

    return results.sort();
  }

  private async walkDir(
    basePath: string,
    currentPath: string,
    pattern: RegExp,
    results: string[]
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry);
      const relativePath = path.relative(basePath, fullPath);

      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await this.walkDir(basePath, fullPath, pattern, results);
        } else if (stat.isFile()) {
          if (pattern.test(relativePath)) {
            results.push(fullPath);
          }
        }
      } catch {
        // Skip files we can't stat
      }
    }
  }

  async move(from: string, to: string): Promise<void> {
    // Ensure target directory exists
    const dir = path.dirname(to);
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(from, to);
  }

  resolve(base: string, relative: string): string {
    if (path.isAbsolute(relative)) {
      return relative;
    }
    const baseDir = path.dirname(base);
    return path.resolve(baseDir, relative);
  }

  async stat(filePath: string): Promise<{ mtime: Date; size: number }> {
    const stats = await fs.stat(filePath);
    return {
      mtime: stats.mtime,
      size: stats.size,
    };
  }
}
