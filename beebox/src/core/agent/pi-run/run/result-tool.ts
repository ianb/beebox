/**
 * The structured result of a pi run, returned through a tool call.
 *
 * pi 1.4.0 has no top-level output schema. A `submit_result` tool whose
 * parameters are the caller's schema does the same job: pi validates the
 * arguments against the schema before `execute`, and `terminate` ends the run
 * with no further model call (docs/implemented-plans/pi-box-engine.md, Track 4).
 */

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { toJSONSchema, type z } from "zod";

export const RESULT_TOOL_NAME = "submit_result";

/** The one host prompt sent after a run that completed without the call. */
export const RESULT_TOOL_FOLLOW_UP =
  `You did not call ${RESULT_TOOL_NAME}. Call ${RESULT_TOOL_NAME} now with your answer; do not reply in prose.`;

export interface PiResultTool {
  tool: ToolDefinition;
  /** The arguments of the first call, or undefined before one. */
  submitted(): unknown;
}

export function piResultTool(schema: z.ZodType): PiResultTool {
  const parameters: Record<string, unknown> = { ...toJSONSchema(schema) };
  delete parameters["$schema"];
  let submitted: unknown;
  const tool = defineTool({
    name: RESULT_TOOL_NAME,
    label: "Submit result",
    description: "Submit the final structured answer. Call it exactly once, when the task is done.",
    promptSnippet: `${RESULT_TOOL_NAME} - submit the final structured answer`,
    promptGuidelines: [`Finish every task by calling ${RESULT_TOOL_NAME}.`],
    parameters,
    execute: async (_toolCallId, params: unknown) => {
      submitted ??= params;
      return { content: [{ type: "text", text: "Result recorded." }], details: {}, terminate: true };
    },
  });
  return { tool, submitted: () => submitted };
}
