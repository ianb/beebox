/**
 * Capture Connector - Pulls completed capture sessions from the callback-dropbox API.
 *
 * Reuses the dropbox config (same Worker, same auth):
 *   config/connectors/dropbox.secret.json
 *
 * State stored in config/connectors/capture-state.json:
 *   { "pulledSessionIds": ["id1", "id2"] }
 *
 * Each session becomes a directory in box/inbox/ containing:
 *   - session.capture-session.card (the session card)
 *   - photo-NNN.image.card + photo-NNN.jpg (image cards + attachments)
 *   - audio-NNN.audio.card + audio-NNN.webm (audio cards + attachments)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  CaptureClient,
  type CaptureManifest,
  type CaptureFile,
} from "callback-dropbox/client";
import {
  registerConnector,
  type Connector,
  type PullResult,
  type ExecuteResult,
} from "./index.js";
import type { DropboxConfig } from "./dropbox.js";
import { createImageTemplate } from "../schemas/image.js";
import { createAudioTemplate } from "../schemas/audio.js";
import { createCaptureSessionTemplate } from "../schemas/capture-session.js";
import { stageFiles, commit } from "../cli/lib/git.js";

interface CaptureState {
  pulledSessionIds: string[];
}

class CaptureConnector implements Connector {
  name = "capture";
  handles: string[] = [];
  produces = ["capture-session", "image", "audio"];

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/dropbox.secret.json");
  }

  private statePath(): string {
    return path.join(this.boxRoot, "config/connectors/capture-state.json");
  }

  private async loadConfig(): Promise<DropboxConfig | null> {
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async loadState(): Promise<CaptureState> {
    try {
      const content = await fs.readFile(this.statePath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return { pulledSessionIds: [] };
    }
  }

  private async saveState(state: CaptureState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath()), { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2));
  }

  async pull(): Promise<PullResult> {
    const config = await this.loadConfig();
    if (!config) {
      return { success: true, created: [], updated: [] };
    }

    const client = new CaptureClient({
      url: config.workerUrl,
      apiKey: config.apiKey,
    });

    const state = await this.loadState();
    const pulledSet = new Set(state.pulledSessionIds);
    const created: string[] = [];
    const errors: string[] = [];

    try {
      const sessions = await client.listSessions({ status: "completed" });
      const newSessions = sessions.filter((s) => !pulledSet.has(s.id));

      if (newSessions.length === 0) {
        return { success: true, created: [], updated: [] };
      }

      for (const session of newSessions) {
        try {
          const manifest = await client.getManifest(session.id);
          const sessionCreated = await this.pullSession(client, manifest);
          created.push(...sessionCreated);
          pulledSet.add(session.id);
        } catch (err) {
          errors.push(`Failed to pull session ${session.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      errors.push(`List sessions failed: ${(err as Error).message}`);
    }

    // Save updated state
    state.pulledSessionIds = Array.from(pulledSet);
    await this.saveState(state);

    if (created.length > 0) {
      // Stage all created files (cards + media + state file)
      const toStage = [
        ...created,
        path.relative(this.boxRoot, this.statePath()),
      ];
      await stageFiles(this.boxRoot, toStage);
      await commit(this.boxRoot, {
        message: `Pull ${newSessionCount(created)} capture session(s)`,
        trailers: {
          "Pulled-By": "capture-connector",
        },
      });
    }

    const result: PullResult = {
      success: errors.length === 0,
      created,
      updated: [],
    };
    if (errors.length > 0) {
      result.error = errors.join("; ");
    }
    return result;
  }

  private async pullSession(
    client: CaptureClient,
    manifest: CaptureManifest
  ): Promise<string[]> {
    // Format: capture-YYYYMMDDTHHMM-shortid
    const startDate = new Date(manifest.startedAt);
    const datePart = startDate.toISOString().replace(/[-:]/g, "").slice(0, 13); // 20260211T1951
    const shortId = manifest.sessionId.slice(0, 8);
    const dirName = `capture-${datePart}-${shortId}`;
    const dirPath = path.join(this.boxRoot, "box/inbox", dirName);
    await fs.mkdir(dirPath, { recursive: true });

    const created: string[] = [];
    const imageRefs: string[] = [];
    const audioRefs: string[] = [];

    // Sort files by name for consistent ordering
    const sortedFiles = [...manifest.files].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const file of sortedFiles) {
      // Download the media file
      const data = await client.downloadFile(manifest.sessionId, file.name);
      const mediaPath = path.join(dirPath, file.name);
      await fs.writeFile(mediaPath, Buffer.from(data));
      created.push(path.relative(this.boxRoot, mediaPath));

      // Create the corresponding card
      const baseName = path.parse(file.name).name; // e.g. "photo-001"

      if (file.type.startsWith("image/")) {
        const cardName = `${baseName}.image.card`;
        const cardPath = path.join(dirPath, cardName);
        const cardContent = createImageTemplate({
          capturedAt: file.startedAt,
          source: file.source,
          filename: file.name,
        });
        await fs.writeFile(cardPath, cardContent);
        created.push(path.relative(this.boxRoot, cardPath));
        imageRefs.push(cardName);
      } else if (file.type.startsWith("audio/")) {
        const cardName = `${baseName}.audio.card`;
        const cardPath = path.join(dirPath, cardName);
        const cardContent = createAudioTemplate({
          recordedAt: file.startedAt,
          source: file.source,
          filename: file.name,
        });
        await fs.writeFile(cardPath, cardContent);
        created.push(path.relative(this.boxRoot, cardPath));
        audioRefs.push(cardName);
      }
    }

    // Create the session card
    const sessionCardPath = path.join(dirPath, "session.capture-session.card");
    const sessionContent = createCaptureSessionTemplate({
      sessionId: manifest.sessionId,
      startedAt: manifest.startedAt,
      endedAt: manifest.endedAt,
      imageRefs,
      audioRefs,
    });
    await fs.writeFile(sessionCardPath, sessionContent);
    created.push(path.relative(this.boxRoot, sessionCardPath));

    return created;
  }

  async execute(_cardPath: string, _dryRun: boolean): Promise<ExecuteResult> {
    return { success: false, error: "Capture connector does not handle commands" };
  }
}

/**
 * Count how many session directories were created from a list of relative paths.
 */
function newSessionCount(created: string[]): number {
  const dirs = new Set<string>();
  for (const p of created) {
    const parts = p.split(path.sep);
    // box/inbox/capture-xxx/... → the capture-xxx part
    if (parts.length >= 3) {
      dirs.add(parts.slice(0, 3).join(path.sep));
    }
  }
  return dirs.size;
}

/**
 * Create and register the Capture connector for a box.
 */
export function createCaptureConnector(boxRoot: string): Connector {
  const connector = new CaptureConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
