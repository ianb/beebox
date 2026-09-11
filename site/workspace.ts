// Server-render every reading arrangement. JavaScript enhances these normal links.
import { FISHEYE_CSS } from "./fisheye.js";
import { escapeHtml } from "./render.js";
import { nextDestination, type SitePage, type SiteWorkspace } from "./workspace-model.js";

function nextLinks(workspace: SiteWorkspace, page: SitePage): string {
  const links = (page.frontmatter.next ?? []).map((next, index) => {
    const target = nextDestination(workspace, { page, card: next.card });
    const href = target.href + (next.at ? `#${next.at}` : "");
    return `<a data-next="${escapeHtml(target.id)}" data-order="${index}" href="${escapeHtml(href)}">${escapeHtml(next.label)}</a>`;
  });
  return links.length > 0 ? `<nav class="next-places" aria-label="Where next"><div class="next-label">Where next</div>${links.join("")}</nav>` : "";
}

function contextBody(page: SitePage): string {
  return page.html
    .replace(/id="([^"]+)"/g, 'id="context-$1"')
    .replace(/aria-labelledby="([^"]+)"/g, 'aria-labelledby="context-$1"')
    .replace(/href="#([^"]+)"/g, (_match, anchor: string) => `href="${escapeHtml(page.href)}#${anchor}"`)
    .replace(/<(\/?)(h[1-5])\b/g, (_match, ...parts: string[]) => {
      const [close = "", heading = "h1"] = parts;
      return `<${close}h${Number(heading.slice(1)) + 1}`;
    });
}

function pane(workspace: SiteWorkspace, params: { page: SitePage; context: boolean }): string {
  const { page, context } = params;
  const parent = workspace.pages.find((candidate) => candidate.id === page.parentId);
  const theme = page.frontmatter.theme ?? "paper";
  const stock = page.frontmatter.stock ?? (theme === "post-it" ? "yellow" : "cream");
  const label = parent
    ? `<a href="${escapeHtml(parent.href)}" data-parent>Back to ${escapeHtml(parent.frontmatter.title)}</a>`
    : page.frontmatter.navigation ? "Collection" : "Reading";
  const transition = `card-${workspace.pages.indexOf(page)}`;
  return `<section class="pane${context ? " context" : ""}" data-card="${escapeHtml(page.id)}" aria-label="${escapeHtml(page.frontmatter.title)}">
<div class="pane-label">${label}<span>${parent ? "Aside" : "Document"}</span></div>
<article class="bbx-card-theme bbx-card-surface" data-card-theme="${theme}" data-card-stock="${stock}" style="view-transition-name:${transition}">
<span class="card-fold" aria-hidden="true"></span><div class="bbx-card-front"><div class="bbx-card-content bbx-theme-prose">
${context ? contextBody(page) : page.html}
${context ? "" : nextLinks(workspace, page)}
</div></div></article></section>`;
}

function menuHtml(workspace: SiteWorkspace): string {
  const body = workspace.navigation.html.replace(/<h1[^>]*>([\S\s]*?)<\/h1>/, '<div class="menu-label">$1</div>')
    .replace(/id="([^"]+)"/g, 'id="menu-$1"')
    .replace(/aria-labelledby="([^"]+)"/g, 'aria-labelledby="menu-$1"')
    .replace(/href="#([^"]+)"/g, (_match, anchor: string) => `href="${escapeHtml(workspace.navigation.href)}#${anchor}"`);
  return `<details id="site-menu"><summary class="bbx-place-pill">Menu <span aria-hidden="true">⌄</span></summary><nav class="site-menu-panel" aria-label="Menu">${body}</nav></details>`;
}

export function workspaceShell(workspace: SiteWorkspace, page: SitePage): string {
  const context = page.id === workspace.navigation.id ? undefined
    : workspace.pages.find((candidate) => candidate.id === page.parentId) ?? workspace.navigation;
  const chrome = workspace.navigation.frontmatter.chrome ?? { theme: "paper", stock: "cream" };
  const styles = ["materials", "card-themes", "chrome", "site"].map((name) => `<link rel="stylesheet" href="${escapeHtml(workspace.base)}assets/${name}.css">`).join("\n");
  const description = escapeHtml(page.frontmatter.summary);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.frontmatter.title)} | Bee Box</title><meta name="description" content="${description}">
${styles}<style>${FISHEYE_CSS}</style>
<noscript><style>.fx-b[hidden="until-found"]{display:inline;content-visibility:visible;width:auto;height:auto;overflow:visible}.fx-t{display:none}</style></noscript>
</head><body class="bbx-box-presentation" data-chrome-theme="${chrome.theme}" data-chrome-stock="${chrome.stock ?? "cream"}" data-site-base="${escapeHtml(workspace.base)}">
<a class="skip-link" href="#reading-card">Skip to reading</a>
<header class="bbx-app-nav" id="site-header"><div><a class="brand" href="${escapeHtml(workspace.base)}">Bee Box</a>${menuHtml(workspace)}<span class="by">by <a href="https://ianbicking.org" target="_blank" rel="noopener noreferrer">Ian Bicking</a></span></div></header>
<main id="site-workspace" class="${context ? "" : "single"}" data-page="${escapeHtml(page.id)}" data-href="${escapeHtml(page.href)}" data-place="${escapeHtml(page.parentId ? context?.href ?? page.href : page.href)}" aria-label="Reading workspace">
${context ? pane(workspace, { page: context, context: true }) : ""}
${pane(workspace, { page, context: false }).replace('class="pane"', 'class="pane" id="reading-card" tabindex="-1"')}
</main><script src="${escapeHtml(workspace.base)}assets/navigation.js" defer></script></body></html>`;
}
