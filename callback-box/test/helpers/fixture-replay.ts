/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Fixture replay library for integration tests.
 *
 * Supports two modes:
 * - **Replay** (default): loads saved API responses from fixture files
 * - **Record** (CB_REGENERATE_FIXTURES=1): makes real API calls, saves responses
 *
 * Usage:
 *   const replay = await createFixtureReplay({
 *     fixtureDir: "test/fixtures/my-test",
 *     outputDir: "test/fixtures/my-test-outputs",
 *   });
 *
 *   // Record or load a fixture
 *   const result = await replay.recordOrReplay("transcription", async () => {
 *     return await realApiCall();
 *   });
 *
 *   // Check mode
 *   replay.isRecording // true if CB_REGENERATE_FIXTURES=1
 */

import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { makeTmpBox, type TmpBox } from "./doctest-helpers.js";

export interface FixtureReplayOptions {
  /** Directory containing input fixtures (e.g., capture session files). */
  fixtureDir: string;
  /** Directory for saved API responses (recorded outputs). */
  outputDir: string;
}

export interface FixtureReplay {
  /** Whether we're recording (true) or replaying (false). */
  isRecording: boolean;

  /**
   * Load or generate a fixture. In replay mode, loads from outputDir.
   * In record mode, calls the producer, saves the result, and returns it.
   */
  recordOrReplay<T>(name: string, producer: () => Promise<T>): Promise<T>;

  /**
   * Create a TmpBox populated with the input fixture files.
   * Copies the fixture directory into box/inbox/ and initializes git.
   */
  createBox(): Promise<TmpBox>;

  /**
   * Check if a saved fixture exists.
   */
  hasFixture(name: string): Promise<boolean>;
}

/**
 * Resolve a path relative to the callback-box project root.
 */
function projectPath(relativePath: string): string {
  return resolve(join(dirname(new URL(import.meta.url).pathname), "../.."), relativePath);
}

export async function createFixtureReplay(options: FixtureReplayOptions): Promise<FixtureReplay> {
  const fixtureDir = projectPath(options.fixtureDir);
  const outputDir = projectPath(options.outputDir);
  const isRecording = process.env["CB_REGENERATE_FIXTURES"] === "1";

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  return {
    isRecording,

    async recordOrReplay<T>(name: string, producer: () => Promise<T>): Promise<T> {
      const fixturePath = join(outputDir, `${name}.json`);

      if (isRecording) {
        const result = await producer();
        await writeFile(fixturePath, JSON.stringify(result, null, 2) + "\n");
        return result;
      }

      // Replay mode — load from file
      const content = await readFile(fixturePath, "utf-8");
      return JSON.parse(content) as T;
    },

    async createBox(): Promise<TmpBox> {
      const box = await makeTmpBox({ git: true });

      // Copy fixture files into box/inbox/
      await mkdir(join(box.root, "box/inbox"), { recursive: true });
      await cp(fixtureDir, join(box.root, "box/inbox"), { recursive: true });

      // Initialize with a commit
      box.commitAll("Capture session fixture");

      return box;
    },

    async hasFixture(name: string): Promise<boolean> {
      try {
        await readFile(join(outputDir, `${name}.json`), "utf-8");
        return true;
      } catch {
        return false;
      }
    },
  };
}
