import type { FileSystem } from "./types.js";

/**
 * In-memory filesystem implementation for testing.
 */
export class MemoryFileSystem implements FileSystem {
  private files = new Map<string, string>();
  private binaryFiles = new Map<string, Uint8Array>();

  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this.files.set(this.normalizePath(path), content);
      }
    }
  }

  private normalizePath(path: string): string {
    // Normalize path separators and remove leading/trailing slashes
    return path.replace(/\\/g, "/").replace(/\/+/g, "/");
  }

  read(path: string): Promise<string> {
    const normalized = this.normalizePath(path);
    const content = this.files.get(normalized);
    if (content === undefined) {
      return Promise.reject(new Error(`File not found: ${path}`));
    }
    return Promise.resolve(content);
  }

  readBinary(path: string): Promise<Uint8Array> {
    const normalized = this.normalizePath(path);
    const content = this.binaryFiles.get(normalized);
    if (content === undefined) {
      // Try to read as text and convert
      const textContent = this.files.get(normalized);
      if (textContent !== undefined) {
        return Promise.resolve(new TextEncoder().encode(textContent));
      }
      return Promise.reject(new Error(`File not found: ${path}`));
    }
    return Promise.resolve(content);
  }

  write(path: string, content: string): Promise<void> {
    const normalized = this.normalizePath(path);
    this.files.set(normalized, content);
    return Promise.resolve();
  }

  writeBinary(path: string, content: Uint8Array): Promise<void> {
    const normalized = this.normalizePath(path);
    this.binaryFiles.set(normalized, content);
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);
    return Promise.resolve(
      this.files.has(normalized) || this.binaryFiles.has(normalized)
    );
  }

  list(path: string): Promise<string[]> {
    const normalized = this.normalizePath(path);
    const prefix = normalized.endsWith("/") ? normalized : normalized + "/";
    const results: string[] = [];

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        const firstSegment = relative.split("/")[0];
        if (firstSegment && !results.includes(firstSegment)) {
          results.push(firstSegment);
        }
      }
    }

    return Promise.resolve(results);
  }

  glob(basePath: string, pattern: string): Promise<string[]> {
    const normalized = this.normalizePath(basePath);
    const prefix = normalized.endsWith("/") ? normalized : normalized + "/";
    const results: string[] = [];

    // Convert glob pattern to regex using placeholders to avoid interference
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

    // Check all files (text and binary)
    const allPaths = [...this.files.keys(), ...this.binaryFiles.keys()];

    for (const filePath of allPaths) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        if (regex.test(relative)) {
          results.push(filePath);
        }
      }
    }

    return Promise.resolve(results.sort());
  }

  move(from: string, to: string): Promise<void> {
    const normalizedFrom = this.normalizePath(from);
    const normalizedTo = this.normalizePath(to);

    // Check text files
    const textContent = this.files.get(normalizedFrom);
    if (textContent !== undefined) {
      this.files.delete(normalizedFrom);
      this.files.set(normalizedTo, textContent);
      return Promise.resolve();
    }

    // Check binary files
    const binaryContent = this.binaryFiles.get(normalizedFrom);
    if (binaryContent !== undefined) {
      this.binaryFiles.delete(normalizedFrom);
      this.binaryFiles.set(normalizedTo, binaryContent);
      return Promise.resolve();
    }

    return Promise.reject(new Error(`File not found: ${from}`));
  }

  resolve(base: string, relative: string): string {
    if (relative.startsWith("/")) {
      return relative;
    }

    const baseParts = base.split("/");
    baseParts.pop(); // Remove filename from base
    const relativeParts = relative.split("/");

    for (const part of relativeParts) {
      if (part === "..") {
        baseParts.pop();
      } else if (part !== ".") {
        baseParts.push(part);
      }
    }

    return baseParts.join("/");
  }

  /**
   * Set a file's content directly (useful for testing).
   */
  setFile(path: string, content: string): void {
    this.files.set(this.normalizePath(path), content);
  }

  /**
   * Clear all files.
   */
  clear(): void {
    this.files.clear();
    this.binaryFiles.clear();
  }
}
