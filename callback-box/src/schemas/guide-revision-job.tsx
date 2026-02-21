/**
 * Guide revision job card schema - a job to revise the news guide based on feedback.
 *
 * Created by sync when archived briefs have unprocessed feedback.
 * Processed by the reactor agent, which reads the guide, extracts feedback
 * from referenced briefs, updates the guide, and calls `cb finish`.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";
import { JobDescription } from "./news-job.js";

/**
 * Child element referencing an archived brief with unprocessed feedback.
 */
export const JobBrief = element("brief", {
  attrs: {
    ref: z.string(),
  },
});

/**
 * Guide revision job card schema.
 *
 * Example:
 * ```xml
 * <guide-revision-job created="2026-01-15T12:00:00Z" source="feedback-sync">
 *   <description>2 briefs with unprocessed feedback</description>
 *   <brief ref="store/archive/briefs/2026-01-14_tech-ai.news-brief.card" />
 * </guide-revision-job>
 * ```
 */
export const GuideRevisionJobSchema = element("guide-revision-job", {
  attrs: {
    created: z.string().datetime({ offset: true }),
    source: z.string(),
    /** Path to the guide being revised */
    guide: z.string().optional(),
  },
  children: z.array(z.union([JobDescription, JobBrief])),
  instructions: `# Processing Guide Revision Jobs

A guide-revision job means archived briefs have reader feedback that should inform a guide.

## Steps

1. Read this job card to find:
   - The \`guide\` attribute — the path to the guide to revise (e.g., \`config/news.guide.card\`)
   - The referenced briefs (each \`<brief ref="...">\` points to an archived brief)
2. Read the guide card specified in the \`guide\` attribute
3. Read each referenced brief and extract all feedback signals:
   - **Root attrs**: \`overall-rating\` (great/ok/meh), \`selected-reactions\`, \`read-at\`
   - **Section/expando attrs**: \`user-feedback="thumbs-up"\` or \`"thumbs-down"\`
   - **User comments**: \`<user-comment>\` elements with transcribed voice/text feedback
   - **Curation section**: \`<interest>\` refs, \`<experiment-ref>\`, \`<hypothesis>\` elements
4. Synthesize feedback across all briefs — look for patterns in thumbs up/down, overall ratings, explicit comments
5. Update the guide based on the complete picture:
   - **Triage rules**: thumbs up → increase confidence; thumbs down → decrease confidence or add Skip rule
   - **Actions**: adjust instructions based on feedback patterns
   - **Experiments**: add \`<observation>\` elements; mark successful/unsuccessful based on clear signals
   - Keep 1-3 active/proposed experiments
6. Mark each processed brief with \`guide-revision="<current-timestamp>"\` attribute on the root element
7. Commit with a detailed message summarizing the revision
8. Run \`cb finish <this-job-file>\` to complete the job

## Confidence Ladder

- hypothesis → low: First signal of interest
- low → medium: Consistent pattern (2-3 signals)
- medium → high: Strong evidence (multiple confirmations)
- high → confirmed: User directly stated preference

## Important

- Commit your work before running \`cb finish\`
- The \`cb finish\` command only deletes the job file — make sure your actual work is committed first
- Read each brief carefully — feedback signals are spread across multiple attributes and elements
- Be conservative with confidence changes — one brief usually means one step up the ladder`,
});

export type GuideRevisionJob = z.infer<typeof GuideRevisionJobSchema>;

/**
 * Template for creating a guide-revision job card.
 */
export function createGuideRevisionJobTemplate(options: {
  created?: string;
  source: string;
  description: string;
  briefs: string[];
  /** Path to the guide being revised */
  guide?: string;
}): string {
  const created = options.created ?? new Date().toISOString();
  const guideAttr = options.guide ? ` guide="${escapeAttr(options.guide)}"` : "";
  const briefElements = options.briefs
    .map((ref) => `  <brief ref="${escapeAttr(ref)}" />`)
    .join("\n");

  return `<guide-revision-job created="${created}" source="${escapeAttr(options.source)}"${guideAttr}>
  <description>${escapeText(options.description)}</description>
${briefElements}
</guide-revision-job>
`;
}
