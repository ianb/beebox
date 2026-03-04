import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import type { DropboxConfig } from "../../../connectors/dropbox.js";

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

export const pairingRouter = router({
  status: publicProcedure.query(async ({ ctx }) => {
    const config = await loadConfig(ctx.boxRoot);
    if (!config) {
      return { paired: false as const };
    }
    return {
      paired: true as const,
      workerUrl: config.workerUrl,
      channelId: config.channelId,
    };
  }),

  pair: publicProcedure
    .input(z.object({ workerUrl: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      const normalizedUrl = input.workerUrl.replace(/\/$/, "");
      const relay = ctx.services.dropboxRelay;
      if (!relay) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "DropboxRelayService not available",
        });
      }

      try {
        const { channelId, apiKey, channelKey } = await relay.createChannel(normalizedUrl);
        const { code, expiresAt } = await relay.generatePairingCode({
          workerUrl: normalizedUrl,
          apiKey,
          channelId,
          channelKey,
        });

        const config: DropboxConfig = {
          workerUrl: normalizedUrl,
          channelId,
          apiKey,
          channelKey,
        };
        await saveConfig(ctx.boxRoot, config);

        return { code, expiresAt };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Pairing failed: ${(err as Error).message}`,
        });
      }
    }),
});
