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
} from "callback-dropbox/client";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import type { DropboxConfig } from "./dropbox.js";
import { createImageTemplate } from "../schemas/image.js";
import { createAudioTemplate } from "../schemas/audio.js";
import { createCaptureSessionTemplate } from "../schemas/capture-session.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { createOrAppendIntakeJob } from "./intake-utils.js";

interface CaptureState {
  pulledSessionIds: string[];
}

interface CaptureConfig {
  /** All credentials we've ever used, keyed by channelId */
  channels: Record<string, { workerUrl: string; apiKey: string }>;
}

class CaptureConnector implements Connector {
  name = "capture";
  produces = ["capture-session", "image", "audio"];
  triggeredBy?: string;

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  private captureConfigPath(): string {
    return path.join(this.boxRoot, "config/connectors/capture.secret.json");
  }

  private dropboxConfigPath(): string {
    return path.join(this.boxRoot, "config/connectors/dropbox.secret.json");
  }

  private statePath(): string {
    return path.join(this.boxRoot, "config/connectors/capture-state.json");
  }

  /**
   * Load capture config, merging in the current dropbox credentials.
   * This ensures we accumulate all channels we've ever paired with,
   * so re-pairing doesn't orphan sessions on old channels.
   */
  private async loadConfig(): Promise<DropboxConfig | null> {
    // Load the current dropbox config (primary credentials)
    let dropboxConfig: DropboxConfig | null = null;
    try {
      const content = await fs.readFile(this.dropboxConfigPath(), "utf-8");
      dropboxConfig = JSON.parse(content);
    } catch {
      // No dropbox config
    }

    if (!dropboxConfig) return null;

    // Load existing capture config (accumulated channels)
    let captureConfig: CaptureConfig = { channels: {} };
    try {
      const content = await fs.readFile(this.captureConfigPath(), "utf-8");
      captureConfig = JSON.parse(content);
    } catch {
      // First time — will be created
    }

    // Add current dropbox channel to capture config if not already there
    if (dropboxConfig.channelId && !captureConfig.channels[dropboxConfig.channelId]) {
      captureConfig.channels[dropboxConfig.channelId] = {
        workerUrl: dropboxConfig.workerUrl,
        apiKey: dropboxConfig.apiKey,
      };
      await this.saveCaptureConfig(captureConfig);
    }

    // Return the current dropbox config for primary use
    return dropboxConfig;
  }

  /**
   * Get all known channel credentials for pulling sessions.
   */
  private async getAllChannelCredentials(): Promise<Array<{ workerUrl: string; apiKey: string }>> {
    let captureConfig: CaptureConfig = { channels: {} };
    try {
      const content = await fs.readFile(this.captureConfigPath(), "utf-8");
      captureConfig = JSON.parse(content);
    } catch {
      // No capture config yet
    }
    return Object.values(captureConfig.channels);
  }

  private async saveCaptureConfig(config: CaptureConfig): Promise<void> {
    const dir = path.dirname(this.captureConfigPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.captureConfigPath(), JSON.stringify(config, null, 2));
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

  async sync(): Promise<SyncResult> {
    // Ensure current dropbox credentials are registered
    const config = await this.loadConfig();
    if (!config) {
      return { success: true, created: [], updated: [] };
    }

    const state = await this.loadState();
    const pulledSet = new Set(state.pulledSessionIds);
    const created: string[] = [];
    const errors: string[] = [];
    const sessionNotes: SessionNote[] = [];

    // Check all known channels for completed sessions
    const allCredentials = await this.getAllChannelCredentials();

    for (const creds of allCredentials) {
      const client = new CaptureClient({
        url: creds.workerUrl,
        apiKey: creds.apiKey,
      });

      try {
        const sessions = await client.listSessions({ status: "completed" });
        const newSessions = sessions.filter((s) => !pulledSet.has(s.id));

        for (const session of newSessions) {
          try {
            const manifest = await client.getManifest(session.id);
            const sessionCreated = await this.pullSession(client, manifest);
            created.push(...sessionCreated);
            pulledSet.add(session.id);

            // Accumulate session note
            const photoCount = manifest.files.filter((f) => f.type.startsWith("image/")).length;
            const hasRecording = manifest.files.some((f) => f.type.startsWith("audio/"));
            sessionNotes.push({ startedAt: manifest.startedAt, photoCount, hasRecording });
          } catch (err) {
            errors.push(`Failed to pull session ${session.id}: ${(err as Error).message}`);
          }
        }
      } catch {
        // Channel may have been revoked — skip silently
      }
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
        message: buildCaptureCommitMessage(sessionNotes),
        trailers: {
          "Pulled-By": "capture-connector",
          ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
        },
      });
    }

    // Create intake job for new capture sessions
    const jobs: string[] = [];
    if (created.length > 0) {
      const sessionCards = created.filter((p) => p.endsWith(".capture-session.card"));
      if (sessionCards.length > 0) {
        const jobPath = await createOrAppendIntakeJob({
          boxRoot: this.boxRoot,
          source: "capture-connector",
          items: sessionCards,
          priority: "low",
          description: `Triage ${sessionCards.length} capture session${sessionCards.length === 1 ? "" : "s"}`,
        });
        jobs.push(jobPath);
        await stageFiles(this.boxRoot, [jobPath]);
        await commit(this.boxRoot, {
          message: "Create intake job for capture sessions",
          trailers: { "Created-By": "capture-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
        });
      }
    }

    const result: SyncResult = {
      success: errors.length === 0,
      created,
      updated: [],
    };
    if (jobs.length > 0) result.jobs = jobs;
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
    const datePart = startDate.toISOString().replace(/[:-]/g, "").slice(0, 13); // 20260211T1951
    const shortId = manifest.sessionId.slice(0, 8);
    const dirName = `capture-${datePart}-${shortId}`;
    const dirPath = path.join(this.boxRoot, "box/inbox", dirName);
    await fs.mkdir(dirPath, { recursive: true });

    const created: string[] = [];
    const imageRefs: string[] = [];
    const audioRefs: string[] = [];

    // Sort files by name for consistent ordering
    const sortedFiles = [...manifest.files].toSorted((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Separate audio and non-audio files
    const audioFiles = sortedFiles.filter((f) => f.type.startsWith("audio/"));
    const nonAudioFiles = sortedFiles.filter((f) => !f.type.startsWith("audio/"));

    // Process non-audio files individually
    for (const file of nonAudioFiles) {
      const data = await client.downloadFile(manifest.sessionId, file.name);
      const mediaPath = path.join(dirPath, file.name);
      await fs.writeFile(mediaPath, Buffer.from(data));
      created.push(path.relative(this.boxRoot, mediaPath));

      const baseName = path.parse(file.name).name;

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
      }
    }

    // Concatenate audio chunks into a single file
    // MediaRecorder timeslice mode produces chunks where only the first has
    // the WebM header; subsequent chunks are raw Cluster data. Concatenating
    // them produces a valid WebM file.
    if (audioFiles.length > 0) {
      const firstAudio = audioFiles[0]!;
      const ext = path.extname(firstAudio.name) || ".webm";
      const combinedName = `recording${ext}`;
      const chunks: Buffer[] = [];

      for (const file of audioFiles) {
        const data = await client.downloadFile(manifest.sessionId, file.name);
        chunks.push(Buffer.from(data));
      }

      const combinedBuffer = Buffer.concat(chunks);
      const mediaPath = path.join(dirPath, combinedName);
      await fs.writeFile(mediaPath, combinedBuffer);
      created.push(path.relative(this.boxRoot, mediaPath));

      const cardName = "recording.audio.card";
      const cardPath = path.join(dirPath, cardName);
      const cardContent = createAudioTemplate({
        recordedAt: firstAudio.startedAt,
        source: firstAudio.source,
        filename: combinedName,
      });
      await fs.writeFile(cardPath, cardContent);
      created.push(path.relative(this.boxRoot, cardPath));
      audioRefs.push(cardName);
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

}

interface SessionNote {
  startedAt: string;
  photoCount: number;
  hasRecording: boolean;
}

function buildCaptureCommitMessage(notes: SessionNote[]): string {
  const totalPhotos = notes.reduce((sum, n) => sum + n.photoCount, 0);
  const totalRecordings = notes.filter((n) => n.hasRecording).length;

  const parts: string[] = [];
  if (totalPhotos > 0) parts.push(`${totalPhotos} photo${totalPhotos === 1 ? "" : "s"}`);
  if (totalRecordings > 0) parts.push(`${totalRecordings} recording${totalRecordings === 1 ? "" : "s"}`);
  const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";

  const subject = `Pull ${notes.length} capture session${notes.length === 1 ? "" : "s"}${detail}`;

  if (notes.length <= 1) return subject;

  const lines = [subject, ""];
  for (const note of notes) {
    const d = new Date(note.startedAt);
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const sessionParts: string[] = [];
    if (note.photoCount > 0) sessionParts.push(`${note.photoCount} photo${note.photoCount === 1 ? "" : "s"}`);
    if (note.hasRecording) sessionParts.push("recording");
    lines.push(`- ${dateStr}, ${timeStr}: ${sessionParts.join(", ") || "empty session"}`);
  }
  return lines.join("\n");
}

/**
 * Create and register the Capture connector for a box.
 */
export function createCaptureConnector(boxRoot: string): Connector {
  const connector = new CaptureConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
