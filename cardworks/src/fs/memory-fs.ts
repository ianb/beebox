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
