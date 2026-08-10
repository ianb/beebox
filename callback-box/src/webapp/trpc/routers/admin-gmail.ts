/**
 * Admin procedures for `config/connectors/gmail.json` — the `query`/`labels`
 * shorthand only. Named `rules` are hand-edited; the mutation refuses to touch
 * a config that uses them rather than flattening them away.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  gmailActionInputSchema,
  parseGmailConnectorConfig,
} from "../../../connectors/gmail-config.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { errnoCode, errorMessage } from "../../../lib/error-guards.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import { ownerProcedure } from "../trpc.js";

/** Shape of `config/connectors/gmail.json`, validated on read. */
const gmailConfigSchema = z.object({
  query: z.string().default(""),
  labels: z.array(z.string()).default([]),
  action: gmailActionInputSchema.optional(),
  rules: z.array(z.unknown()).optional(),
  gc: z.boolean().optional(),
  gcIntervalHours: z.number().optional(),
});

type GmailConfigFile = z.infer<typeof gmailConfigSchema>;
type GmailAction = z.infer<typeof gmailActionInputSchema>;

async function readGmailConfigFile(configPath: string): Promise<GmailConfigFile> {
  try {
    return gmailConfigSchema.parse(JSON.parse(await fs.readFile(configPath, "utf-8")));
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") {
      console.debug("gmail.json missing or unreadable, returning empty Gmail config:", error);
    }
    return gmailConfigSchema.parse({});
  }
}

export const gmailAdminProcedures = {
  gmailConfig: ownerProcedure.query(async ({ ctx }) => {
    const config = await readGmailConfigFile(
      path.join(ctx.boxRoot, "config/connectors/gmail.json"),
    );
    return {
      query: config.query,
      labels: config.labels,
      action: config.action ?? null,
      usesRules: config.rules !== undefined,
    };
  }),

  updateGmailConfig: ownerProcedure
    .input(
      z.object({
        query: z.string(),
        labels: z.array(z.string()),
        action: gmailActionInputSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const configPath = path.join(ctx.boxRoot, "config/connectors/gmail.json");
      return withCardLock(configPath, async () => {
        const existing = await readGmailConfigFile(configPath);
        if (existing.rules !== undefined) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Named Gmail rules must be edited in config/connectors/gmail.json",
          });
        }
        const next: Record<string, unknown> = {};
        const trimmedQuery = input.query.trim();
        if (trimmedQuery) next.query = trimmedQuery;
        const cleanedLabels = input.labels.map((label) => label.trim()).filter(Boolean);
        if (cleanedLabels.length > 0) next.labels = cleanedLabels;
        // An action with nothing to match is itself a config error, so only
        // record one alongside a query or labels — the connector's own rule.
        const matches = trimmedQuery !== "" || cleanedLabels.length > 0;
        const action: GmailAction | null = matches ? input.action : null;
        if (action !== null) next.action = action;
        if (existing.gc !== undefined) next.gc = existing.gc;
        if (existing.gcIntervalHours !== undefined) {
          next.gcIntervalHours = existing.gcIntervalHours;
        }
        // Validate through the connector's own parser before writing: the admin
        // form must not be able to save a config the connector then rejects.
        try {
          parseGmailConnectorConfig(next);
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: errorMessage(error) });
        }
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(next, null, 2) + "\n");
        await stageAndCommitPaths(ctx.boxRoot, {
          paths: ["config/connectors/gmail.json"],
          message: "Update Gmail filter config",
        });
        return { query: trimmedQuery, labels: cleanedLabels, action };
      });
    }),
};
