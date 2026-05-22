import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { CardLoader, type ElementNode } from "cardworks";
import { router, publicProcedure } from "../trpc.js";
import { parseNewsBrief, type NewsBrief } from "../../../schemas/news-brief.js";
import { parseNewsGuide, type NewsGuide } from "../../../schemas/news-guide.js";
import { parseGuide, type Guide } from "../../../schemas/guide.js";
import { createFeedbackTemplate } from "../../../schemas/feedback.js";
import { stageFiles, commit, getLog } from "../../../cli/lib/git.js";

interface BriefInfo {
  path: string;
  read: boolean;
  readReason?: "user" | "expired" | undefined;
}

async function findBriefs(boxRoot: string): Promise<BriefInfo[]> {
  const briefs: BriefInfo[] = [];

  const unreadDir = path.join(boxRoot, "box/output/briefs");
  try {
    const files = await fs.readdir(unreadDir);
    for (const file of files) {
      if (file.endsWith(".news-brief.card")) {
        briefs.push({ path: path.join(unreadDir, file), read: false });
      }
    }
  } catch { /* */ }

  const readDir = path.join(boxRoot, "store/archive/briefs");
  try {
    const files = await fs.readdir(readDir);
    for (const file of files) {
      if (file.endsWith(".news-brief.card")) {
        const fullPath = path.join(readDir, file);
        let readReason: "user" | "expired" | undefined;
        try {
          const loader = new CardLoader(boxRoot);
          const card = await loader.load(fullPath);
          readReason = card.element.attrs["read-reason"] as "user" | "expired" | undefined;
        } catch { /* */ }
        briefs.push({ path: fullPath, read: true, readReason });
      }
    }
  } catch { /* */ }

  // Legacy locations
  const legacyDirs = [
    { dir: path.join(boxRoot, "box/output/editions"), read: false },
    { dir: path.join(boxRoot, "box/inbox/editions"), read: false },
    { dir: path.join(boxRoot, "store/archive/editions"), read: true },
  ];
  for (const { dir, read } of legacyDirs) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith(".news-edition.card") || file.endsWith(".news-brief.card")) {
          briefs.push({ path: path.join(dir, file), read });
        }
      }
    } catch { /* */ }
  }

  briefs.sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    return path.basename(b.path).localeCompare(path.basename(a.path));
  });

  return briefs;
}

function briefNameFromPath(briefPath: string): string {
  const filename = path.basename(briefPath);
  const withoutExt = filename.replace(/\.news-(?:brief|edition)\.card$/, "");
  const withoutDate = withoutExt.replace(/^\d{4}-\d{2}-\d{2}_/, "");
  return withoutDate || filename;
}

async function getReadingSession(boxRoot: string, briefPath: string): Promise<{
  shouldAmend: boolean;
  actions: string[];
}> {
  try {
    const [lastCommit] = await getLog(boxRoot, 1);
    if (
      lastCommit?.trailers?.["Brief-Path"] === briefPath &&
      lastCommit?.trailers?.["Source"] === "webapp"
    ) {
      const actionsStr = lastCommit.trailers["Actions"] ?? "";
      const actions = actionsStr ? actionsStr.split(", ") : [];
      return { shouldAmend: true, actions };
    }
  } catch { /* */ }
  return { shouldAmend: false, actions: [] };
}

function updateElementFeedback(
  element: ElementNode,
  feedbackMap: Map<string, "thumbs-up" | "thumbs-down">
): void {
  const id = element.attrs?.id as string | undefined;
  if (id) {
    const feedback = feedbackMap.get(id);
    if (feedback) {
      element.attrs = element.attrs || {};
      element.attrs["user-feedback"] = feedback;
    }
  }
  if (element.children && Array.isArray(element.children)) {
    for (const child of element.children) {
      if (typeof child === "object" && child !== null && "tagName" in child) {
        updateElementFeedback(child as ElementNode, feedbackMap);
      }
    }
  }
}

export const briefsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const briefInfos = await findBriefs(ctx.boxRoot);
    const briefs = [];

    for (const info of briefInfos) {
      try {
        const loader = new CardLoader(ctx.boxRoot);
        const card = await loader.load(info.path);
        if (card.element.tagName !== "news-brief" && card.element.tagName !== "news-edition") continue;
        const parsed = parseNewsBrief(card.element as NewsBrief);
        briefs.push({
          path: info.path,
          relativePath: path.relative(ctx.boxRoot, info.path),
          title: parsed.title,
          date: parsed.date,
          byline: parsed.byline,
          read: info.read,
          readReason: info.readReason,
        });
      } catch { /* skip */ }
    }

    return { briefs };
  }),

  get: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const fullPath = path.join(ctx.boxRoot, input.path);
      try {
        const loader = new CardLoader(ctx.boxRoot);
        const card = await loader.load(fullPath);
        if (card.element.tagName !== "news-brief" && card.element.tagName !== "news-edition") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Not a brief: ${card.element.tagName}` });
        }
        const brief = parseNewsBrief(card.element as NewsBrief);
        return { brief };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const message = (err as Error).message;
        throw new TRPCError({
          code: message.includes("ENOENT") ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
          message: `Failed to load brief: ${message}`,
        });
      }
    }),

  markRead: publicProcedure
    .input(z.object({ briefPath: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const fullPath = path.join(ctx.boxRoot, input.briefPath);
      try {
        await fs.access(fullPath);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Brief not found" });
      }

      if (!input.briefPath.startsWith("box/output/briefs/") && !input.briefPath.startsWith("box/output/editions/")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Brief is not in unread location" });
      }

      const loader = new CardLoader(ctx.boxRoot);
      const card = await loader.load(fullPath);
      card.element.attrs["read-at"] = new Date().toISOString();
      card.element.attrs["read-reason"] = "user";
      await loader.save(card);

      const filename = path.basename(input.briefPath);
      const archiveDir = path.join(ctx.boxRoot, "store/archive/briefs");
      await fs.mkdir(archiveDir, { recursive: true });
      const newPath = path.join(archiveDir, filename);

      await fs.rename(fullPath, newPath);

      const newRelativePath = path.relative(ctx.boxRoot, newPath);
      await stageFiles(ctx.boxRoot, [input.briefPath, newRelativePath]);
      const name = briefNameFromPath(input.briefPath);
      await commit(ctx.boxRoot, {
        message: `Mark read: "${name}"`,
        trailers: { "Source": "webapp", "Endpoint": "/api/brief/mark-read" },
      });

      return { success: true, newPath: newRelativePath };
    }),

  feedback: publicProcedure
    .input(
      z.object({
        briefPath: z.string().min(1),
        targetId: z.string().min(1),
        comment: z.string().optional(),
        audioData: z.string().optional(),
        audioMimeType: z.string().optional(),
      }).refine((d) => d.comment || d.audioData, {
        message: "Either comment or audioData is required",
      })
    )
    .mutation(async ({ input, ctx }) => {
      const isVoice = !!input.audioData;
      const feedbackDir = path.join(ctx.boxRoot, "box/inbox/feedback");
      await fs.mkdir(feedbackDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[.:]/g, "-").slice(0, 19);
      const baseName = `brief_feedback_${timestamp}`;
      const feedbackPath = path.join(feedbackDir, `${baseName}.feedback.card`);

      if (isVoice && input.audioData) {
        const ext = input.audioMimeType?.includes("webm") ? ".webm" : ".m4a";
        const audioPath = path.join(feedbackDir, `${baseName}${ext}`);
        const audioBuffer = Buffer.from(input.audioData, "base64");
        await fs.writeFile(audioPath, audioBuffer);
      }

      const feedbackContent = createFeedbackTemplate({
        typeOfFeedback: "brief",
        targetRef: `${input.briefPath}#${input.targetId}`,
        source: isVoice ? "voice" : "text",
        ...(isVoice ? {} : { text: input.comment ?? "" }),
      });

      await fs.writeFile(feedbackPath, feedbackContent);

      const filesToStage = [path.relative(ctx.boxRoot, feedbackPath)];
      if (isVoice && input.audioData) {
        const ext = input.audioMimeType?.includes("webm") ? ".webm" : ".m4a";
        filesToStage.push(`box/inbox/feedback/${baseName}${ext}`);
      }
      await stageFiles(ctx.boxRoot, filesToStage);
      const name = briefNameFromPath(input.briefPath);
      const actionLabel = isVoice ? "voice comment" : "text comment";
      const session = await getReadingSession(ctx.boxRoot, input.briefPath);
      const actions = [...session.actions, actionLabel];
      await commit(ctx.boxRoot, {
        message: `Reading "${name}": ${actions.join(", ")}`,
        trailers: {
          "Source": "webapp",
          "Endpoint": "/api/brief/feedback",
          "Brief-Path": input.briefPath,
          "Actions": actions.join(", "),
        },
        amend: session.shouldAmend,
      });

      return { success: true, path: feedbackPath, isVoice };
    }),

  queryResponse: publicProcedure
    .input(
      z.object({
        briefPath: z.string().min(1),
        queryId: z.string().min(1),
        response: z.string().optional(),
        audioData: z.string().optional(),
        audioMimeType: z.string().optional(),
      }).refine((d) => d.response || d.audioData, {
        message: "Either response or audioData is required",
      })
    )
    .mutation(async ({ input, ctx }) => {
      const isVoice = !!input.audioData;
      const feedbackDir = path.join(ctx.boxRoot, "box/inbox/feedback");
      await fs.mkdir(feedbackDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[.:]/g, "-").slice(0, 19);
      const baseName = `query_response_${timestamp}`;
      const responsePath = path.join(feedbackDir, `${baseName}.feedback.card`);

      if (isVoice && input.audioData) {
        const ext = input.audioMimeType?.includes("webm") ? ".webm" : ".m4a";
        const audioPath = path.join(feedbackDir, `${baseName}${ext}`);
        const audioBuffer = Buffer.from(input.audioData, "base64");
        await fs.writeFile(audioPath, audioBuffer);
      }

      const responseContent = createFeedbackTemplate({
        typeOfFeedback: "query-response",
        targetRef: `${input.briefPath}#${input.queryId}`,
        source: isVoice ? "voice" : "text",
        ...(isVoice ? {} : { text: input.response ?? "" }),
      });

      await fs.writeFile(responsePath, responseContent);

      const filesToStage = [path.relative(ctx.boxRoot, responsePath)];
      if (isVoice && input.audioData) {
        const ext = input.audioMimeType?.includes("webm") ? ".webm" : ".m4a";
        filesToStage.push(`box/inbox/feedback/${baseName}${ext}`);
      }
      await stageFiles(ctx.boxRoot, filesToStage);
      const name = briefNameFromPath(input.briefPath);
      const session = await getReadingSession(ctx.boxRoot, input.briefPath);
      const actions = [...session.actions, "query response"];
      await commit(ctx.boxRoot, {
        message: `Reading "${name}": ${actions.join(", ")}`,
        trailers: {
          "Source": "webapp",
          "Endpoint": "/api/brief/query-response",
          "Brief-Path": input.briefPath,
          "Actions": actions.join(", "),
        },
        amend: session.shouldAmend,
      });

      return { success: true, path: responsePath, isVoice };
    }),

  guideReactions: publicProcedure.query(async ({ ctx }) => {
    const newGuidePath = path.join(ctx.boxRoot, "config/news.guide.card");
    const legacyGuidePath = path.join(ctx.boxRoot, "config/news-guide.news-guide.card");

    try {
      await fs.access(newGuidePath);
      const loader = new CardLoader(ctx.boxRoot);
      const card = await loader.load(newGuidePath);
      const parsed = parseGuide(card.element as Guide);
      return {
        reactions: parsed.reactions.map((r) => ({
          id: r.id,
          sentiment: r.sentiment as "positive" | "negative" | "neutral",
          text: r.text,
        })),
      };
    } catch { /* try legacy */ }

    try {
      await fs.access(legacyGuidePath);
      const loader = new CardLoader(ctx.boxRoot);
      const card = await loader.load(legacyGuidePath);
      const parsed = parseNewsGuide(card.element as NewsGuide);
      return {
        reactions: parsed.readerReactions.map((r) => ({
          id: r.id,
          sentiment: r.sentiment as "positive" | "negative" | "neutral",
          text: r.text,
        })),
      };
    } catch {
      return { reactions: [] as Array<{ id: string; sentiment: "positive" | "negative" | "neutral"; text: string }> };
    }
  }),

  completeReading: publicProcedure
    .input(
      z.object({
        briefPath: z.string().min(1),
        overallRating: z.enum(["great", "ok", "meh"]),
        selectedReactions: z.array(z.object({ id: z.string(), source: z.enum(["guide", "brief"]) })),
        itemFeedback: z.array(z.object({ id: z.string(), feedback: z.enum(["thumbs-up", "thumbs-down"]) })),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const fullPath = path.join(ctx.boxRoot, input.briefPath);

      try {
        await fs.access(fullPath);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Brief not found" });
      }

      if (!input.briefPath.startsWith("box/output/briefs/") && !input.briefPath.startsWith("box/output/editions/")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Brief is not in unread location" });
      }

      const loader = new CardLoader(ctx.boxRoot);
      const card = await loader.load(fullPath);

      card.element.attrs["overall-rating"] = input.overallRating;
      card.element.attrs["read-at"] = new Date().toISOString();
      card.element.attrs["read-reason"] = "user";

      if (input.selectedReactions.length > 0) {
        card.element.attrs["selected-reactions"] = input.selectedReactions.map((r) => r.id).join(",");
      }

      if (input.itemFeedback.length > 0) {
        const feedbackMap = new Map(input.itemFeedback.map((f) => [f.id, f.feedback]));
        updateElementFeedback(card.element, feedbackMap);
      }

      await loader.save(card);

      const filename = path.basename(input.briefPath);
      const archiveDir = path.join(ctx.boxRoot, "store/archive/briefs");
      await fs.mkdir(archiveDir, { recursive: true });
      const newPath = path.join(archiveDir, filename);

      const { result: moveResult } = await loader.move(card, newPath);

      const newRelativePath = path.relative(ctx.boxRoot, newPath);
      const filesToStage = [input.briefPath, newRelativePath];
      for (const updated of moveResult.updatedCards) {
        filesToStage.push(path.relative(ctx.boxRoot, updated.path));
      }
      for (const moved of moveResult.movedFiles) {
        if (moved.from !== fullPath) {
          filesToStage.push(path.relative(ctx.boxRoot, moved.from));
          filesToStage.push(path.relative(ctx.boxRoot, moved.to));
        }
      }
      await stageFiles(ctx.boxRoot, [input.briefPath, newRelativePath]);
      const name = briefNameFromPath(input.briefPath);
      const session = await getReadingSession(ctx.boxRoot, input.briefPath);
      const allActions = session.actions;

      const bodyLines: string[] = [];
      if (allActions.length > 0) {
        bodyLines.push(`- ${allActions.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join(", ")}`);
      }
      if (input.selectedReactions.length > 0) {
        bodyLines.push(`- Reactions: ${input.selectedReactions.map((r) => r.id).join(", ")}`);
      }
      const thumbsUp = input.itemFeedback.filter((f) => f.feedback === "thumbs-up").length;
      const thumbsDown = input.itemFeedback.filter((f) => f.feedback === "thumbs-down").length;
      const thumbsParts: string[] = [];
      if (thumbsUp > 0) thumbsParts.push(`${thumbsUp} thumbs-up`);
      if (thumbsDown > 0) thumbsParts.push(`${thumbsDown} thumbs-down`);
      if (thumbsParts.length > 0) bodyLines.push(`- ${thumbsParts.join(", ")}`);

      const subject = `Read "${name}" (${input.overallRating})`;
      const message = bodyLines.length > 0
        ? `${subject}\n\n${bodyLines.join("\n")}`
        : subject;

      await commit(ctx.boxRoot, {
        message,
        trailers: {
          "Source": "webapp",
          "Endpoint": "/api/brief/complete-reading",
          "Brief-Path": input.briefPath,
          "Actions": allActions.join(", ") || "none",
          "Rating": input.overallRating,
          "Reactions": input.selectedReactions.map((r) => r.id).join(", ") || "0",
          "Thumbs": String(input.itemFeedback.length),
        },
        amend: session.shouldAmend,
      });

      return { success: true, newPath: newRelativePath };
    }),
});
