/**
 * Filesystem abstraction interface for reading and writing card files.
 */
export interface FileSystem {
  /**
   * Read a text file at the given path.
   */
  read(path: string): Promise<string>;

  /**
   * Read a binary file at the given path.
   */
  readBinary(path: string): Promise<Uint8Array>;

  /**
   * Write content to a text file at the given path.
   */
  write(path: string, content: string): Promise<void>;

  /**
   * Check if a file exists at the given path.
   */
  exists(path: string): Promise<boolean>;

  /**
   * List immediate entries in a directory (files and subdirectories).
   */
  list(path: string): Promise<string[]>;

  /**
   * Find all files matching a glob pattern.
   * Pattern supports * (any chars) and ** (any path segments).
   * Returns absolute paths.
   *
   * @example
   * fs.glob("/project", "**\/*.card")  // all .card files
   * fs.glob("/project", "*.card")       // .card files in root only
   * fs.glob("/project", "cards/**\/*")   // all files under cards/
   */
  glob(basePath: string, pattern: string): Promise<string[]>;

  /**
   * Move/rename a file.
   */
  move(from: string, to: string): Promise<void>;

  /**
   * Resolve a relative path against a base path.
   */
  resolve(base: string, relative: string): string;
}
