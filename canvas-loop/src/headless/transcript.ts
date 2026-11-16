import { formatValue } from "../core/format.js";
import type { LogLevel } from "../core/types.js";

export type TranscriptEntry =
  | { kind: "log"; frame: number; level: LogLevel; message: string }
  | { kind: "param"; frame: number; name: string; value: number | boolean | string }
  | { kind: "input"; frame: number; event: string; verdict: string }
  | {
      kind: "image";
      frame: number;
      labels: string[];
      file: string;
      unchanged: boolean;
      zooms: readonly { file: string; label: string }[];
    }
  /** A step that threw: the frame (undefined before frame 0), the step, `Name: message`, and the sketch's lines. */
  | { kind: "error"; frame: number | undefined; step: string; text: string; at: readonly string[] }
  /** Preformatted text under the frame's image (`--scene`). */
  | { kind: "block"; frame: number; text: string };

export interface RunMeta {
  sketchPath: string;
  seed: number;
  fps: number;
  frames: number;
  eventsPath: string | undefined;
  width: number;
  height: number;
  /** The device pixel ratio (`--ratio`). */
  ratio?: number;
  /** The GPU adapter the scene renderer drew with. */
  adapter?: string;
}

function renderHeader(meta: RunMeta): string {
  return [
    "# canvas-loop transcript",
    "",
    `- sketch: \`${meta.sketchPath}\``,
    `- seed: ${meta.seed}`,
    `- fps: ${meta.fps}`,
    `- frames: ${meta.frames}`,
    `- events: ${meta.eventsPath === undefined ? "none" : `\`${meta.eventsPath}\``}`,
    `- canvas: ${meta.width}x${meta.height}`,
    ...(meta.ratio === undefined ? [] : [`- ratio: ${meta.ratio}`]),
    ...(meta.adapter === undefined ? [] : [`- adapter: ${meta.adapter}`]),
  ].join("\n");
}

function renderImage(entry: {
  frame: number;
  labels: string[];
  file: string;
  unchanged: boolean;
  zooms: readonly { file: string; label: string }[];
}): string {
  const suffix = entry.labels.length > 0 ? ` — ${entry.labels.join(", ")}` : "";
  const heading = `### frame ${entry.frame}${suffix}${entry.unchanged ? " (unchanged)" : ""}`;
  const zooms = entry.zooms.map((z) => `\n\nzoom ${z.label}\n![frame ${entry.frame} zoom ${z.label}](${z.file})`);
  return `${heading}\n![frame ${entry.frame}${suffix}](${entry.file})${zooms.join("")}`;
}

/** `frame N: error in <step>: Name: message (at the sketch's line)`, the line a failed run ends with; `RunResult.errors` holds the same text. */
export function errorLine(entry: { frame: number | undefined; step: string; text: string; at: readonly string[] }): string {
  const at = entry.at[0] === undefined ? "" : ` (at ${entry.at[0]})`;
  return `${entry.frame === undefined ? "" : `frame ${entry.frame}: `}error in ${entry.step}: ${entry.text}${at}`;
}

function renderEntry(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case "log":
      return `**[frame ${entry.frame}]** ${entry.level}: ${entry.message}`;
    case "param":
      return `**[frame ${entry.frame}]** param: ${entry.name} → ${formatValue(entry.value)}`;
    case "input":
      return `**[frame ${entry.frame}]** ${entry.event} → ${entry.verdict}`;
    case "image":
      return renderImage(entry);
    case "error": {
      const at = entry.at.length === 0 ? "" : `\n\n\`\`\`\n${entry.at.map((line) => `  at ${line}`).join("\n")}\n\`\`\``;
      return `${errorLine(entry)}${at}`;
    }
    case "block":
      return `\`\`\`\n${entry.text}\n\`\`\``;
  }
}

/** Render the full transcript.md body: metadata header then chronological entries. */
export function renderTranscript(meta: RunMeta, entries: readonly TranscriptEntry[]): string {
  const blocks = [renderHeader(meta), ...entries.map(renderEntry)];
  return `${blocks.join("\n\n")}\n`;
}
