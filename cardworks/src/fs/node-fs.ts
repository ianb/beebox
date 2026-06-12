import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FileSystem } from "./types.js";
import { GLOB_SKIP_DIRS } from "./glob-skip.js";

/**
 * Context for a recursive directory walk, invariant across the recursion.
 */
interface WalkDirOptions {
  basePath: string;
  pattern: RegExp;
  results: string[];
}

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
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`exists: access failed for ${filePath}`, e);
      }
      return false;
    }
  }

  async list(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`list: readdir failed for ${dirPath}`, e);
      }
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
    regexPattern = regexPattern.replace(/[$()+.[\\\]^{|}]/g, "\\$&");

    // Replace placeholders with regex equivalents
    regexPattern = regexPattern.replace(/<<GLOBSTARSLASH>>/g, "(.*/)?");
    regexPattern = regexPattern.replace(/<<GLOBSTAR>>/g, ".*");
    regexPattern = regexPattern.replace(/<<STAR>>/g, "[^/]*");
    regexPattern = regexPattern.replace(/<<QUESTION>>/g, "[^/]");

    // regexPattern is derived solely from the glob `pattern` via the controlled
    // placeholder substitutions above, with all regex-special chars escaped, so
    // it cannot inject arbitrary regex syntax.
    // eslint-disable-next-line security/detect-non-literal-regexp
    const regex = new RegExp(`^${regexPattern}$`);

    // Recursively walk the directory
    await this.walkDir(basePath, { basePath, pattern: regex, results });

    return results.toSorted();
  }

  private async walkDir(
    currentPath: string,
    { basePath, pattern, results }: WalkDirOptions
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(currentPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`walkDir: readdir failed for ${currentPath}`, e);
      }
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry);
      const relativePath = path.relative(basePath, fullPath);

      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          if (!GLOB_SKIP_DIRS.has(entry)) {
            await this.walkDir(fullPath, { basePath, pattern, results });
          }
        } else if (stat.isFile()) {
          if (pattern.test(relativePath)) {
            results.push(fullPath);
          }
        }
      } catch (e) {
        // Skip files we can't stat; a vanished/inaccessible entry is expected.
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`walkDir: stat failed for ${fullPath}`, e);
        }
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
