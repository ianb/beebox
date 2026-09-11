// The static card graph: identities, canonical attachment parents and authored routes.
import { classifyHref, resolveInternalHref } from "./links.js";
import type { PageFrontmatter } from "./render.js";

export interface SitePage {
  id: string;
  output: string;
  href: string;
  html: string;
  frontmatter: PageFrontmatter;
  parentId?: string;
}

export interface SiteWorkspace {
  pages: readonly SitePage[];
  navigation: SitePage;
  base: string;
}

export function headingIds(html: string): string {
  const used = new Set<string>();
  return html.replace(/<h([1-6])([^>]*)>([\S\s]*?)<\/h\1>/g, (_match, ...parts: string[]) => {
    const [level = "2", attrs = "", body = ""] = parts;
    const existing = /\bid="([^"]+)"/.exec(attrs)?.[1];
    const stem = existing ?? (body.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").toLowerCase()
      .replace(/[^\da-z]+/g, "-").replace(/^-|-$/g, "") || "section");
    let id = stem;
    let suffix = 2;
    while (used.has(id)) id = `${stem}-${suffix++}`;
    used.add(id);
    return `<h${level}${attrs.replace(/\s+id="[^"]*"/, "")} id="${id}">${body}</h${level}>`;
  });
}

function attachmentParent(page: SitePage, pages: readonly SitePage[]): string | undefined {
  const split = page.id.lastIndexOf(".attach/");
  if (split === -1) return undefined;
  const stem = page.id.slice(0, split);
  const candidates = pages.filter((candidate) => candidate.id === `${stem}.doc.card` || candidate.id === `${stem}.site-page.card`);
  if (candidates.length !== 1) throw new Error(`${page.id}: attachment needs exactly one parent card at ${stem}`);
  return candidates[0]?.id;
}

export function nextDestination(workspace: SiteWorkspace, params: { page: SitePage; card: string }): SitePage {
  if (classifyHref(params.card) !== "internal") throw new Error(`${params.page.id}: next.card must name a local card`);
  const resolved = resolveInternalHref({ href: params.card, pageSitePath: params.page.id, base: workspace.base });
  const target = workspace.pages.find((page) => page.output === resolved.target);
  if (!target) throw new Error(`${params.page.id}: next.card not found: ${params.card}`);
  return target;
}

function validatePresentation(page: SitePage): void {
  const theme = page.frontmatter.theme ?? "paper";
  const stock = page.frontmatter.stock;
  const permitted = theme === "post-it" ? ["yellow", "rose", "mint"] : ["cream", "manila", "blue"];
  if (stock !== undefined && !permitted.includes(stock)) throw new Error(`${page.id}: ${stock} is not a ${theme} stock`);
  if (page.frontmatter.chrome && !page.frontmatter.navigation) throw new Error(`${page.id}: chrome belongs on the navigation card`);
}

export function prepareWorkspace(params: { pages: SitePage[]; base: string }): SiteWorkspace {
  const menus = params.pages.filter((page) => page.frontmatter.navigation);
  const navigation = menus[0];
  if (menus.length !== 1 || !navigation) throw new Error("site needs exactly one card with navigation: true");
  const workspace = { ...params, navigation };
  const outputs = new Set<string>();
  for (const page of params.pages) {
    if (outputs.has(page.output)) throw new Error(`${page.id}: duplicate output ${page.output}`);
    outputs.add(page.output);
    validatePresentation(page);
    const parent = attachmentParent(page, params.pages);
    if (parent !== undefined) page.parentId = parent;
    if (parent !== undefined && page.frontmatter.navigation) throw new Error(`${page.id}: navigation cannot be an attached card`);
    for (const next of page.frontmatter.next ?? []) {
      const target = nextDestination(workspace, { page, card: next.card });
      if (next.at && !target.html.includes(`id="${next.at}"`)) throw new Error(`${page.id}: next section ${next.at} not found in ${target.id}`);
    }
  }
  return workspace;
}
