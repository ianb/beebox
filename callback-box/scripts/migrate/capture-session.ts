#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Migrate `.capture-session.card` files from the XML body format to Phase-2
 * frontmatter + a Markdoc transcript body.
 *
 * Frontmatter: status, session-id, time, and the image/audio/file
 * manifests. Body: the transcript timeline — `<text>` runs become
 * paragraphs, `<image>` becomes `{% image ref="…" /%}` (reference-only;
 * description/filename now come from the image card), `<silence>` becomes
 * `{% silence duration="…" /%}`.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/capture-session.ts <root>           # dry-run
 *   pnpm exec tsx scripts/migrate/capture-session.ts <root> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseCard, splitCardContent, type ElementNode } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { runMigration } from "./_harness.js";
import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

const SPEC: ElementSpec = {
  attrs: ["status", "session-id"],
  children: {
    time: { attrs: ["start", "end", "duration"] },
    images: { attrs: [], children: { "image-ref": { attrs: ["ref"] } } },
    "audio-clips": { attrs: [], children: { "audio-ref": { attrs: ["ref"] } } },
    files: { attrs: [], children: { "file-ref": { attrs: ["ref"] } } },
    purpose: { attrs: [] }, // legacy, dropped
    transcript: {
      attrs: [],
      children: {
        text: { attrs: [] },
        image: { attrs: ["ref", "description", "filename"] },
        silence: { attrs: ["duration"] },
      },
    },
  },
};

function text(el: ElementNode): string {
  return typeof el.text === "string" ? el.text.trim() : "";
}

function child(el: ElementNode, tag: string): ElementNode | undefined {
  return el.children.find((c) => c.tagName === tag);
}

function refList(el: ElementNode | undefined, childTag: string): string[] {
  if (el === undefined) return [];
  const out: string[] = [];
  for (const c of el.children) {
    if (c.tagName !== childTag) continue;
    const ref = c.attrs["ref"];
    if (typeof ref === "string" && ref !== "") out.push(ref);
  }
  return out;
}

function buildTranscriptBody(transcript: ElementNode | undefined): string {
  if (transcript === undefined) return "";
  const parts: string[] = [];
  for (const node of transcript.children) {
    if (node.tagName === "text") {
      const t = text(node);
      if (t !== "") parts.push(t);
    } else if (node.tagName === "image") {
      const ref = node.attrs["ref"];
      if (typeof ref === "string" && ref !== "") parts.push(`{% image ref="${ref}" /%}`);
    } else if (node.tagName === "silence") {
      const duration = node.attrs["duration"];
      if (typeof duration === "string" && duration !== "") parts.push(`{% silence duration="${duration}" /%}`);
    }
  }
  return parts.join("\n\n");
}

await runMigration({
  description: "Convert *.capture-session.card XML body → frontmatter + Markdoc transcript.",
  match: (name) => name.endsWith(".capture-session.card"),
  convert: async (absPath, { warnings, apply }) => {
    const content = await readFile(absPath, "utf-8");
    const split = splitCardContent(content);
    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
    if (split.hasFrontmatter && !isXml) return "already";

    const root = await parseCard(content, { source: absPath });
    if (root.tagName !== "capture-session") {
      throw new Error(`expected <capture-session> root, got <${root.tagName}>`);
    }
    checkElement({ node: root, source: absPath, spec: SPEC, warnings });

    const fields: Record<string, unknown> = {
      status: root.attrs["status"] ?? "new",
      "session-id": root.attrs["session-id"] ?? "",
    };

    const timeEl = child(root, "time");
    if (timeEl) {
      const time: Record<string, string> = {};
      for (const k of ["start", "end", "duration"]) {
        const v = timeEl.attrs[k];
        if (typeof v === "string" && v !== "") time[k] = v;
      }
      if (Object.keys(time).length > 0) fields.time = time;
    }

    const images = refList(child(root, "images"), "image-ref");
    if (images.length > 0) fields.images = images;
    const audioClips = refList(child(root, "audio-clips"), "audio-ref");
    if (audioClips.length > 0) fields["audio-clips"] = audioClips;
    const files = refList(child(root, "files"), "file-ref");
    if (files.length > 0) fields.files = files;

    const body = buildTranscriptBody(child(root, "transcript"));
    const out = body === "" ? `---\n${stringifyYaml(fields)}---\n` : `---\n${stringifyYaml(fields)}---\n${body}\n`;
    if (apply) await writeFile(absPath, out, "utf-8");
    return "converted";
  },
});
