/**
 * The tab a page lives in: its title and favicon.
 *
 * Every section shares one favicon shape (a rounded tile with a white letter)
 * and differs in color and letter, so a row of dashboard tabs reads as one app
 * while each tab stays identifiable. Titles put the specific thing first
 * ("<issue title> · Issues · Workstreams") because a narrow tab shows only the
 * start.
 */

import { useEffect } from "react";

const APP_NAME = "Workstreams";

export const PAGE_SECTIONS = {
  recent: { label: "Recent", glyph: "R", color: "#315ba8" },
  streams: { label: APP_NAME, glyph: "W", color: "#2f7d5b" },
  issues: { label: "Issues", glyph: "I", color: "#c2611f" },
  plans: { label: "Plans", glyph: "P", color: "#6b4fa0" },
  browse: { label: "Browse", glyph: "B", color: "#58738f" },
  testing: { label: "Manual testing", glyph: "T", color: "#a07a10" },
  asks: { label: "Asks", glyph: "A", color: "#a63d7a" },
  alerts: { label: "Alerts", glyph: "!", color: "#8f2d24" },
} as const;

export type PageSection = keyof typeof PAGE_SECTIONS;

/** `<detail> · <section> · Workstreams`, without repeating the app name. */
export function pageTitle(section: PageSection, detail?: string | null): string {
  const { label } = PAGE_SECTIONS[section];
  const parts = [detail, label, label === APP_NAME ? null : APP_NAME];
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" · ");
}

/** The section's favicon as an inline SVG data URL; no asset files to serve. */
export function sectionFavicon(section: PageSection): string {
  const { glyph, color } = PAGE_SECTIONS[section];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><rect x="3" y="25" width="26" height="3" rx="1.5" fill="#fff" fill-opacity=".35"/><text x="16" y="21.5" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="19" font-weight="800" fill="#fff">${glyph}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Set the tab title and favicon for the page that calls it. */
export function usePageIdentity(section: PageSection, detail?: string | null): void {
  useEffect(() => {
    document.title = pageTitle(section, detail);
    let icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (icon === null) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.append(icon);
    }
    icon.type = "image/svg+xml";
    icon.href = sectionFavicon(section);
  }, [section, detail]);
}
