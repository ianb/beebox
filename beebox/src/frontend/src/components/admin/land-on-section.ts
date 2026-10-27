import { adminSectionElementId, type AdminSectionId } from "./sections";

/**
 * Every panel stays mounted, so the section is in the DOM once its tab is
 * shown. The section takes focus too, so a keyboard or screen-reader user
 * starts there; it is focusable only until focus leaves it.
 */
export function landOnSection(id: AdminSectionId): void {
  requestAnimationFrame(() => {
    const element = document.getElementById(adminSectionElementId(id));
    if (element === null) return;
    element.scrollIntoView({ block: "start" });
    element.setAttribute("tabindex", "-1");
    element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
    element.focus({ preventScroll: true });
  });
}
