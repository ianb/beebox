import { z } from "zod";

export const actionVerbSchema = z.enum([
  "archive",
  "close",
  "confirm-tested",
  "focus",
  "release",
  "reset-test",
  "resume",
  "unarchive",
]);

export const resumeStageSchema = z.enum([
  "queued",
  "checking",
  "restoring",
  "preparing",
  "opening-terminal",
  "opened",
  "ready",
  "failed",
]);

export const lifecycleJobSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  stage: resumeStageSchema,
  error: z.string().optional(),
});

export const actionResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("complete") }),
  z.object({ status: z.literal("started"), job: lifecycleJobSchema }),
]);

export type ActionVerb = z.infer<typeof actionVerbSchema>;
export type ResumeStage = z.infer<typeof resumeStageSchema>;
export type LifecycleJob = z.infer<typeof lifecycleJobSchema>;
export type ActionResult = z.infer<typeof actionResultSchema>;
