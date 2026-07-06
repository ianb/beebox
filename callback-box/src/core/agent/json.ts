/**
 * Best-effort JSON extraction and env helpers for the agent runner.
 *
 * `extractJsonFromText` recovers a JSON value from free-form assistant text
 * when the SDK didn't populate `structured_output`. `dropUndefined` narrows
 * an env record to the `Record<string, string>` the SDK expects.
 * `validateStructuredResult` turns a raw run result into a validated,
 * schema-checked structured result.
 */

import type { z } from "zod";
import type { AgentResult, StructuredAgentResult } from "./types.js";

/**
 * Pull a JSON value out of the assistant's free-form result text.
 * Tries fenced ```json blocks first, then a bare object/array span.
 * Returns undefined if nothing parses.
 */
function extractJsonFromText(text: string): unknown {
  const fence = /```(?:json)?\s*\n([\S\s]*?)\n```/i.exec(text);
  if (fence !== null && fence[1] !== undefined) {
    try {
      return JSON.parse(fence[1]);
    } catch (_e) {
      // fall through to bare-span scan
    }
  }
  const start = text.search(/[[{]/);
  if (start === -1) return undefined;
  return scanJsonSpan(text, start);
}

/**
 * Walk from `start` to the matching close brace/bracket, respecting strings,
 * and parse the enclosed span. Returns undefined if it doesn't parse.
 */
function scanJsonSpan(text: string, start: number): unknown {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (_e) {
          return undefined;
        }
      }
    }
  }
  return undefined;
}


/**
 * Turn a raw `AgentResult` from a structured run into a validated
 * `StructuredAgentResult`: prefer the SDK's `structuredOutput`, fall back to
 * parsing JSON out of the final assistant text, then validate against the
 * caller's Zod schema.
 */
export function validateStructuredResult<T>(
  schema: z.ZodType<T>,
  result: AgentResult,
): StructuredAgentResult<T> {
  if (!result.success) {
    return { ...result, data: null };
  }
  const candidate =
    result.structuredOutput ??
    (result.resultText !== undefined ? extractJsonFromText(result.resultText) : undefined);
  if (candidate === undefined) {
    return {
      ...result,
      success: false,
      data: null,
      error: "Structured output: no JSON found in result",
    };
  }
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ...result,
      success: false,
      data: null,
      error: `Structured output failed schema validation: ${parsed.error.message}`,
    };
  }
  return { ...result, data: parsed.data };
}
