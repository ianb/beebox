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
   * List files in a directory.
   */
  list(path: string): Promise<string[]>;

  /**
   * Resolve a relative path against a base path.
   */
  resolve(base: string, relative: string): string;
}
