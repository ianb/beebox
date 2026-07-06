/**
 * Rendering helpers for the agent SDK message stream.
 *
 * Turn typed `SDKMessage` events into human-readable lines for `onOutput`.
 * A loose imitation of the CLI's verbose stream — assistant text passes
 * through verbatim, tool calls and results get one-line summaries.
 */

import type {
  SDKMessage,
  SDKAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { fmt } from "../lib/format.js";

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  // Surface common fields concisely.
  for (const key of ["command", "file_path", "path", "pattern", "url"]) {
    const v = obj[key];
    if (typeof v === "string") return truncate(v, 120);
  }
  return truncate(JSON.stringify(obj), 120);
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (item && typeof item === "object" && "type" in item && item.type === "text") {
        const text = (item as { text?: unknown }).text;
        if (typeof text === "string") parts.push(text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

function renderAssistantMessage(msg: SDKAssistantMessage): string {
  const lines: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === "text") {
      if (block.text) lines.push(block.text);
    } else if (block.type === "tool_use") {
      const inputSummary = summarizeToolInput(block.input);
      lines.push(fmt.dim(`\n→ ${block.name}(${inputSummary})\n`));
    } else if (block.type === "thinking") {
      // Thinking blocks: keep noise low — single line marker.
      lines.push(fmt.dim("  …thinking…\n"));
    }
  }
  if (msg.error) {
    lines.push(fmt.fail(`\n[assistant error: ${msg.error}]\n`));
  }
  return lines.join("");
}

function renderUserMessage(msg: Extract<SDKMessage, { type: "user" }>): string {
  // Tool results — one-line summary per block.
  const lines: string[] = [];
  const content = msg.message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "tool_result") {
        const text = extractToolResultText(block.content);
        const summary = text ? truncate(text.replace(/\s+/g, " "), 200) : "(no content)";
        const errMark = block.is_error ? fmt.fail(" [error]") : "";
        lines.push(fmt.dim(`  ↳ ${summary}${errMark}\n`));
      }
    }
  }
  return lines.join("");
}

function renderResultMessage(msg: Extract<SDKMessage, { type: "result" }>): string {
  if (msg.subtype === "success") {
    return fmt.ok(
      `\n[done in ${msg.num_turns} turn(s), ${(msg.duration_ms / 1000).toFixed(1)}s]\n`,
    );
  }
  return fmt.fail(`\n[result error: ${msg.subtype}]\n`);
}

/**
 * Render a single SDKMessage event to a human-readable line for `onOutput`.
 */
export function renderSdkMessage(msg: SDKMessage): string {
  if (msg.type === "system" && msg.subtype === "init") {
    const sid = msg.session_id;
    return fmt.dim(`[session ${sid.slice(0, 8)} model=${msg.model ?? "default"}]\n`);
  }
  if (msg.type === "assistant") {
    return renderAssistantMessage(msg);
  }
  if (msg.type === "user") {
    return renderUserMessage(msg);
  }
  if (msg.type === "result") {
    return renderResultMessage(msg);
  }
  return "";
}
