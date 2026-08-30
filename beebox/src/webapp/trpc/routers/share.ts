import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { parseFrontmatterObject, splitCardContent } from "../../../cards/index.js";
import { listRecentLandmarkChats } from "../../../core/chat/session/recent-landmark.js";
import { listDestinations } from "../../../core/landmark/list-destinations.js";
import { listBoxCardFiles } from "../../../core/list-cards.js";
import { parseCardText } from "../../../core/card-io.js";
import { safeFilename } from "../../../connectors/chat-utils.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { createDocTemplate } from "../../../schemas/doc.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { createWebpageTemplate } from "../../../schemas/webpage.js";
import { router, authedProcedure } from "../trpc.js";
import { saveTextualInput, saveTextualOutput, shareDestinationsOutput } from "./share-contract.js";

const INBOX_DIR = "box/inbox";

export const shareRouter = router({
  destinations: authedProcedure.output(shareDestinationsOutput).query(async ({ ctx }) => {
    const [chats, landmarks] = await Promise.all([
      listRecentLandmarkChats(ctx.boxRoot),
      listDestinations(ctx.boxRoot, "share"),
    ]);
    return {
      chats,
      saves: [
        { destination: { kind: "inbox" as const }, label: "Inbox", symbol: null },
        ...landmarks.map((landmark) => ({
          destination: { kind: "landmark" as const, dir: landmark.dir },
          label: landmark.label,
          symbol: landmark.symbol,
        })),
      ],
    };
  }),

  saveTextual: authedProcedure
    .input(saveTextualInput)
    .output(saveTextualOutput)
    .mutation(async ({ ctx, input }) => {
      const destinationDir = await resolveSaveDirectory(ctx.boxRoot, input.destination);
      const title = titleForShare(input);
      const extension = input.kind === "url" ? "webpage" : "doc";
      const filename = `${safeFilename(title, input.kind === "url" ? "Page" : "Shared text")}_${input.shareId}`;
      const cardRel = path.join(destinationDir, `${filename}.${extension}.card`);
      const absPath = path.join(ctx.boxRoot, cardRel);
      const cardText = input.kind === "url"
        ? createWebpageTemplate({
            title,
            source: input.url,
            capturedAt: input.capturedAt,
            content: `[${title}](${input.url})`,
            shareId: input.shareId,
          })
        : createDocTemplate({ title, body: input.text, shareId: input.shareId });

      return withCardLock(absPath, async () => {
        const existing = await findShareCard(ctx.boxRoot, input.shareId);
        if (existing !== null) {
          if (!existing.relPath.endsWith(`.${extension}.card`) || existing.content !== cardText) {
            throw new TRPCError({ code: "CONFLICT", message: "Share ID already belongs to different content" });
          }
          return { created: [existing.relPath] };
        }

        const schemas = await createCardSchemaMap(ctx.boxRoot);
        parseCardText(cardText, { source: absPath, schemas });
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, cardText, "utf-8");
        await stageAndCommitPaths(ctx.boxRoot, {
          paths: [cardRel],
          message: `Save shared ${input.kind}: "${title}"`,
          trailers: { "Created-By": "ios-share-extension" },
        });
        return { created: [cardRel] };
      });
    }),
});

async function resolveSaveDirectory(
  boxRoot: string,
  destination: { kind: "inbox" } | { kind: "landmark"; dir: string },
): Promise<string> {
  if (destination.kind === "inbox") return INBOX_DIR;
  const destinations = await listDestinations(boxRoot, "share");
  if (!destinations.some((candidate) => candidate.dir === destination.dir)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown share destination: ${destination.dir}` });
  }
  return destination.dir;
}

function titleForShare(input: { kind: "url"; title?: string | undefined; url: string } | { kind: "text"; title?: string | undefined; text: string }): string {
  const supplied = input.title?.trim();
  if (supplied !== undefined && supplied !== "") return supplied;
  if (input.kind === "url") return input.url;
  const firstLine = input.text.split(/\r?\n/u).find((line) => line.trim() !== "")?.trim() ?? "Shared text";
  return firstLine.slice(0, 120);
}

async function findShareCard(boxRoot: string, shareId: string): Promise<{ relPath: string; content: string } | null> {
  const matches: Array<{ relPath: string; content: string }> = [];
  for (const absPath of await listBoxCardFiles(boxRoot)) {
    const content = await fs.readFile(absPath, "utf-8");
    const fields = parseFrontmatterObject(content);
    if (fields?.["share-id"] !== shareId) continue;
    // Force a frontmatter/body parse here so malformed hand edits cannot be
    // mistaken for a safe idempotent replay.
    splitCardContent(content);
    matches.push({ relPath: path.relative(boxRoot, absPath), content });
  }
  if (matches.length > 1) {
    throw new TRPCError({ code: "CONFLICT", message: "Share ID appears on more than one card" });
  }
  return matches[0] ?? null;
}
