/**
 * Which elements the scan reports, and what role it reports them as.
 *
 * Interactive elements and landmarks only. Content headings and prose are not
 * scanned: the dump is about chrome, and the agent already learns what the user
 * is reading through the `open-card` context attribute.
 */

import type { ScanElement } from "./types.js";

/** What the scan treats an element as, or null for "not reported". */
export type ScanKind = "control" | "landmark";

/** Roles that group the dump. A landmark with no name is not a landmark. */
const LANDMARK_ROLES = new Set([
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search",
]);

/** Widget roles this app puts on non-native elements (menus, tabs, switches). */
const WIDGET_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

/** Implicit role by tag, for the tags that carry one the scan reports. */
const TAG_ROLES: Readonly<Record<string, string>> = {
  a: "link",
  aside: "complementary",
  button: "button",
  footer: "contentinfo",
  form: "form",
  header: "banner",
  main: "main",
  nav: "navigation",
  section: "region",
  select: "combobox",
  summary: "button",
  textarea: "textbox",
};

/** Implicit role by `<input type>`; anything unlisted names a text field. */
const INPUT_ROLES: Readonly<Record<string, string>> = {
  button: "button",
  checkbox: "checkbox",
  image: "button",
  number: "spinbutton",
  radio: "radio",
  range: "slider",
  reset: "button",
  search: "searchbox",
  submit: "button",
};

/**
 * Tags that are a landmark only once they have an accessible name — a bare
 * `<section>` is a generic box, `<section aria-label="Compose message">` is the
 * composer region.
 */
const NAME_REQUIRED_LANDMARK_TAGS = new Set(["section", "form"]);

function attr(element: ScanElement, name: string): string | null {
  const value = element.attributes[name];
  return value === undefined ? null : value;
}

function implicitRole(element: ScanElement): string | null {
  if (element.tag === "a") return attr(element, "href") === null ? null : "link";
  if (element.tag === "input") {
    const type = attr(element, "type");
    if (type === "hidden") return null;
    if (type === null) return "textbox";
    return INPUT_ROLES[type.toLowerCase()] ?? "textbox";
  }
  return TAG_ROLES[element.tag] ?? null;
}

/**
 * The role the dump reports, and whether the element is a control, a landmark,
 * or neither. `nameRequired` marks the tags that only become landmarks once
 * named, so an unnamed one is skipped silently rather than counted as a control
 * the app forgot to label.
 */
export function classifyElement(element: ScanElement): {
  kind: ScanKind;
  role: string;
  nameRequired: boolean;
} | null {
  const explicit = attr(element, "role");
  const role = explicit === null ? implicitRole(element) : explicit.trim().split(/\s+/)[0] ?? null;
  if (role === null) return null;
  if (LANDMARK_ROLES.has(role)) {
    return { kind: "landmark", role, nameRequired: NAME_REQUIRED_LANDMARK_TAGS.has(element.tag) };
  }
  if (WIDGET_ROLES.has(role)) return { kind: "control", role, nameRequired: false };
  return null;
}
