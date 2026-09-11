// Attached documents share the existing aside publication boundary.
import { asidePublishedBody } from "./asides.js";
import { asideProvenance } from "./fisheye.js";
import type { PageFrontmatter } from "./render.js";

export function publishedPageBody(params: { id: string; frontmatter: PageFrontmatter; body: string }): string {
  const { kind, status, title } = params.frontmatter;
  if (kind === undefined && status === undefined && !params.id.includes(".attach/")) return params.body;
  if (kind === undefined || status === undefined) throw new Error(`${params.id}: attached documents require kind and status`);
  const body = asidePublishedBody({
    slug: params.id, file: params.id,
    fields: { kind, status, label: title }, body: params.body.trim(),
  });
  const heading = kind === "author" && status === "pending" ? `# ${title}\n\n` : "";
  return `${heading}${body}\n\n*${asideProvenance(kind)}*\n`;
}
