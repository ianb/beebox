import type { LogLevel } from "./types.js";

export type TranscriptEntry =
  | { kind: "log"; frame: number; level: LogLevel; message: string }
  | { kind: "image"; frame: number; labels: string[]; file: string; unchanged: boolean }
  | { kind: "error"; frame: number; name: string; message: string; stack: string };

export interface RunMeta {
  sketchPath: string;
  seed: number;
  fps: number;
  frames: number;
  eventsPath: string | undefined;
  width: number;
  height: number;
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
  ].join("\n");
}

function renderImage(entry: { frame: number; labels: string[]; file: string; unchanged: boolean }): string {
  const suffix = entry.labels.length > 0 ? ` — ${entry.labels.join(", ")}` : "";
  const heading = `### frame ${entry.frame}${suffix}${entry.unchanged ? " (unchanged)" : ""}`;
  return `${heading}\n![frame ${entry.frame}${suffix}](${entry.file})`;
}

function renderEntry(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case "log":
      return `**[frame ${entry.frame}]** ${entry.level}: ${entry.message}`;
    case "image":
      return renderImage(entry);
    case "error":
      return `**[frame ${entry.frame}]** ERROR ${entry.name}: ${entry.message}\n\n\`\`\`\n${entry.stack}\n\`\`\``;
  }
}

/** Render the full transcript.md body: metadata header then chronological entries. */
export function renderTranscript(meta: RunMeta, entries: readonly TranscriptEntry[]): string {
  const blocks = [renderHeader(meta), ...entries.map(renderEntry)];
  return `${blocks.join("\n\n")}\n`;
}
