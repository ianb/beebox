/**
 * Pairing routes for the webapp.
 *
 * Drives the dropbox pairing flow from the frontend settings page.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createChannel, generatePairingCode } from "callback-dropbox/client";
import type { DropboxConfig } from "../../connectors/dropbox.js";

function configPath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/dropbox.secret.json");
}

async function loadConfig(boxRoot: string): Promise<DropboxConfig | null> {
  try {
    const content = await fs.readFile(configPath(boxRoot), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveConfig(boxRoot: string, config: DropboxConfig): Promise<void> {
  const dir = path.dirname(configPath(boxRoot));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath(boxRoot), JSON.stringify(config, null, 2));
}

interface PairBody {
  workerUrl: string;
}

export async function registerPairingRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<void> {
  // GET /api/dropbox/status
  server.get("/api/dropbox/status", async () => {
    const config = await loadConfig(boxRoot);
    if (!config) {
      return { paired: false };
    }

    return {
      paired: true,
      workerUrl: config.workerUrl,
      channelId: config.channelId,
    };
  });

  // POST /api/dropbox/pair
  server.post<{ Body: PairBody }>("/api/dropbox/pair", async (request, reply) => {
    const { workerUrl } = request.body ?? {};
    if (!workerUrl) {
      return reply.status(400).send({ error: "workerUrl is required" });
    }

    const normalizedUrl = workerUrl.replace(/\/$/, "");

    try {
      const { channelId, apiKey, channelKey } = await createChannel(normalizedUrl);
      const { code, expiresAt } = await generatePairingCode(
        normalizedUrl,
        apiKey,
        channelId,
        channelKey
      );

      const config: DropboxConfig = {
        workerUrl: normalizedUrl,
        channelId,
        apiKey,
        channelKey,
      };
      await saveConfig(boxRoot, config);

      return { code, expiresAt };
    } catch (err) {
      return reply.status(500).send({
        error: `Pairing failed: ${(err as Error).message}`,
      });
    }
  });
}
